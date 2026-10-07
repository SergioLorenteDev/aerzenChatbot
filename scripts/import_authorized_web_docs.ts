import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const AERZEN_HOST = "www.aerzen.com";
const BASE_URL = `https://${AERZEN_HOST}`;
const MAX_PAGES = Number(process.env.AERZEN_WEB_MAX_PAGES ?? 90);
const CHUNK_SIZE = Number(process.env.AERZEN_WEB_CHUNK_SIZE ?? 2600);
const CHUNK_OVERLAP = Number(process.env.AERZEN_WEB_CHUNK_OVERLAP ?? 300);
const REQUEST_TIMEOUT_MS = Number(process.env.AERZEN_WEB_TIMEOUT_MS ?? 15_000);
const CRAWL_DELAY_MS = Number(process.env.AERZEN_WEB_DELAY_MS ?? 400);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SEED_URLS = [
  "/es/productos/catalogo-de-productos",
  "/es/productos/catalogo-de-productos/score/desc/0/2",
  "/es/productos/catalogo-de-productos/score/desc/0/3",
  "/es/productos/soplantes-de-desplazamiento-positivo",
  "/es/productos/compresores-de-tornillo",
  "/es/productos/soplantes-de-tornillo",
  "/es/productos/turbosoplantes",
  "/es/productos/tecnologia-de-control",
  "/es/aplicaciones",
  "/es/aplicaciones/tratamiento-de-aguas-y-aguas-residuales",
  "/es/aplicaciones/transporte-neumatico-de-materiales-en-polvo-a-granel-y-solidos",
  "/es/aplicaciones/tecnologia-de-gases-de-proceso",
  "/es/aplicaciones/procesamiento-de-alimentos",
  "/es/aplicaciones/tecnologia-quimica-y-de-procesos",
  "/es/aplicaciones/tecnologia-de-aire-comprimido",
  "/es/aplicaciones/biogas-y-biometano",
  "/es/servicios/servicio-en-campo/puesta-en-funcionamiento",
  "/es/servicios/servicio-en-campo/inspeccion-y-mantenimiento",
  "/es/servicios/servicio-en-campo/reparaciones",
  "/es/servicios/piezas-originales-de-aerzen/piezas-de-recambio",
  "/es/servicios/piezas-originales-de-aerzen/kits-de-mantenimiento",
  "/es/servicios/piezas-originales-de-aerzen/aceite-aerzen",
  "/es/servicios/analisis-y-asesoramiento",
  "/es/servicios/analisis-y-asesoramiento/diagnostico-de-maquinas",
  "/es/servicios/analisis-y-asesoramiento/formacion",
  "/es/servicios/analisis-y-asesoramiento/registro-de-maquinas"
].map((url) => new URL(url, BASE_URL).toString());

type CrawledPage = {
  url: string;
  title: string;
  model: string | null;
  content: string;
  discoveredLinks: string[];
};

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripNoise(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
}

function titleFromHtml(html: string, fallbackUrl: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = h1 ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleaned = htmlToText(title ?? "");
  if (cleaned) {
    return cleaned.replace(/\s+-\s+Aerzen$/i, "").trim();
  }

  return new URL(fallbackUrl).pathname.split("/").filter(Boolean).at(-1)?.replace(/-/g, " ") ?? fallbackUrl;
}

function htmlToText(html: string) {
  return decodeEntities(
    stripNoise(html)
      .replace(/<(h[1-6]|p|li|tr|br|section|article|div)[^>]*>/gi, "\n")
      .replace(/<\/(h[1-6]|p|li|tr|section|article|div)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isBoilerplateLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isBoilerplateLine(line: string) {
  return [
    /^saltar al contenido/i,
    /^customernet$/i,
    /^login$/i,
    /^email address$/i,
    /^password$/i,
    /^forgot your password/i,
    /^iniciar sesión$/i,
    /^registro$/i,
    /^aviso legal$/i,
    /^política de privacidad$/i,
    /^suscripción al boletín$/i,
    /^open in google maps/i,
    /^image:?/i,
    /^seleccione/i,
    /^por favor elija/i
  ].some((pattern) => pattern.test(line));
}

function extractLinks(html: string, pageUrl: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1]!, pageUrl);
      url.hash = "";
      url.search = "";
      if (isAllowedUrl(url)) {
        links.add(url.toString());
      }
    } catch {
      // Ignore malformed links from the source HTML.
    }
  }
  return Array.from(links);
}

function isAllowedUrl(url: URL) {
  if (url.hostname !== AERZEN_HOST) {
    return false;
  }

  const pathName = url.pathname.toLowerCase();
  if (!pathName.startsWith("/es/")) {
    return false;
  }

  if (/forgot-password|login|logout|register|customernet|contacto|newsletter/.test(pathName)) {
    return false;
  }

  return [
    "/es/producto/",
    "/es/productos/",
    "/es/aplicaciones",
    "/es/servicios"
  ].some((prefix) => pathName.startsWith(prefix));
}

function inferModel(title: string, url: string) {
  const haystack = `${title}\n${new URL(url).pathname.replace(/-/g, " ")}`.toLowerCase();
  const modelPatterns: Array<[RegExp, string]> = [
    [/delta hybrid/, "Delta Hybrid"],
    [/delta blower|soplante delta|generation 5|generaci[oó]n 5/, "Delta Blower"],
    [/delta screw/, "Delta Screw"],
    [/delta e\b/, "Delta E"],
    [/aertronic/, "AERtronic"],
    [/aersmart/, "AERsmart"],
    [/webview/, "AERZEN WebView"],
    [/aerprogress/, "AERprogress"],
    [/turbo generation|turbosoplante/, "Turbo Generation"],
    [/serie sw|inyecci[oó]n de agua/, "Serie SW"],
    [/serie si|inyecci[oó]n de aceite/, "Serie SI"]
  ];

  return modelPatterns.find(([pattern]) => pattern.test(haystack))?.[1] ?? null;
}

function chunkText(text: string) {
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error(
      `Configuración inválida: AERZEN_WEB_CHUNK_OVERLAP (${CHUNK_OVERLAP}) debe ser menor que AERZEN_WEB_CHUNK_SIZE (${CHUNK_SIZE}).`
    );
  }

  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk.length >= 500) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

async function fetchPage(url: string): Promise<CrawledPage | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AERZEN-Iberica-Postventa-Importer/1.0 (+local chatbot knowledge base)",
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
      console.warn(`Saltando ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    const html = await response.text();
    const title = titleFromHtml(html, url);
    const content = htmlToText(html);
    if (content.length < 800) {
      console.warn(`Saltando ${url}: contenido insuficiente (${content.length} caracteres)`);
      return null;
    }

    return {
      url,
      title,
      content,
      model: inferModel(title, url),
      discoveredLinks: extractLinks(html, url)
    };
  } catch (error) {
    // Un fallo puntual de red o de parseo no debe abortar todo el crawl.
    console.warn(`Saltando ${url}: ${error instanceof Error ? error.message : "fallo al descargar la página"}`);
    return null;
  }
}

async function crawl() {
  const queue = [...SEED_URLS];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) {
      continue;
    }
    visited.add(url);

    const page = await fetchPage(url);
    if (!page) {
      continue;
    }

    pages.push(page);
    console.log(`OK ${pages.length}/${MAX_PAGES}: ${page.title} (${page.url})`);

    for (const link of page.discoveredLinks) {
      if (!queued.has(link) && !visited.has(link) && queued.size < MAX_PAGES * 4) {
        queued.add(link);
        queue.push(link);
      }
    }

    // Pausa entre peticiones para no saturar el sitio de origen.
    if (queue.length > 0 && CRAWL_DELAY_MS > 0) {
      await sleep(CRAWL_DELAY_MS);
    }
  }

  return pages;
}

async function persist(pages: CrawledPage[]) {
  const records = pages.flatMap((page) =>
    chunkText(page.content).map((content, index) => ({
      title: `${page.title} - Web oficial AERZEN${index > 0 ? ` - parte ${index + 1}` : ""}`,
      model: page.model,
      language: "es",
      sourceUrl: `${page.url}#chunk=${index + 1}`,
      content
    }))
  );

  // Se borra únicamente lo que este crawl va a reescribir, en lugar de vaciar todo
  // el dominio: así una importación no elimina documentos escritos a mano.
  if (pages.length > 0) {
    const deleted = await prisma.authorizedDocument.deleteMany({
      where: {
        OR: pages.flatMap((page) => [
          { sourceUrl: page.url },
          { sourceUrl: { startsWith: `${page.url}#chunk=` } }
        ])
      }
    });

    if (deleted.count > 0) {
      console.log(`Reemplazados ${deleted.count} fragmentos ya existentes.`);
    }
  }

  if (records.length > 0) {
    await prisma.authorizedDocument.createMany({ data: records });
  }

  return records.length;
}

async function writeReport(pages: CrawledPage[], recordCount: number) {
  const reportDir = path.resolve("reports", "knowledge");
  await mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `aerzen-web-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        importedAt: new Date().toISOString(),
        sourceHost: AERZEN_HOST,
        pages: pages.length,
        records: recordCount,
        urls: pages.map((page) => ({
          title: page.title,
          url: page.url,
          model: page.model,
          characters: page.content.length
        }))
      },
      null,
      2
    )
  );
  console.log(`Informe: ${reportPath}`);
}

async function main() {
  const pages = await crawl();
  const recordCount = await persist(pages);
  await writeReport(pages, recordCount);
  console.log(`Importadas ${pages.length} páginas oficiales en ${recordCount} fragmentos consultables.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
