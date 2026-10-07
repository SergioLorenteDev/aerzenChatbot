import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@aerzen/shared";
import { sendMessage, startConversation } from "../utils/api";
import { createMessageId } from "../utils/ids";
import type { WidgetOptions, WidgetState } from "../types/widget";

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const INITIAL_GREETING_DELAY_MS = 1500;

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function useChatWidget(options: WidgetOptions) {
  const [state, setState] = useState<WidgetState>({
    messages: [],
    loading: false,
    isOpen: options.startOpen ?? false
  });
  const greetingDelayStartedRef = useRef(false);
  const mountedRef = useRef(true);

  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const responseDelayMs = options.responseDelayMs ?? 0;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.PROD && !options.apiBaseUrl && !import.meta.env.VITE_API_BASE_URL) {
      console.warn(
        "[aerzen-widget] No se ha configurado apiBaseUrl ni VITE_API_BASE_URL: se usará http://localhost:3001."
      );
    }
  }, [options.apiBaseUrl]);

  useEffect(() => {
    if (!state.isOpen) {
      greetingDelayStartedRef.current = false;
      return;
    }

    if (state.sessionId || greetingDelayStartedRef.current) {
      return;
    }

    greetingDelayStartedRef.current = true;
    setState((current) => ({ ...current, loading: true }));

    const timeoutId = window.setTimeout(() => {
      startConversation(apiBaseUrl)
        .then(async (response) => {
          if (responseDelayMs > 0) {
            await wait(responseDelayMs);
          }
          if (!mountedRef.current) {
            return;
          }
          setState((current) => ({
            ...current,
            sessionId: response.sessionId,
            currentState: response.state,
            messages: [response.reply],
            loading: false
          }));
        })
        .catch(() => {
          if (!mountedRef.current) {
            return;
          }
          setState((current) => ({
            ...current,
            loading: false,
            messages: [
              {
                id: createMessageId(),
                role: "assistant",
                content:
                  "No he podido iniciar la conversación ahora mismo. Inténtelo de nuevo en unos instantes.",
                createdAt: new Date().toISOString()
              }
            ]
          }));
        });
    }, INITIAL_GREETING_DELAY_MS);

    return () => {
      if (!state.sessionId) {
        window.clearTimeout(timeoutId);
        greetingDelayStartedRef.current = false;
      }
    };
  }, [apiBaseUrl, responseDelayMs, state.isOpen, state.sessionId]);

  async function submitMessage(message: string) {
    const sessionId = state.sessionId;
    if (!sessionId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: message,
      meta: {
        aiUsed: false,
        label: "usuario"
      },
      createdAt: new Date().toISOString()
    };

    setState((current) => ({
      ...current,
      loading: true,
      messages: [...current.messages, userMessage]
    }));

    try {
      const response = await sendMessage(apiBaseUrl, { sessionId, message });
      if (responseDelayMs > 0) {
        await wait(responseDelayMs);
      }
      if (!mountedRef.current) {
        return;
      }
      setState((current) => ({
        ...current,
        currentState: response.state,
        loading: false,
        messages: [...current.messages, response.reply]
      }));
    } catch {
      if (!mountedRef.current) {
        return;
      }
      setState((current) => ({
        ...current,
        loading: false,
        messages: [
          ...current.messages,
          {
            id: createMessageId(),
            role: "assistant",
            content:
              "No he podido procesar su mensaje ahora mismo. Si lo desea, vuelva a intentarlo en este mismo chat.",
            meta: {
              aiUsed: false,
              label: "sin IA"
            },
            createdAt: new Date().toISOString()
          }
        ]
      }));
    }
  }

  return {
    state,
    open: () => setState((current) => ({ ...current, isOpen: true })),
    close: () => setState((current) => ({ ...current, isOpen: false })),
    toggle: () => setState((current) => ({ ...current, isOpen: !current.isOpen })),
    submitMessage
  };
}
