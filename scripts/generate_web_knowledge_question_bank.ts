import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();
const TARGET_COUNT = Number(process.env.AERZEN_WEB_QUESTION_COUNT ?? 180);
const OUTPUT_DIR = process.env.AERZEN_WEB_QUESTION_OUTPUT_DIR ?? path.join(process.cwd(), "reports", "knowledge");

type SourcePage = {
  title: string;
  url: string;
  model: string | null;
  category: string;
};

type QuestionBankItem = {
  id: string;
  category: string;
  question: string;
  expectedBehavior: string;
  expectedSourceUrl: string;
  expectedSourceTitle: string;
  expectedTopics: string[];
};

function baseSourceUrl(sourceUrl: string) {
  return sourceUrl.replace(/#chunk=\d+$/, "");
}

function cleanTitle(title: string) {
  return title
    .replace(/\s+-\s+Web oficial AERZEN(?:\s+-\s+parte\s+\d+)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classify(url: string, title: string) {
  const pathName = new URL(url).pathname;
  if (pathName.includes("/producto/")) {
    return "producto";
  }
  if (pathName.includes("/productos/")) {
    return "familia_producto";
  }
  if (pathName.includes("/aplicaciones/")) {
    return "aplicacion";
  }
  if (pathName.includes("/servicios/")) {
    return "servicio";
  }
  if (/catalogo/i.test(title)) {
    return "catalogo";
  }
  return "informacion_general";
}

function expectedTopics(page: SourcePage) {
  const words = page.title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4)
    .slice(0, 8);

  return Array.from(new Set([page.model, page.category, ...words].filter(Boolean) as string[]));
}

function templatesFor(page: SourcePage) {
  const title = page.title;
  const modelPhrase = page.model ? ` del modelo ${page.model}` : "";

  if (page.category === "producto") {
    return [
      `¿Qué es ${title} y para qué tipo de uso está pensado?`,
      `Explícame de forma sencilla las ventajas principales de ${title}.`,
      `¿Qué información técnica general ofrece AERZEN sobre ${title}?`,
      `¿En qué se diferencia ${title} de otras soluciones AERZEN?`,
      `¿Qué aplicaciones menciona AERZEN para ${title}?`
    ];
  }

  if (page.category === "familia_producto") {
    return [
      `¿Qué soluciones incluye AERZEN dentro de ${title}?`,
      `¿Cuándo tendría sentido elegir una solución de ${title}?`,
      `Dame una visión general de ${title} según la web oficial.`,
      `¿Qué productos o tecnologías aparecen dentro de ${title}?`,
      `¿Qué debería saber un cliente sobre ${title}?`
    ];
  }

  if (page.category === "aplicacion") {
    return [
      `¿Qué solución propone AERZEN para ${title}?`,
      `¿Qué necesidades cubre AERZEN en la aplicación ${title}?`,
      `Resume la aplicación ${title} usando sólo información de la web oficial.`,
      `¿Qué tipo de equipos AERZEN pueden encajar en ${title}?`,
      `¿Por qué es relevante ${title} para AERZEN?`
    ];
  }

  if (page.category === "servicio") {
    return [
      `¿Qué incluye el servicio de ${title}?`,
      `¿Cómo ayuda AERZEN al cliente con ${title}?`,
      `Resume ${title} según la web oficial de AERZEN.`,
      `¿Qué valor aporta ${title}${modelPhrase}?`,
      `¿Cuándo debería solicitar un cliente ${title}?`
    ];
  }

  return [
    `Quiero información general sobre ${title}.`,
    `Resume lo más importante de ${title}.`,
    `¿Qué datos oficiales hay sobre ${title}?`,
    `Explícame ${title} de forma clara.`,
    `¿Qué debería saber un cliente sobre ${title}?`
  ];
}

async function getSourcePages() {
  const docs = await prisma.authorizedDocument.findMany({
    where: {
      sourceUrl: {
        startsWith: "https://www.aerzen.com/es/"
      }
    },
    select: {
      title: true,
      model: true,
      sourceUrl: true
    },
    orderBy: {
      title: "asc"
    }
  });

  const byUrl = new Map<string, SourcePage>();
  for (const doc of docs) {
    if (!doc.sourceUrl) {
      continue;
    }

    const url = baseSourceUrl(doc.sourceUrl);
    if (byUrl.has(url)) {
      continue;
    }

    const title = cleanTitle(doc.title);
    byUrl.set(url, {
      title,
      url,
      model: doc.model,
      category: classify(url, title)
    });
  }

  return Array.from(byUrl.values());
}

function buildQuestionBank(pages: SourcePage[]) {
  const items: QuestionBankItem[] = [];
  if (pages.length === 0) {
    return items;
  }

  // Cada página aporta tantas preguntas como plantillas tenga. Si se pide un
  // objetivo mayor que el número de combinaciones posibles, el bucle tiene que
  // parar igualmente en lugar de girar para siempre.
  const templateCounts = pages.map((page) => templatesFor(page).length);
  const maxCombinations = templateCounts.reduce((total, count) => total + count, 0);
  const maxTemplates = Math.max(...templateCounts);
  const totalSteps = pages.length * maxTemplates;
  const limit = Math.min(TARGET_COUNT, maxCombinations);

  let cursor = 0;
  while (items.length < limit && cursor < totalSteps * 2) {
    const page = pages[cursor % pages.length]!;
    const templates = templatesFor(page);
    const question = templates[Math.floor(cursor / pages.length) % templates.length]!;
    const duplicate = items.some((item) => item.question === question);
    if (!duplicate) {
      items.push({
        id: `web-info-${String(items.length + 1).padStart(3, "0")}`,
        category: page.category,
        question,
        expectedBehavior:
          "Responder en español usando documentación oficial AERZEN, citar fuentes y no mezclar datos operativos como garantía, seriales o responsable.",
        expectedSourceUrl: page.url,
        expectedSourceTitle: page.title,
        expectedTopics: expectedTopics(page)
      });
    }
    cursor += 1;
  }

  if (items.length < TARGET_COUNT) {
    console.warn(
      `Aviso: solo se han podido generar ${items.length} preguntas únicas de las ${TARGET_COUNT} solicitadas ` +
        `(${pages.length} páginas x plantillas disponibles).`
    );
  }

  return items;
}

async function writeOutputs(items: QuestionBankItem[]) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(OUTPUT_DIR, `aerzen-web-question-bank-${timestamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `aerzen-web-question-bank-${timestamp}.md`);

  await writeFile(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: items.length, items }, null, 2));
  await writeFile(
    mdPath,
    [
      "# Batería de preguntas web AERZEN",
      "",
      `Generadas: ${items.length}`,
      "",
      ...items.map(
        (item) =>
          `## ${item.id} · ${item.category}\n\n` +
          `**Pregunta:** ${item.question}\n\n` +
          `**Fuente esperada:** [${item.expectedSourceTitle}](${item.expectedSourceUrl})\n\n` +
          `**Comportamiento esperado:** ${item.expectedBehavior}\n`
      )
    ].join("\n")
  );

  return { jsonPath, mdPath };
}

async function main() {
  const pages = await getSourcePages();
  const items = buildQuestionBank(pages);
  const outputs = await writeOutputs(items);
  console.log(`Generadas ${items.length} preguntas sobre ${pages.length} páginas fuente.`);
  console.log(`JSON: ${outputs.jsonPath}`);
  console.log(`MD: ${outputs.mdPath}`);
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
