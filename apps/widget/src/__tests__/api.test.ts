import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatApiError, sendMessage, startConversation } from "../utils/api";

function mockFetch(implementation: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const validResponse = {
  sessionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  state: "greeting",
  reply: { id: "msg-1", role: "assistant", content: "Hola.", createdAt: "2026-01-01T00:00:00.000Z" },
  context: {}
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("widget chat API", () => {
  it("inicia la conversación contra /api/chat/start", async () => {
    const fetchMock = mockFetch(() => jsonResponse(validResponse));

    const response = await startConversation("http://localhost:3001");

    expect(response.sessionId).toBe(validResponse.sessionId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3001/api/chat/start");
  });

  it("envía el mensaje con sessionId y cuerpo JSON", async () => {
    const fetchMock = mockFetch(() => jsonResponse(validResponse));

    await sendMessage("http://localhost:3001", { sessionId: validResponse.sessionId, message: "Hola" });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:3001/api/chat/message");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ sessionId: validResponse.sessionId, message: "Hola" });
  });

  it("cancela la petición con un timeout", async () => {
    const fetchMock = mockFetch(() => jsonResponse(validResponse));

    await startConversation("http://localhost:3001");

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falla con ChatApiError cuando el servidor responde con error", async () => {
    mockFetch(() => jsonResponse({ error: "Too many requests" }, 429));

    await expect(startConversation("http://localhost:3001")).rejects.toBeInstanceOf(ChatApiError);
  });

  it("falla con ChatApiError cuando la respuesta no tiene el formato esperado", async () => {
    mockFetch(() => jsonResponse({ state: "greeting" }));

    await expect(startConversation("http://localhost:3001")).rejects.toBeInstanceOf(ChatApiError);
  });

  it("falla con ChatApiError cuando reply no trae contenido", async () => {
    mockFetch(() => jsonResponse({ ...validResponse, reply: { id: "msg-1", role: "assistant" } }));

    await expect(startConversation("http://localhost:3001")).rejects.toBeInstanceOf(ChatApiError);
  });
});
