import { describe, expect, it, vi } from "vitest";

vi.mock("../ai/index", () => ({
  createConversationalAI: () => ({
    isEnabled: () => false,
    analyzeTurn: vi.fn(),
    humanizeReply: vi.fn(),
    answerFromDocuments: undefined
  })
}));

vi.mock("../db/prisma", () => ({
  prisma: {
    authorizedDocument: {
      findMany: vi.fn(async ({ where }) => {
        const docs = [
          {
            id: "delta-ruidos",
            title: "Manual de servicio Delta Blower - anomalía: Ruidos anormales durante el funcionamiento",
            model: "Delta Blower",
            language: "es",
            sourceUrl: "local://Manual de servicio Delta Blower#page=22&anomaly=Ruidos%20anormales%20durante%20el%20funcionamiento",
            content:
              "Manual oficial: Manual de servicio Delta Blower.\nPágina: 22.\nAnomalía: Ruidos anormales durante el funcionamiento.\nPosibles causas:\n- Alineación de las correas\n- Rodamientos dañados\n- Suciedad en los émbolos\nRemedios:\n- medir y, si es necesario, corregir\n- Sustituir\n- Limpiar"
          },
          {
            id: "delta-caudal",
            title: "Manual de servicio Delta Blower - anomalía: Caudal de aspiraciór insuficiente",
            model: "Delta Blower",
            language: "es",
            sourceUrl: "local://Manual de servicio Delta Blower#page=22&anomaly=Caudal%20de%20aspiraci%C3%B3r%20insuficiente",
            content:
              "Manual oficial: Manual de servicio Delta Blower.\nPágina: 22.\nAnomalía: Caudal de aspiraciór insuficiente.\nPosibles causas:\n- Colmatación del filtro de arranque\n- del filtro de aspiración\n- Pérdida de estanqueid en las tuberias\nRemedios:\n- Limpiar, si necesario, sustituir\n- Controlar y sustituir las juntas\n- Compara con diagrama de curvas"
          }
        ];

        const containsInsensitive = (value: string | null | undefined, search: string) =>
          (value ?? "").toLowerCase().includes(search.toLowerCase());

        return docs.filter((document) => {
          if (where?.language && document.language !== where.language) {
            return false;
          }

          if (where?.OR?.length) {
            return where.OR.some((condition: Record<string, unknown>) => {
              if ("model" in condition && typeof condition.model === "string") {
                return document.model === condition.model;
              }
              if (
                "model" in condition &&
                typeof condition.model === "object" &&
                condition.model &&
                "contains" in (condition.model as Record<string, unknown>)
              ) {
                return containsInsensitive(document.model, String((condition.model as Record<string, unknown>).contains));
              }
              if (
                "title" in condition &&
                typeof condition.title === "object" &&
                condition.title &&
                "contains" in (condition.title as Record<string, unknown>)
              ) {
                return containsInsensitive(document.title, String((condition.title as Record<string, unknown>).contains));
              }
              if (
                "sourceUrl" in condition &&
                typeof condition.sourceUrl === "object" &&
                condition.sourceUrl &&
                "contains" in (condition.sourceUrl as Record<string, unknown>)
              ) {
                return containsInsensitive(document.sourceUrl, String((condition.sourceUrl as Record<string, unknown>).contains));
              }
              if (
                "sourceUrl" in condition &&
                typeof condition.sourceUrl === "object" &&
                condition.sourceUrl &&
                "startsWith" in (condition.sourceUrl as Record<string, unknown>)
              ) {
                return (document.sourceUrl ?? "").startsWith(String((condition.sourceUrl as Record<string, unknown>).startsWith));
              }
              return false;
            });
          }

          return true;
        });
      })
    }
  }
}));

import { RagService } from "../services/ragService.js";

describe("rag service", () => {
  it("returns structured anomaly guidance for abnormal noise", async () => {
    const knowledgeBase = {
      search: vi.fn(async () => [])
    };

    const service = new RagService(knowledgeBase as never);
    const result = await service.answerIssueGuidance({
      model: "Delta Blower",
      issueDescription: "ruidos anormales durante el funcionamiento"
    });

    expect(result.needsHumanHandoff).toBe(false);
    expect(result.offersManual).toBe(true);
    expect(result.answer).toContain('anomalía "Ruidos anormales durante el funcionamiento"');
    expect(result.answer).toContain("Posibles causas:");
    expect(result.answer).toContain("Remedios recomendados:");
    expect(result.answer).toMatch(/Alineaci[oó]n de las correas/i);
    expect(result.answer).toMatch(/Sustituir/i);
  });

  it("matches structured anomalies even with minor OCR typos", async () => {
    const knowledgeBase = {
      search: vi.fn(async () => [])
    };

    const service = new RagService(knowledgeBase as never);
    const result = await service.answerIssueGuidance({
      model: "Delta Blower",
      issueDescription: "caudal de aspiración insuficiente"
    });

    expect(result.needsHumanHandoff).toBe(false);
    expect(result.offersManual).toBe(true);
    expect(result.answer.toLowerCase()).toContain("caudal");
    expect(result.answer).toMatch(/filtro de aspiraci[oó]n/i);
    expect(result.answer).toMatch(/diagrama de curvas/i);
    expect(result.answer).toMatch(/estanqueidad/i);
  });

  it("resolves Delta Blower manuals when the customer only provides a GM model", async () => {
    const knowledgeBase = {
      search: vi.fn(async () => [])
    };

    const service = new RagService(knowledgeBase as never);
    const result = await service.answerIssueGuidance({
      model: "GM 3S",
      issueDescription: "caudal de aspiración insuficiente"
    });

    expect(result.needsHumanHandoff).toBe(false);
    expect(result.offersManual).toBe(true);
    expect(result.answer).toMatch(/caudal/i);
    expect(result.answer).toMatch(/filtro de aspiraci[oó]n/i);
  });
});
