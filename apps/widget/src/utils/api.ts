import type { ChatResponse } from "@aerzen/shared";

const REQUEST_TIMEOUT_MS = 15_000;

export class ChatApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatApiError";
  }
}

/**
 * El backend puede devolver un error inesperado o un cuerpo incompleto. Se valida
 * aquí para que un fallo no rompa el render del widget.
 */
function toChatResponse(payload: unknown): ChatResponse {
  const candidate = payload as Partial<ChatResponse> | null;

  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.sessionId !== "string" ||
    !candidate.reply ||
    typeof candidate.reply.content !== "string"
  ) {
    throw new ChatApiError("El servidor devolvió una respuesta con un formato inesperado");
  }

  return candidate as ChatResponse;
}

async function postJson(apiBaseUrl: string, path: string, body?: unknown) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new ChatApiError(`El servidor respondió con el código ${response.status}`);
  }

  return toChatResponse(await response.json());
}

export function startConversation(apiBaseUrl: string) {
  return postJson(apiBaseUrl, "/api/chat/start");
}

export function sendMessage(apiBaseUrl: string, payload: { sessionId: string; message: string }) {
  return postJson(apiBaseUrl, "/api/chat/message", payload);
}
