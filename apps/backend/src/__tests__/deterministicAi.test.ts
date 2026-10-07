import { describe, expect, it } from "vitest";
import { DeterministicAI } from "../ai/deterministicAi.js";

describe("deterministic ai fallback", () => {
  it("detects greeting and keeps intent unknown", async () => {
    const ai = new DeterministicAI();
    const analysis = await ai.analyzeTurn("hola, qué tal");
    expect(analysis.isGreeting).toBe(true);
    expect(analysis.intent).toBe("unknown");
  });

  it("normalizes common model phrases", async () => {
    const ai = new DeterministicAI();
    const analysis = await ai.analyzeTurn("modelo delta hybrid");
    expect(analysis.normalizedModel).toBe("Delta Hybrid");
  });

  it("extracts serial-like values", async () => {
    const ai = new DeterministicAI();
    const analysis = await ai.analyzeTurn("si, es 9000001");
    expect(analysis.serialCandidate).toBe("9000001");
    expect(analysis.yesNo).toBe(true);
  });

  it("detects natural incident phrases", async () => {
    const ai = new DeterministicAI();
    await expect(ai.analyzeTurn("la soplante hace ruido")).resolves.toMatchObject({ intent: "incident" });
    await expect(ai.analyzeTurn("queremos soporte tecnico")).resolves.toMatchObject({ intent: "incident" });
  });

  it("understands common acceptance and rejection variants", async () => {
    const ai = new DeterministicAI();
    await expect(ai.analyzeTurn("me parece bien")).resolves.toMatchObject({ yesNo: true });
    await expect(ai.analyzeTurn("por supuesto")).resolves.toMatchObject({ yesNo: true });
    await expect(ai.analyzeTurn("prefiero que no")).resolves.toMatchObject({ yesNo: false });
  });

  it("recognizes province names as region candidates", async () => {
    const ai = new DeterministicAI();
    const analysis = await ai.analyzeTurn("estamos en cordoba");
    expect(analysis.regionCandidate).toBe("Andalucia, Extremadura y Canarias");
  });

  it("responde con un extracto acotado y cita la fuente", async () => {
    const ai = new DeterministicAI();
    const longContent = "El manual indica comprobar la alineación de las correas. ".repeat(20);

    const answer = await ai.answerFromDocuments({
      question: "ruidos anormales",
      documents: [{ title: "Manual de servicio Delta Blower", content: longContent }]
    });

    expect(answer).toContain("Fuente: Manual de servicio Delta Blower.");
    expect(answer.length).toBeLessThan(400);
    expect(answer).not.toBe(longContent);
  });

  it("avisa cuando no hay documentos", async () => {
    const ai = new DeterministicAI();

    await expect(ai.answerFromDocuments({ question: "ruidos", documents: [] })).resolves.toContain(
      "No he encontrado información suficiente"
    );
  });
});
