import "dotenv/config";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_MANUALS_DIR = "fixtures/content/pdfs";

/**
 * Carpeta donde están los PDF de manuales. Se configura con MANUALS_DIR para que
 * el proyecto no dependa de rutas absolutas de una máquina concreta.
 */
export function getManualsDir() {
  return resolve(process.env.MANUALS_DIR?.trim() || DEFAULT_MANUALS_DIR);
}

type ManualConfig = {
  model: string;
  title: string;
  language: string;
  /** Nombres de fichero admitidos dentro de MANUALS_DIR, por orden de preferencia. */
  fileNames: string[];
  description: string;
};

type OcrLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const manualConfigs: ManualConfig[] = [
  {
    model: "Delta Blower",
    title: "Manual de servicio Delta Blower",
    language: "es",
    fileNames: ["manual-delta-blower.pdf", "Manual Delta Blower.pdf"],
    description: "Manual de servicio y mantenimiento para agregados de soplante de embolos rotativos Delta Blower."
  },
  {
    model: "Delta Hybrid",
    title: "Manual de servicio Delta Hybrid 2015",
    language: "es",
    fileNames: ["manual-delta-hybrid-2015.pdf", "MANUAL DELTA HYBRID 2015.pdf"],
    description: "Manual de servicio del compresor de embolos rotativos Delta Hybrid."
  },
  {
    model: "VML",
    title: "Manual de montaje VM/VML machine stage",
    language: "en",
    fileNames: ["manual-vml.pdf", "Manual VML.PDF"],
    description: "Assembly instructions for VM and VML machine stages."
  }
];

export function resolvePdfPath(config: ManualConfig) {
  const manualsDir = getManualsDir();
  const pdfPath = config.fileNames
    .map((fileName) => resolve(manualsDir, fileName))
    .find((candidate) => existsSync(candidate));

  if (!pdfPath) {
    throw new Error(
      `No se encontró el PDF para ${config.model} en ${manualsDir}. Ficheros probados: ${config.fileNames.join(", ")}`
    );
  }
  return pdfPath;
}

export function hasResolvablePdf(config: ManualConfig) {
  const manualsDir = getManualsDir();
  return config.fileNames.some((fileName) => existsSync(resolve(manualsDir, fileName)));
}

function extractText(pdfPath: string) {
  const scriptPath = resolve("scripts/extract_pdf_text.swift");
  return execFileSync("swift", [scriptPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
}

function extractLayout(pdfPath: string, pageNumber: number) {
  const scriptPath = resolve("scripts/extract_pdf_layout.swift");
  return execFileSync("swift", [scriptPath, pdfPath, String(pageNumber)], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
}

function splitPages(rawText: string) {
  return rawText
    .split(/\n--- PAGE \d+ ---\n/g)
    .map((page) => page.trim())
    .filter(Boolean);
}

function normalizePageText(page: string) {
  const lines = page
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const paragraphs: string[] = [];
  let current = "";

  const flushCurrent = () => {
    const compact = current.replace(/\s+/g, " ").trim();
    if (compact) {
      paragraphs.push(compact);
    }
    current = "";
  };

  for (const line of lines) {
    const isBullet = /^[-•Ü]/.test(line);
    const isHeading = /^\d+(\.\d+)*\s/.test(line) || /^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúüÜ0-9\s/().,:-]{0,90}$/.test(line);

    if (isBullet || isHeading) {
      flushCurrent();
      paragraphs.push(line.replace(/\s+/g, " ").trim());
      continue;
    }

    current = current ? `${current} ${line}` : line;
  }

  flushCurrent();
  return paragraphs.join("\n\n");
}

function chunkParagraphs(
  paragraphs: string[],
  options: { maxChars: number; minChars: number; overlapParagraphs: number }
) {
  const chunks: Array<{ content: string; paragraphStart: number; paragraphEnd: number }> = [];
  let index = 0;

  while (index < paragraphs.length) {
    let end = index;
    let content = "";

    while (end < paragraphs.length) {
      const candidate = content ? `${content}\n\n${paragraphs[end]}` : paragraphs[end];
      if (candidate.length > options.maxChars && content.length >= options.minChars) {
        break;
      }
      content = candidate;
      end += 1;
    }

    if (!content) {
      content = paragraphs[index];
      end = index + 1;
    }

    chunks.push({
      content,
      paragraphStart: index,
      paragraphEnd: end - 1
    });

    if (end >= paragraphs.length) {
      break;
    }

    index = Math.max(index + 1, end - options.overlapParagraphs);
  }

  return chunks;
}

function buildChunksFromPages(pages: string[]) {
  const chunks: Array<{ startPage: number; endPage: number; content: string }> = [];

  pages.forEach((page, pageIndex) => {
    const normalizedPage = normalizePageText(page);
    const paragraphs = normalizedPage
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    const pageChunks = chunkParagraphs(paragraphs, {
      maxChars: 1400,
      minChars: 450,
      overlapParagraphs: 1
    });

    pageChunks.forEach((chunk, chunkIndex) => {
      chunks.push({
        startPage: pageIndex + 1,
        endPage: pageIndex + 1,
        content: `Página ${pageIndex + 1}, fragmento ${chunkIndex + 1}.\n\n${chunk.content}`
      });
    });
  });

  return chunks;
}

function normalizeLineText(value: string) {
  return value
    .replace(/[•]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeAnomalyPage(page: string) {
  return /tabla de anomalias|tabla de anomalías/i.test(page) && /posibles causas/i.test(page) && /remedio/i.test(page);
}

function groupLinesByRow(lines: OcrLine[]) {
  const rows: Array<{ y: number; lines: OcrLine[] }> = [];
  const sorted = [...lines].sort((left, right) => {
    if (Math.abs(left.y - right.y) > 0.004) {
      return right.y - left.y;
    }
    return left.x - right.x;
  });

  for (const line of sorted) {
    const existing = rows.find((row) => Math.abs(row.y - line.y) <= 0.0065);
    if (existing) {
      existing.lines.push(line);
      existing.y = Math.max(existing.y, line.y);
      continue;
    }
    rows.push({ y: line.y, lines: [line] });
  }

  return rows
    .map((row) => ({
      y: row.y,
      lines: row.lines.sort((left, right) => left.x - right.x)
    }))
    .sort((left, right) => right.y - left.y);
}

function splitBulletSegments(value: string) {
  return value
    .split(/\s+-\s+/)
    .map((part, index) => (index === 0 ? part : `- ${part}`))
    .flatMap((part) => part.split(/(?=-\s)/))
    .map((part) => part.replace(/^-+\s*/, "").replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 2);
}

function parseAnomalyTableRows(layoutLines: OcrLine[]) {
  const rows = groupLinesByRow(
    layoutLines.filter((line) => line.y < 0.84 && line.y > 0.30).map((line) => ({ ...line, text: normalizeLineText(line.text) }))
  );

  const leftColumnRows = rows.filter(
    (row) =>
      row.lines.some((line) => line.x < 0.27) &&
      !row.lines.some((line) => /anomalias|posibles causas|remedio/i.test(line.text))
  );

  const anomalyAnchors: Array<{ label: string; topY: number; bottomY: number }> = [];
  let pending: { parts: string[]; topY: number; bottomY: number } | null = null;

  for (const row of leftColumnRows) {
    const leftTexts = row.lines
      .filter((line) => line.x < 0.27)
      .map((line) => line.text)
      .map((line) => line.split(/\s+-\s+/)[0]?.trim() ?? line.trim())
      .filter(Boolean);

    if (leftTexts.length === 0) {
      continue;
    }

    const leftText = leftTexts.join(" ");
    const firstChar = leftText.charAt(0);
    const startsWithUppercase = firstChar === firstChar.toUpperCase() && /[A-ZÁÉÍÓÚÑCFR]/.test(firstChar);
    const previousEndsClosed = Boolean(pending?.parts[pending.parts.length - 1]?.trim().endsWith(")"));
    const startsNewAnomaly =
      !pending ||
      Math.abs(pending.bottomY - row.y) > 0.04 ||
      (startsWithUppercase && pending.parts.length >= 2 && previousEndsClosed);

    if (startsNewAnomaly) {
      if (pending) {
        anomalyAnchors.push({
          label: pending.parts.join(" ").replace(/\s+/g, " ").trim(),
          topY: pending.topY,
          bottomY: pending.bottomY
        });
      }
      pending = { parts: [leftText], topY: row.y, bottomY: row.y };
      continue;
    }

    pending.parts.push(leftText);
    pending.bottomY = row.y;
  }

  if (pending) {
    anomalyAnchors.push({
      label: pending.parts.join(" ").replace(/\s+/g, " ").trim(),
      topY: pending.topY,
      bottomY: pending.bottomY
    });
  }

  const structuredRows = anomalyAnchors.map((anchor, index) => {
    const next = anomalyAnchors[index + 1];
    const bandTop = anchor.topY + 0.012;
    const bandBottom = next ? next.topY + 0.008 : 0.30;

    const bandRows = rows.filter((row) => row.y <= bandTop && row.y > bandBottom);
    const possibleCauses = bandRows
      .flatMap((row) => row.lines.filter((line) => line.x >= 0.27 && line.x < 0.58).flatMap((line) => splitBulletSegments(line.text)));
    const remedies = bandRows
      .flatMap((row) => row.lines.filter((line) => line.x >= 0.58).flatMap((line) => splitBulletSegments(line.text)));

    return {
      anomaly: anchor.label,
      possibleCauses: [...new Set(possibleCauses)],
      remedies: [...new Set(remedies)]
    };
  });

  return structuredRows.filter(
    (row) =>
      row.anomaly.length > 6 &&
      row.possibleCauses.length > 0 &&
      row.remedies.length > 0 &&
      !/tabla de anomalias|tabla de anomalías/i.test(row.anomaly)
  );
}

function buildStructuredAnomalyDocuments(config: ManualConfig, pdfPath: string, pages: string[]) {
  const documents: Array<{ title: string; model: string; language: string; sourceUrl: string; content: string }> = [];

  pages.forEach((page, index) => {
    if (!looksLikeAnomalyPage(page)) {
      return;
    }

    const rawLayout = extractLayout(pdfPath, index + 1);
    const layoutLines = JSON.parse(rawLayout) as OcrLine[];
    const rows = parseAnomalyTableRows(layoutLines);

    rows.forEach((row) => {
      documents.push({
        title: `${config.title} - anomalía: ${row.anomaly}`,
        model: config.model,
        language: config.language,
        sourceUrl: `local://${config.title}#page=${index + 1}&anomaly=${encodeURIComponent(row.anomaly)}`,
        content: [
          `Manual oficial: ${config.title}.`,
          `Página: ${index + 1}.`,
          `Anomalía: ${row.anomaly}.`,
          "Posibles causas:",
          ...row.possibleCauses.map((cause) => `- ${cause}`),
          "Remedios:",
          ...row.remedies.map((remedy) => `- ${remedy}`)
        ].join("\n")
      });
    });
  });

  return documents;
}

export async function importManual(config: ManualConfig) {
  const pdfPath = resolvePdfPath(config);
  const rawText = extractText(pdfPath);
  const pages = splitPages(rawText);
  const chunks = buildChunksFromPages(pages);
  const anomalyDocuments = buildStructuredAnomalyDocuments(config, pdfPath, pages);

  await prisma.manual.upsert({
    where: { model: config.model },
    update: {
      title: config.title,
      language: config.language,
      fileUrl: pdfPath,
      description: config.description
    },
    create: {
      model: config.model,
      title: config.title,
      language: config.language,
      fileUrl: pdfPath,
      description: config.description
    }
  });

  await prisma.authorizedDocument.deleteMany({
    where: {
      model: config.model,
      sourceUrl: {
        startsWith: `local://${config.title}`
      }
    }
  });

  await prisma.authorizedDocument.createMany({
    data: [
      ...chunks.map((chunk, index) => ({
        title: `${config.title} - páginas ${chunk.startPage}-${chunk.endPage} - fragmento ${index + 1}`,
        model: config.model,
        language: config.language,
        sourceUrl: `local://${config.title}#pages=${chunk.startPage}-${chunk.endPage}&chunk=${index + 1}`,
        content: chunk.content
      })),
      ...anomalyDocuments
    ]
  });

  return {
    model: config.model,
    pages: pages.length,
    chunks: chunks.length,
    anomalyDocuments: anomalyDocuments.length
  };
}

export async function importAvailableManuals() {
  const results = [];
  for (const config of manualConfigs.filter(hasResolvablePdf)) {
    results.push(await importManual(config));
  }
  return results;
}

async function main() {
  const results = [];
  for (const config of manualConfigs) {
    results.push(await importManual(config));
  }
  console.log(JSON.stringify(results, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
