import { beforeEach, describe, expect, it, vi } from "vitest";

const sessions = new Map<string, { currentState: string; context: Record<string, unknown>; messages: Array<Record<string, unknown>> }>();

vi.mock("../services/sessionRepository", () => ({
  createSession: vi.fn(async (initialState: string, context: Record<string, unknown>) => {
    sessions.set(context.sessionId as string, { currentState: initialState, context, messages: [] });
    return { id: context.sessionId, currentState: initialState, context, messages: [] };
  }),
  getSession: vi.fn(async (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return {
      id: sessionId,
      currentState: session.currentState,
      context: session.context,
      messages: session.messages
    };
  }),
  saveSessionState: vi.fn(async (sessionId: string, currentState: string, context: Record<string, unknown>) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.currentState = currentState;
      session.context = context;
    }
  }),
  appendMessage: vi.fn(async (sessionId: string, message: Record<string, unknown>) => {
    const session = sessions.get(sessionId);
    session?.messages.push(message);
  }),
  buildTranscript: vi.fn(async (sessionId: string) => {
    const session = sessions.get(sessionId);
    return (
      session?.messages
        .map((message) => `${String(message.role).toUpperCase()}: ${String(message.content)}`)
        .join("\n") ?? ""
    );
  }),
  createAssistantMessage: vi.fn((content: string, citations?: unknown[]) => ({
    id: crypto.randomUUID(),
    role: "assistant",
    content,
    citations,
    createdAt: new Date().toISOString()
  })),
  createUserMessage: vi.fn((content: string) => ({
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt: new Date().toISOString()
  }))
}));

vi.mock("../tools/operationalTools", () => ({
  checkSerialNumber: vi.fn(async (serialNumber: string) => ({
    exists: serialNumber === "GM35-ES-0001" || serialNumber === "9000001",
    machineRecord:
      serialNumber === "GM35-ES-0001" || serialNumber === "9000001"
        ? { id: "machine-1", regionId: "region-1", model: "GM 35" }
        : null
  })),
  getMachineBySerial: vi.fn(async () => ({
    id: "machine-1",
    model: "GM 35",
    region: { name: "Andalucia, Extremadura y Canarias" },
    assignedWorkerId: "worker-1",
    assignedWorker: { id: "worker-1", name: "Ana Ferrer", email: "ana.ferrer@example.com" }
  })),
  getWarrantyStatus: vi.fn(async () => ({
    status: "in_warranty",
    warrantyEndDate: "2027-03-15T00:00:00.000Z"
  })),
  getAssignedWorker: vi.fn(async () => ({
    worker: { id: "worker-1", name: "Ana Ferrer", email: "ana.ferrer@example.com" }
  })),
  getRegionByCustomerOrSerial: vi.fn(async () => ({
    region: { id: "region-1", name: "Andalucia, Extremadura y Canarias" },
    worker: { id: "worker-1", name: "Ana Ferrer", email: "ana.ferrer@example.com" }
  })),
  createIncident: vi.fn(async () => ({
    incident: { id: "incident-1", reference: "INC-123456" }
  })),
  getManualForModel: vi.fn(async () => ({
    manual: { id: "manual-1", title: "Manual de operación GM 35", fileUrl: "https://docs.example.com/gm35.pdf" }
  })),
  sendTelegramIncidentNotification: vi.fn(async () => ({
    delivered: false,
    status: "missing_bot_token"
  })),
  generateHumanHandoffPayload: vi.fn(async () => ({
    handoff: { summary: "Resumen de prueba" }
  })),
  sendConversationEmail: vi.fn(async () => ({
    status: "mock_sent"
  }))
}));

vi.mock("../services/ragService", () => ({
  RagService: class {
    async answerGeneralInformation(question: string, model?: string) {
      return {
        answer: `Respuesta autorizada de prueba.${model ? ` Modelo: ${model}.` : ""} Pregunta: ${question}`,
        documents: [{ title: "Doc", sourceUrl: "https://docs.example.com/doc", content: "Contenido" }]
      };
    }

    async answerIssueGuidance() {
      return {
        answer: "Revise los puntos básicos del manual antes de derivar el caso.",
        documents: [{ title: "Manual", sourceUrl: "https://docs.example.com/manual", content: "Puntos básicos" }]
      };
    }
  }
}));

import { FlowEngine, SessionNotFoundError } from "../flow/engine.js";
import { sendTelegramIncidentNotification } from "../tools/operationalTools.js";

describe("flow engine", () => {
  beforeEach(() => {
    sessions.clear();
    vi.clearAllMocks();
  });

  it("informa de una sesión inexistente con un error tipado", async () => {
    const engine = new FlowEngine();

    await expect(engine.handleMessage("00000000-0000-4000-8000-000000000000", "hola")).rejects.toBeInstanceOf(
      SessionNotFoundError
    );
  });

  it("runs the incident flow until manual offer", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    const step1 = await engine.handleMessage(start.sessionId, "Tengo una incidencia con mi equipo");
    const step2 = await engine.handleMessage(start.sessionId, "GM 35");
    const step3 = await engine.handleMessage(start.sessionId, "Sí");
    const step4 = await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    const step5 = await engine.handleMessage(start.sessionId, "Sevilla");
    const step6 = await engine.handleMessage(start.sessionId, "El equipo muestra una alarma de temperatura");
    const step7 = await engine.handleMessage(start.sessionId, "No");
    const step8 = await engine.handleMessage(start.sessionId, "Sí");

    expect(step1.reply.content).toContain("modelo");
    expect(step2.reply.content).toContain("número de fabricación");
    expect(step3.reply.content).toContain("serie");
    expect(step4.reply.content).toContain("ciudad o provincia");
    expect(step4.state).toBe("collect_machine_location");
    expect(step5.reply.content).toContain("garantía");
    expect(step5.state).toBe("collect_issue_description");
    expect(step6.state).toBe("issue_resolution_check");
    expect(step6.reply.content).toMatch(/manual|comprobaciones/i);
    expect(step7.state).toBe("area_contact_offer");
    expect(step8.state).toBe("confirm_handoff");
  });

  it("keeps the incident open after sharing the manual and offers handoff when the user still has the problem", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "GM 35");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    await engine.handleMessage(start.sessionId, "Sevilla");
    await engine.handleMessage(start.sessionId, "El equipo muestra una alarma de temperatura");
    const solved = await engine.handleMessage(start.sessionId, "Sí");
    const manualSent = await engine.handleMessage(start.sessionId, "Sí");
    const unresolved = await engine.handleMessage(start.sessionId, "No he conseguido solucionar el problema");

    expect(solved.state).toBe("manual_offer");
    expect(manualSent.state).toBe("manual_resolution_check");
    expect(manualSent.reply.content).toContain("api/manuals/manual-1/file");
    expect(unresolved.state).toBe("area_contact_offer");
    expect(unresolved.reply.content).toMatch(/responsable|deriv/i);
  });

  it("derives after the manual when the user says the equipment still fails without using an exact canned phrase", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "GM 35");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    await engine.handleMessage(start.sessionId, "Sevilla");
    await engine.handleMessage(start.sessionId, "El equipo muestra una alarma de temperatura");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "Sí");
    const unresolved = await engine.handleMessage(start.sessionId, "Sigue fallando");

    expect(unresolved.state).toBe("area_contact_offer");
    expect(unresolved.reply.content).toMatch(/responsable|deriv/i);
  });

  it("does not offer the manual again after the incident has already been escalated", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "GM 35");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    await engine.handleMessage(start.sessionId, "Sevilla");
    await engine.handleMessage(start.sessionId, "El equipo muestra una alarma de temperatura");
    await engine.handleMessage(start.sessionId, "No");
    await engine.handleMessage(start.sessionId, "Sí");
    const escalated = await engine.handleMessage(start.sessionId, "Sí");

    expect(escalated.state).toBe("anything_else_offer");
    expect(escalated.reply.content).toMatch(/responsable de zona/i);
    expect(escalated.reply.content).not.toMatch(/manual/i);
  });

  it("sends to Telegram only the issue description as summary", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "GM 35");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    await engine.handleMessage(start.sessionId, "Sevilla");
    await engine.handleMessage(start.sessionId, "Ruido anormal durante el funcionamiento");
    await engine.handleMessage(start.sessionId, "No");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "Sí");

    expect(vi.mocked(sendTelegramIncidentNotification).mock.calls).toHaveLength(1);
    expect(vi.mocked(sendTelegramIncidentNotification).mock.calls[0]?.[0]).toMatchObject({
      summary: "Ruido anormal durante el funcionamiento",
      model: "GM 35",
      serialNumber: "GM35-ES-0001",
      locality: "Sevilla"
    });
  });

  it("accepts serial in the same turn after confirming availability", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "Delta Hybrid");
    const response = await engine.handleMessage(start.sessionId, "Sí, es 9000001");

    expect(response.reply.content).toContain("número de serie");
    expect(response.reply.content).toContain("ciudad o provincia");
    expect(response.state).toBe("collect_machine_location");
  });

  it("asks for the serial again and escalates on the second failure", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "Delta Blower");
    await engine.handleMessage(start.sessionId, "Sí");
    const firstAttempt = await engine.handleMessage(start.sessionId, "99999");
    const secondAttempt = await engine.handleMessage(start.sessionId, "88888");

    expect(firstAttempt.state).toBe("collect_serial");
    expect(firstAttempt.reply.content).toMatch(/no aparece en la base|vuelva a indicarmelo/i);
    expect(secondAttempt.state).toBe("ask_region_manually");
    expect(secondAttempt.reply.content).toMatch(/derivacion a un responsable de zona|zona desde la que nos contacta/i);
  });

  it("asks for the location again and escalates on the second mismatch", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "GM 35");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    const firstLocation = await engine.handleMessage(start.sessionId, "Madrid");
    const secondLocation = await engine.handleMessage(start.sessionId, "Bilbao");

    expect(firstLocation.state).toBe("collect_machine_location");
    expect(firstLocation.reply.content).toMatch(/no he podido contrastar esa ubicaci[oó]n|ind[ií]queme de nuevo/i);
    expect(secondLocation.state).toBe("confirm_handoff");
    expect(secondLocation.reply.content).toMatch(/dos comprobaciones|derivacion a un responsable/i);
  });

  it("keeps the handoff offer when the user says the guidance did not help", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Tengo una incidencia");
    await engine.handleMessage(start.sessionId, "GM 35");
    await engine.handleMessage(start.sessionId, "Sí");
    await engine.handleMessage(start.sessionId, "GM35-ES-0001");
    await engine.handleMessage(start.sessionId, "Sevilla");
    await engine.handleMessage(start.sessionId, "El equipo muestra una alarma de temperatura");
    await engine.handleMessage(start.sessionId, "No");
    const response = await engine.handleMessage(start.sessionId, "No me ayuda eso");

    expect(response.state).toBe("area_contact_offer");
    expect(response.reply.content).toMatch(/responsable|deriv/i);
  });

  it("answers general information from authorized docs", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    const response = await engine.handleMessage(start.sessionId, "Necesito información sobre mantenimiento");
    expect(response.reply.content).toContain("Respuesta autorizada");
    expect(response.reply.citations).toBeUndefined();
    expect(response.state).toBe("anything_else_offer");
  });

  it("treats a standalone model in follow-up as a general-info model selection", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Necesito información general");
    const response = await engine.handleMessage(start.sessionId, "GM35");

    expect(response.state).toBe("anything_else_offer");
    expect(response.reply.content).toContain("Modelo: GM 35");
    expect(response.reply.content).toContain("información general sobre GM 35");
  });

  it("keeps the model when the first user message already mixes greeting and GM35 general info", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    const response = await engine.handleMessage(start.sessionId, "hola quiero informacion sobre la GM35");

    expect(response.state).toBe("anything_else_offer");
    expect(response.reply.content).toContain("Modelo: GM 35");
    expect(response.reply.content).toContain("hola quiero informacion sobre la GM35");
  });

  it("closes the conversation with anything-else and rating steps", async () => {
    const engine = new FlowEngine();
    const start = await engine.startConversation();
    await engine.handleMessage(start.sessionId, "Necesito información sobre mantenimiento");
    const anythingElse = await engine.handleMessage(start.sessionId, "no");
    const rating = await engine.handleMessage(start.sessionId, "5");

    expect(anythingElse.state).toBe("collect_rating");
    expect(anythingElse.reply.content).toMatch(/1 a 5 estrellas|valoraci/iu);
    expect(rating.state).toBe("closing");
    expect(rating.reply.content).toMatch(/gracias|cerrad/iu);
  });
});
