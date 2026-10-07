import type { ChatMessage } from "@aerzen/shared";

export interface WidgetOptions {
  apiBaseUrl?: string;
  title?: string;
  embedded?: boolean;
  startOpen?: boolean;
  responseDelayMs?: number;
}

export interface WidgetState {
  sessionId?: string;
  currentState?: string;
  messages: ChatMessage[];
  loading: boolean;
  isOpen: boolean;
}
