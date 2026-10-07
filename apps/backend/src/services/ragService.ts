import type { AuthorizedAnswer } from "../types/chat.js";
import { createConversationalAI } from "../ai/index.js";
import { prisma } from "../db/prisma.js";
import { normalizeText } from "../utils/format.js";
import { VectorKnowledgeBase } from "./vectorKnowledgeBase.js";

export class RagService {
  private readonly conversationalAI = createConversationalAI();

  constructor(private readonly knowledgeBase = new VectorKnowledgeBase()) {}

  async answerGeneralInformation(question: string, model?: string): Promise<AuthorizedAnswer> {
    const resolvedModel = this.canonicalizeModelName(model);
    const guidedReply = this.getGuidedGeneralReply(question);
    if (guidedReply) {
      return {
        answer: guidedReply,
        documents: [],
        aiUsed: false
      };
    }

    const broadGeneralQuestion = this.isBroadGeneralQuestion(question, resolvedModel);
    const retrievalQuestion = broadGeneralQuestion
      ? `${question} ${resolvedModel ?? ""} productos AERZEN caracteristicas aplicaciones ventajas gama tecnica soplante compresor`
      : question;

    const documents = this.prioritizeGeneralDocuments(
      await this.searchGeneralDocuments(retrievalQuestion, resolvedModel, {
        broad: broadGeneralQuestion
      })
    );
    if (documents.length === 0) {
      return {
        answer:
          broadGeneralQuestion
            ? "AERZEN trabaja principalmente con soplantes, compresores, turbosoplantes y bombas de vacío para aplicaciones industriales. Para orientarle mejor, ¿para qué uso o sector lo necesita?"
            : "No tengo suficiente información para responder con seguridad. ¿Quiere que lo enfoquemos por catálogo, aplicación, servicio postventa o manuales?",
        documents: [],
        aiUsed: false
      };
    }

    const explicitModelOverview = await this.buildExplicitGeneralModelOverview(question, resolvedModel, documents, broadGeneralQuestion);
    if (explicitModelOverview) {
      return {
        answer: explicitModelOverview,
        documents,
        aiUsed: false
      };
    }

    let answer = this.buildGeneralInformationFallback(documents, question);
    let aiUsed = false;
    if (this.conversationalAI.answerFromDocuments) {
      try {
        answer = await this.conversationalAI.answerFromDocuments({
          question:
            `${question}\n\n` +
            "Instrucción de conversación: responde en máximo 65 palabras, sin markdown, sin listas largas y termina con una sola pregunta útil para concretar.",
          model: resolvedModel,
          documents: this.prepareDocumentsForAI(documents, 5, 2200, question)
        });
        aiUsed = this.conversationalAI.isEnabled();
      } catch {
        answer = this.buildGeneralInformationFallback(documents, question);
      }
    }

    return {
      answer: this.cleanUserFacingGeneralAnswer(answer),
      documents,
      aiUsed
    };
  }

  async answerIssueGuidance(args: { issueDescription: string; model?: string; serialNumber?: string }): Promise<AuthorizedAnswer> {
    const documents = await this.getOfficialManualContext(args);
    const hasStructuredAnomalyDocs = documents.some(
      (document) => /anomal[ií]a:/i.test(document.title) && /Posibles causas:/i.test(document.content) && /Remedios?:/i.test(document.content)
    );

    if (documents.length === 0) {
      return {
        answer:
          "No he encontrado una guía suficientemente específica para esta avería. Para evitar indicaciones poco fiables, lo mejor es que lo revise el responsable de zona.",
        documents: [],
        aiUsed: false,
        needsHumanHandoff: true,
        offersManual: false
      };
    }

    const structuredAnomaly = this.findStructuredAnomalyDocument(documents, args.issueDescription);
    if (structuredAnomaly) {
      return {
        answer: this.buildStructuredAnomalyAnswer(structuredAnomaly),
        documents: [structuredAnomaly.document, ...documents.filter((document) => document.id !== structuredAnomaly.document.id)].slice(0, 4),
        aiUsed: false,
        needsHumanHandoff: false,
        offersManual: true
      };
    }

    if (hasStructuredAnomalyDocs) {
      return {
        answer:
          "No he podido localizar una fila exacta y fiable de la tabla de anomalías para esa descripción. Para evitar indicaciones imprecisas, prefiero que lo revise el responsable de zona o facilitarle el manual oficial.",
        documents,
        aiUsed: false,
        needsHumanHandoff: true,
        offersManual: false
      };
    }

    let answer = this.buildIssueGuidanceFallback(documents, args.issueDescription);
    let aiUsed = false;

    if (this.conversationalAI.answerFromDocuments) {
      try {
        answer = await this.conversationalAI.answerFromDocuments({
          question:
            `Incidencia comunicada por el cliente: ${args.issueDescription}. ` +
            `Modelo: ${args.model ?? "no indicado"}. ` +
            `Serie: ${args.serialNumber ?? "no aportada"}. ` +
            "Propón máximo 3 comprobaciones iniciales seguras y basadas solo en texto explícito de los manuales o PDF oficiales aportados. " +
            "No menciones sensores, paneles, ajustes, umbrales, cables ni procedimientos si no aparecen literalmente en las fuentes. " +
            "Si el PDF oficial contiene una tabla, sección o instrucción relacionada con la avería, sintetiza esas causas y remedios de forma breve y directa. " +
            "No termines con una pregunta, porque el flujo conversacional la añadirá después. " +
            "Si las fuentes no contienen una solución concreta para la avería, dilo y recomienda derivar a responsable de zona.",
          model: args.model,
          documents: this.prepareDocumentsForAI(documents, 3, 350, args.issueDescription)
        });
        aiUsed = this.conversationalAI.isEnabled();
      } catch {
        answer = this.buildIssueGuidanceFallback(documents, args.issueDescription);
      }
    }

    return {
      answer,
      documents,
      aiUsed,
      needsHumanHandoff: /no hay base suficiente|no contiene una soluci[oó]n|no incluye instrucciones|no he encontrado una guia suficientemente especifica/i.test(
        normalizeText(answer)
      ),
      offersManual: false
    };
  }

  private isBroadGeneralQuestion(question: string, model?: string) {
    const normalized = question
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (model?.trim()) {
      return /informacion general|info general|informacion sobre|informacion del modelo|caracteristicas|especificaciones|datos tecnicos|datos tecnicos|que es|que hace|que tipo de equipo|sobre ese modelo|sobre este modelo/.test(
        normalized
      );
    }

    const hasSpecificTopic = [
      "delta",
      "blower",
      "hybrid",
      "manual",
      "mantenimiento",
      "garantia",
      "aceite",
      "placa",
      "averia",
      "aplicaciones",
      "soplante",
      "compresor",
      "modelo"
    ].some((term) => normalized.includes(term));

    const asksCompanyOffer = /que vende|q vende|oferta|empresa|productos|servicios|soluciones|catalogo/.test(normalized);

    return !hasSpecificTopic && (/informacion|consulta|duda|general|ayuda/.test(normalized) || asksCompanyOffer);
  }

  private getGuidedGeneralReply(question: string) {
    const normalized = normalizeText(question);
    const compact = normalized.replace(/[.,;:!?]/g, " ").replace(/\s+/g, " ").trim();

    if (/^(consulta general|informacion general|info general|general|quiero informacion|necesito informacion)$/.test(compact)) {
      return "Perfecto. ¿Quiere información sobre catálogo de máquinas, aplicaciones, servicios postventa o manuales?";
    }

    if (
      /catalogo|maquinas|maquinaria|equipos|productos|que vende|que maquinas|q maquinas|q vende|venden|vendeis|vend[eé]is/.test(compact)
    ) {
      return "AERZEN trabaja con soplantes, compresores, turbosoplantes y bombas de vacío. Para recomendarle bien, ¿para qué aplicación lo necesita: aguas, biogás, cemento, química/procesos o transporte neumático?";
    }

    return null;
  }

  private cleanUserFacingGeneralAnswer(answer: string) {
    return answer
      .replace(/^#+\s*/gm, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/\n?\s*Fuentes:\s*[\s\S]*$/i, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  private prepareDocumentsForAI(
    documents: AuthorizedAnswer["documents"],
    maxDocuments = 5,
    maxCharacters = 2200,
    focusQuery?: string
  ) {
    return documents.slice(0, maxDocuments).map((document) => ({
      title: document.title,
      content: focusQuery
        ? this.extractRelevantExcerpt(document.content, focusQuery, maxCharacters)
        : document.content.slice(0, maxCharacters),
      sourceUrl: document.sourceUrl
    }));
  }

  private prioritizeManualDocuments(documents: AuthorizedAnswer["documents"]) {
    return [...documents].sort((left, right) => {
      const leftIsManual = /manual|aver[ií]a|mantenimiento|servicio/i.test(`${left.title} ${left.sourceUrl ?? ""}`) ? 1 : 0;
      const rightIsManual = /manual|aver[ií]a|mantenimiento|servicio/i.test(`${right.title} ${right.sourceUrl ?? ""}`) ? 1 : 0;
      return rightIsManual - leftIsManual || right.score - left.score;
    });
  }

  private prioritizeGeneralDocuments(documents: AuthorizedAnswer["documents"]) {
    return [...documents].sort((left, right) => {
      const leftWebScore = this.isOfficialWebDocument(left.sourceUrl) ? 1 : 0;
      const rightWebScore = this.isOfficialWebDocument(right.sourceUrl) ? 1 : 0;
      const leftManualPenalty = /manual|aver[ií]a|mantenimiento/i.test(`${left.title} ${left.sourceUrl ?? ""}`) ? 1 : 0;
      const rightManualPenalty = /manual|aver[ií]a|mantenimiento/i.test(`${right.title} ${right.sourceUrl ?? ""}`) ? 1 : 0;
      const leftSpecificPenalty = this.isSpecificOperationalDocument(left) ? 1 : 0;
      const rightSpecificPenalty = this.isSpecificOperationalDocument(right) ? 1 : 0;
      return rightWebScore - leftWebScore || leftSpecificPenalty - rightSpecificPenalty || leftManualPenalty - rightManualPenalty || right.score - left.score;
    });
  }

  private isOfficialWebDocument(sourceUrl?: string | null) {
    return Boolean(
      sourceUrl &&
        /^https:\/\/(www2\.)?www\.aerzen\.com\//.test(sourceUrl)
    );
  }

  private isSpecificOperationalDocument(document: AuthorizedAnswer["documents"][number]) {
    return /placa|garantia|garant[ií]a|numero de serie|n[uú]mero de serie|fabricaci[oó]n/i.test(
      `${document.title} ${document.content} ${document.sourceUrl ?? ""}`
    );
  }

  private async searchGeneralDocuments(question: string, model?: string, options?: { broad?: boolean }) {
    const candidates = this.expandGeneralInfoModels(model);
    const searches = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        results: await this.knowledgeBase.search(
          `${question} ${candidate ?? ""} ${options?.broad ? "caracteristicas aplicaciones ventajas datos tecnicos gama" : ""}`.trim(),
          { model: candidate, language: "es" }
        )
      }))
    );

    const deduped = new Map<string, AuthorizedAnswer["documents"][number]>();
    for (const { candidate, results } of searches) {
      for (const result of results) {
        const existing = deduped.get(result.id);
        const boosted = {
          ...result,
          score: result.score + (candidate !== model && this.isOfficialWebDocument(result.sourceUrl) ? 0.15 : 0)
        };
        if (!existing || boosted.score > existing.score) {
          deduped.set(result.id, boosted);
        }
      }
    }

    const documents = Array.from(deduped.values());
    if (options?.broad) {
      const officialProductDocs = documents.filter(
        (document) =>
          this.isOfficialWebDocument(document.sourceUrl) &&
          !/manual|mantenimiento|placa|garantia|garant[ií]a/i.test(`${document.title} ${document.content}`) &&
          /producto|productos|delta|blower|hybrid|compresor|soplante|aplicaciones|caudal|presion|presión|ventajas|datos tecnicos|datos técnicos/i.test(
            `${document.title} ${document.content} ${document.sourceUrl ?? ""}`
          )
      );
      if (officialProductDocs.length > 0) {
        return officialProductDocs;
      }

      return documents.filter((document) => !this.isSpecificOperationalDocument(document) && !/manual|mantenimiento/i.test(`${document.title} ${document.sourceUrl ?? ""}`));
    }
    return documents;
  }

  private async getOfficialManualContext(args: { issueDescription: string; model?: string }) {
    const manualDocuments = await this.findManualDocumentsForModel(args.model);
    if (manualDocuments.length > 0) {
      const prioritizedStructured = manualDocuments
        .filter((document) => /anomal[ií]a:/i.test(document.title) && /Posibles causas:/i.test(document.content) && /Remedios?:/i.test(document.content))
        .map((document) => ({
          ...document,
          score: document.score + this.scoreStructuredAnomalyCandidate(document, args.issueDescription)
        }))
        .filter((document) => document.score > 3)
        .sort((left, right) => right.score - left.score);

      const ranked = this.rankDocumentsByIssue(manualDocuments, args.issueDescription);
      const deduped = new Map<string, AuthorizedAnswer["documents"][number]>();

      for (const document of [...prioritizedStructured, ...ranked]) {
        if (!deduped.has(document.id)) {
          deduped.set(document.id, document);
        }
      }

      return Array.from(deduped.values()).slice(0, 6);
    }

    const query = [
      args.model,
      args.issueDescription,
      "manual mantenimiento averia comprobaciones solucion"
    ]
      .filter(Boolean)
      .join(" ");

    return this.prioritizeManualDocuments(await this.knowledgeBase.search(query, { model: args.model, language: "es" }));
  }

  private async findManualDocumentsForModel(model?: string) {
    if (!model?.trim()) {
      return [];
    }

    const expandedModels = this.expandManualSearchModels(model);
    const normalizedModels = expandedModels.map((candidate) => normalizeText(candidate));
    const documents = await prisma.authorizedDocument.findMany({
      where: {
        language: "es",
        OR: [{ title: { contains: "manual", mode: "insensitive" } }, { sourceUrl: { startsWith: "local://Manual" } }]
      }
    });

    return documents
      .filter((document) => {
        const haystack = normalizeText(`${document.model ?? ""} ${document.title} ${document.sourceUrl ?? ""}`);
        return normalizedModels.some((normalizedModel) => {
          const normalizedDocumentModel = normalizeText(document.model ?? "");
          return (
            haystack.includes(normalizedModel) ||
            normalizedModel.includes(normalizedDocumentModel) ||
            this.modelAliases(normalizedModel).some((alias) => haystack.includes(alias))
          );
        });
      })
      .map((document) => ({
        id: document.id,
        title: document.title,
        content: document.content,
        model: document.model,
        language: document.language,
        sourceUrl: document.sourceUrl,
        score: 1
      }));
  }

  private rankDocumentsByIssue(documents: AuthorizedAnswer["documents"], issueDescription: string) {
    const stopWords = new Set([
      "equipo",
      "tiene",
      "para",
      "problema",
      "maquina",
      "averia",
      "incidencia",
      "presenta",
      "muestra"
    ]);
    const issueTokens = new Set(
      normalizeText(issueDescription)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 3 && !stopWords.has(token))
    );

    return documents
      .map((document) => {
        const content = normalizeText(`${document.title} ${document.content}`);
        const normalizedIssue = normalizeText(issueDescription);
        const directScore = Array.from(issueTokens).reduce((score, token) => score + (content.includes(token) ? 1 : 0), 0);
        const exactPhraseScore = normalizedIssue.length > 8 && content.includes(normalizedIssue) ? 10 : 0;
        const phraseScore = [
          "calentamiento excessivo de la soplante",
          "calentamiento excesivo de la soplante",
          "ruidos anormales durante el funcionamiento",
          "tabla de anomalias",
          "filtro de aspiracion colmatado",
          "elevada temperatura ambiente",
          "temperatura de aspiracion",
          "temperaturas de impulsion",
          "limites tecnicos",
          "puesta en marcha",
          "funcionamiento",
          "mantenimiento",
          "desconexion"
        ].reduce((score, phrase) => score + (content.includes(phrase) ? 2 : 0), 0);
        const troubleshootingScore = /aver[ií]a|fallo|alarma|temperatura|mantenimiento|comprobaci[oó]n|soluci[oó]n/i.test(
          document.content
        )
          ? 3
          : 0;
        const tableBoost = /tabla de anomalias|posibles causas|remedio/i.test(content) ? 4 : 0;
        const indexPenalty = /\bindice\b|\bhoja\b/.test(content) ? 4 : 0;
        return {
          ...document,
          score: exactPhraseScore + directScore + phraseScore + troubleshootingScore + tableBoost + document.score - indexPenalty
        };
      })
      .sort((left, right) => right.score - left.score);
  }

  private buildIssueGuidanceFallback(documents: AuthorizedAnswer["documents"], issueDescription: string) {
    const checks = this.extractSafeChecksFromManual(documents, issueDescription);

    return [
      "He revisado el manual oficial del modelo con la avería indicada.",
      checks.length > 0
        ? "El PDF apunta a estas comprobaciones iniciales seguras:"
        : "No he encontrado una instrucción cerrada en el PDF para resolver esa avería concreta.",
      checks.length > 0 ? checks.map((check) => `- ${check}`).join("\n") : "",
      "Si estas comprobaciones no aclaran la causa, conviene derivarlo al responsable de zona.",
      `Fuentes: ${documents
        .slice(0, 3)
        .map((document) => document.title)
        .join("; ")}.`
    ].join("\n");
  }

  private findStructuredAnomalyDocument(documents: AuthorizedAnswer["documents"], issueDescription: string) {
    const candidates = documents
      .filter((document) => /anomal[ií]a:/i.test(document.title) && /Posibles causas:/i.test(document.content) && /Remedios?:/i.test(document.content))
      .map((document) => {
        const anomalyLine = document.content.match(/Anomal[ií]a:\s*(.+)/i)?.[1]?.trim() ?? document.title;
        return {
          document,
          anomalyLine,
          score: this.scoreStructuredAnomalyCandidate(document, issueDescription),
          isCleanTitle: anomalyLine.length < 90
        };
      })
      .sort((left, right) => right.score - left.score);

    if (!candidates[0] || candidates[0].score < 5 || !candidates[0].isCleanTitle) {
      return null;
    }

    const parsed = this.parseStructuredAnomalyDocument(candidates[0].document.content);
    if (!parsed || parsed.possibleCauses.length === 0 || parsed.remedies.length === 0) {
      return null;
    }

    return {
      document: candidates[0].document,
      parsed
    };
  }

  private scoreStructuredAnomalyCandidate(document: AuthorizedAnswer["documents"][number], issueDescription: string) {
    const normalizedIssue = normalizeText(issueDescription);
    const issueTokens = normalizedIssue.split(/[^a-z0-9]+/).filter((token) => token.length > 3);
    const anomalyLine = document.content.match(/Anomal[ií]a:\s*(.+)/i)?.[1]?.trim() ?? document.title;
    const normalizedAnomaly = normalizeText(anomalyLine);
    const anomalyTokens = normalizedAnomaly.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    const tokenMatches = issueTokens.reduce(
      (matches, token) =>
        matches +
        (anomalyTokens.some(
          (candidate) =>
            candidate.includes(token) ||
            token.includes(candidate) ||
            this.tokenEditDistance(candidate, token) <= 1
        )
          ? 1
          : 0),
      0
    );
    const exactMatch = normalizedAnomaly.includes(normalizedIssue) || normalizedIssue.includes(normalizedAnomaly) ? 10 : 0;
    const titleScore = /anomal[ií]a:/i.test(document.title) ? 2 : 0;
    return exactMatch + tokenMatches + titleScore;
  }

  private tokenEditDistance(left: string, right: string) {
    if (left === right) {
      return 0;
    }

    if (Math.abs(left.length - right.length) > 1) {
      return 2;
    }

    const rows = left.length + 1;
    const cols = right.length + 1;
    const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

    for (let row = 0; row < rows; row += 1) {
      matrix[row]![0] = row;
    }
    for (let col = 0; col < cols; col += 1) {
      matrix[0]![col] = col;
    }

    for (let row = 1; row < rows; row += 1) {
      for (let col = 1; col < cols; col += 1) {
        const substitutionCost = left[row - 1] === right[col - 1] ? 0 : 1;
        matrix[row]![col] = Math.min(
          matrix[row - 1]![col]! + 1,
          matrix[row]![col - 1]! + 1,
          matrix[row - 1]![col - 1]! + substitutionCost
        );
      }
    }

    return matrix[rows - 1]![cols - 1]!;
  }

  private parseStructuredAnomalyDocument(content: string) {
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const anomaly = lines.find((line) => /^Anomal[ií]a:/i.test(line))?.replace(/^Anomal[ií]a:\s*/i, "").trim();
    if (!anomaly) {
      return null;
    }

    const causesIndex = lines.findIndex((line) => /^Posibles causas:/i.test(line));
    const remediesIndex = lines.findIndex((line) => /^Remedios?:/i.test(line));
    if (causesIndex === -1 || remediesIndex === -1 || remediesIndex <= causesIndex) {
      return null;
    }

    const possibleCauses = lines
      .slice(causesIndex + 1, remediesIndex)
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter((line) => line.length > 2);
    const remedies = lines
      .slice(remediesIndex + 1)
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter((line) => line.length > 2);

    const cleaned = this.cleanStructuredAnomalyLists(possibleCauses, remedies);

    return {
      anomaly,
      possibleCauses: cleaned.possibleCauses,
      remedies: cleaned.remedies
    };
  }

  private buildStructuredAnomalyAnswer(input: {
    parsed: { anomaly: string; possibleCauses: string[]; remedies: string[] };
  }) {
    const anomaly = this.cleanStructuredAnomalyText(input.parsed.anomaly).replace(/[.]+$/g, "");
    const possibleCauses = input.parsed.possibleCauses.map((line) => this.cleanStructuredAnomalyText(line));
    const remedies = this.dedupeStructuredLines(
      input.parsed.remedies
      .flatMap((line) => this.splitCombinedRemedyLine(this.cleanStructuredAnomalyText(line)))
      .map((line) => this.cleanStructuredAnomalyText(line))
    );

    return [
      `Para la anomalía "${anomaly}", el manual oficial indica:`,
      "",
      "Posibles causas:",
      ...possibleCauses.slice(0, 6).map((cause) => `- ${cause}`),
      "",
      "Remedios recomendados:",
      ...remedies.slice(0, 6).map((remedy) => `- ${remedy}`),
      "",
      "Si quiere, puedo facilitarle el manual oficial."
    ].join("\n");
  }

  private buildGeneralInformationFallback(documents: AuthorizedAnswer["documents"], question: string) {
    const sources = documents
      .slice(0, 3)
      .map((document) => document.title)
      .join("; ");
    const excerpts = documents
      .slice(0, 2)
      .map((document) => `- ${this.extractRelevantExcerpt(document.content, question)}`)
      .join("\n");

    return [
      "He encontrado información relacionada con su consulta.",
      "Resumen:",
      excerpts,
      "Si quiere, puedo concretarlo sobre un modelo, mantenimiento, manual o aplicación específica.",
      `Fuentes: ${sources}.`
    ].join("\n");
  }

  private cleanStructuredAnomalyLists(possibleCauses: string[], remedies: string[]) {
    const remedyVerbs =
      /^(limpiar|sustituir|controlar|comparar|compara|medir|corregir|vaciar|asegurar|cumplir|consultar|reparar)\b/i;
    const misplacedRemedies = possibleCauses.filter((line) => remedyVerbs.test(line));
    const cleanedCauses = this.mergeBrokenBulletLines(possibleCauses.filter((line) => !remedyVerbs.test(line)));
    const cleanedRemedies = this.mergeBrokenBulletLines([...misplacedRemedies, ...remedies]);

    return {
      possibleCauses: [...new Set(cleanedCauses)],
      remedies: [...new Set(cleanedRemedies)]
    };
  }

  private mergeBrokenBulletLines(lines: string[]) {
    const merged: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) {
        continue;
      }

      const previous = merged.at(-1);
      const previousLine = previous ?? "";
      const shouldAttach =
        Boolean(previous) &&
        (/^[a-záéíóúñ]/.test(line) ||
          /[,/:-]$/.test(previousLine) ||
          /\b(de|del|la|las|los|en|con|y)\s*$/i.test(previousLine));

      if (shouldAttach && previous) {
        merged[merged.length - 1] = `${previous} ${line}`.replace(/\s+/g, " ").trim();
        continue;
      }

      merged.push(line);
    }

    return merged.filter((line) => line.length > 3);
  }

  private splitCombinedRemedyLine(line: string) {
    if (/compar/i.test(line) && /si es necesario/i.test(line)) {
      const [first, second] = line.split(/(?=Si es necesario)/i);
      return [first?.trim() ?? line, second?.trim() ?? ""].filter(Boolean);
    }

    return [line];
  }

  private dedupeStructuredLines(lines: string[]) {
    const unique: string[] = [];

    for (const line of lines) {
      const normalizedLine = normalizeText(line);
      if (
        unique.some((existing) => {
          const normalizedExisting = normalizeText(existing);
          return normalizedExisting === normalizedLine || normalizedExisting.includes(normalizedLine) || normalizedLine.includes(normalizedExisting);
        })
      ) {
        continue;
      }

      unique.push(line);
    }

    return unique;
  }

  private cleanStructuredAnomalyText(value: string) {
    return value
      .replace(/\baspiracior\b/gi, "aspiración")
      .replace(/\baspiraciorn\b/gi, "aspiración")
      .replace(/\baspiracior\b/gi, "aspiración")
      .replace(/\baspiracior\b/gi, "aspiración")
      .replace(/\baspiraciór\b/gi, "aspiración")
      .replace(/\bestanqueid\b/gi, "estanqueidad")
      .replace(/\btuberias\b/gi, "tuberías")
      .replace(/\bdimensioamiento\b/gi, "dimensionamiento")
      .replace(/\bsi necesario\b/gi, "si es necesario")
      .replace(/\bcompara con diagrama de\b/gi, "Comparar con el diagrama de curvas")
      .replace(/\bsustitui\b/gi, "sustituir")
      .replace(/^dimensionamiento\b/, "Dimensionamiento")
      .replace(/^limpiar,\s*si es necesario,\s*sustituir$/i, "Limpiar y, si es necesario, sustituir")
      .replace(/^si es necesario,\s*sustituir$/i, "Sustituir si es necesario")
      .replace(/\s+,/g, ",")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/,$/, "");
  }

  private async buildExplicitGeneralModelOverview(
    question: string,
    model: string | undefined,
    documents: AuthorizedAnswer["documents"],
    broadGeneralQuestion: boolean
  ) {
    if (!model?.trim() || !broadGeneralQuestion) {
      return null;
    }

    const normalizedModel = normalizeText(model);
    if (!/^gm\s*\d+/.test(normalizedModel)) {
      return null;
    }

    const supplementaryDocs = await this.knowledgeBase.search(`${model} Delta Blower GM 35S soplante embolos rotativos`, {
      model: "Delta Blower",
      language: "es"
    });
    const combinedDocs = [...documents, ...supplementaryDocs].filter(
      (document, index, all) => all.findIndex((candidate) => candidate.id === document.id) === index
    );
    const corpus = normalizeText(combinedDocs.map((document) => `${document.title}\n${document.content}`).join("\n"));
    const hasDeltaBlowerFamily = /delta blower|agregados de soplante|embolos rotativos|desplazamiento positivo/.test(corpus);

    if (!hasDeltaBlowerFamily) {
      return null;
    }

    const details: string[] = [
      `${model} forma parte de la familia Delta Blower de AERZEN, una gama de soplantes de desplazamiento positivo o de émbolos rotativos.`
    ];

    if (/gm 3s a gm 400l|gm 3s-400l|gm 3s a 400l/.test(corpus) || /gm 35s/.test(corpus)) {
      details.push(`En el manual de Delta Blower aparece dentro de la gama GM, que cubre tamaños desde GM 3S hasta GM 400L.`);
    }

    if (/gm 35s 3,00 l|gm 35s 3 00 l/.test(corpus)) {
      details.push(`La documentación de mantenimiento menciona para GM 35S una capacidad aproximada de aceite de 3,00 l.`);
    }

    const officialWebDoc = combinedDocs.find((document) => this.isOfficialWebDocument(document.sourceUrl));
    if (officialWebDoc) {
      // Solo se afirman cifras que aparezcan literalmente en el corpus recuperado.
      const claims: string[] = [];
      if (/\b60\b/.test(corpus) && /12\.?000/.test(corpus)) {
        claims.push("rangos de caudal del orden de 60 a 12.000 m³/h");
      }
      if (/-?\s?500\s/.test(corpus) && /1\.?000\s*mbar/.test(corpus)) {
        claims.push("presión diferencial de -500 a 1.000 mbar según la versión");
      }

      const presentation = /exenta de aceite|libre de aceite/.test(corpus)
        ? "una unidad compacta exenta de aceite"
        : "una unidad compacta";

      details.push(
        claims.length > 0
          ? `En la web oficial, Delta Blower se presenta como ${presentation} para aplicaciones industriales, con ${claims.join(" y ")}.`
          : `En la web oficial, Delta Blower se presenta como ${presentation} para aplicaciones industriales.`
      );
    }

    details.push("Si quiere, puedo concretarle mantenimiento, manual, averías habituales o documentación técnica del tamaño GM 35.");

    return details.join(" ");
  }

  private extractSafeChecksFromManual(documents: AuthorizedAnswer["documents"], issueDescription: string) {
    const snippets = this.extractIssueSnippets(documents, issueDescription);
    const bulletChecks = snippets
      .flatMap((snippet) =>
        snippet
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("-"))
          .map((line) => line.replace(/^-\s*/, "").replace(/\s+/g, " ").trim())
      )
      .filter((line) => line.length > 12);

    if (bulletChecks.length > 0) {
      return [...new Set(bulletChecks)].slice(0, 3);
    }

    const sentenceChecks = snippets
      .flatMap((snippet) =>
        snippet
          .replace(/\s+/g, " ")
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.trim())
          .filter((sentence) => sentence.length > 30)
      )
      .filter((sentence) => !/^pagina\s+\d+/i.test(sentence));

    return [...new Set(sentenceChecks)].slice(0, 3);
  }

  private extractIssueSnippets(documents: AuthorizedAnswer["documents"], issueDescription: string) {
    const issueTerms = normalizeText(issueDescription)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3);

    return documents
      .map((document) => {
        const snippet = this.extractRelevantExcerpt(document.content, issueDescription, 500);
        const normalizedSnippet = normalizeText(snippet);
        const termMatches = issueTerms.reduce((matches, term) => matches + (normalizedSnippet.includes(term) ? 1 : 0), 0);
        const troubleshootingBoost = /anomalia|anomalias|averia|averias|reparacion|mantenimiento|remedio|posibles causas/i.test(
          `${document.title} ${document.content}`
        )
          ? 2
          : 0;

        return {
          snippet,
          score: termMatches + troubleshootingBoost + document.score
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.snippet);
  }

  private extractRelevantExcerpt(content: string, issueDescription: string, maxLength = 520) {
    const terms = normalizeText(issueDescription)
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length > 4);
    const normalizedContent = normalizeText(content);
    const firstMatch = terms.map((term) => normalizedContent.indexOf(term)).find((index) => index >= 0) ?? 0;
    const start = Math.max(0, firstMatch - 220);
    const excerpt = content.slice(start, start + maxLength).replace(/\s+/g, " ").trim();
    return excerpt.length >= maxLength ? `${excerpt.slice(0, maxLength - 20)}...` : excerpt;
  }

  private modelAliases(normalizedModel: string) {
    if (/^gm\s*\d+/.test(normalizedModel)) {
      return ["gm", "delta blower", "blower"];
    }
    if (normalizedModel.includes("delta blower")) {
      return ["delta blower", "blower"];
    }
    if (normalizedModel.includes("delta hybrid")) {
      return ["delta hybrid", "hybrid"];
    }
    return [normalizedModel];
  }

  private canonicalizeModelName(model?: string) {
    if (!model?.trim()) {
      return model;
    }

    const compact = normalizeText(model).replace(/\s+/g, "");
    const gmMatch = compact.match(/^gm(\d{1,3})$/);
    if (gmMatch) {
      return `GM ${gmMatch[1]}`;
    }

    const vmxMatch = compact.match(/^vmx(\d{1,3})$/);
    if (vmxMatch) {
      return `VMX ${vmxMatch[1]}`;
    }

    return model;
  }

  private expandManualSearchModels(model?: string) {
    if (!model?.trim()) {
      return [];
    }

    const canonical = this.canonicalizeModelName(model) ?? model;
    const normalizedModel = normalizeText(canonical);
    const expanded = new Set<string>([canonical, model]);

    if (/^gm\s*\d+/.test(normalizedModel)) {
      expanded.add("Delta Blower");
    }
    if (/^vmx\s*\d+/.test(normalizedModel)) {
      expanded.add("VMX 160");
    }
    if (normalizedModel.includes("delta hybrid")) {
      expanded.add("Delta Hybrid");
    }

    return Array.from(expanded);
  }

  private expandGeneralInfoModels(model?: string) {
    if (!model?.trim()) {
      return [undefined];
    }

    const normalizedModel = normalizeText(model);
    const expanded = new Set<string>([model]);
    if (/^gm\s*\d+/.test(normalizedModel)) {
      expanded.add("Delta Blower");
    }
    if (/^vmx\s*\d+/.test(normalizedModel)) {
      expanded.add("VMX 160");
    }
    if (normalizedModel.includes("delta hybrid d52")) {
      expanded.add("Delta Hybrid");
    }

    return Array.from(expanded);
  }
}
