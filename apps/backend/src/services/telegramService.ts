import { env } from "../config/env.js";

export interface TelegramNotificationInput {
  chatId: string;
  text: string;
}

export interface TelegramNotificationResult {
  delivered: boolean;
  status: "sent" | "missing_bot_token" | "missing_chat_id" | "failed";
  messageId?: string;
  error?: string;
}

export class TelegramService {
  private readonly botToken = env.TELEGRAM_BOT_TOKEN;
  private readonly apiBaseUrl = env.TELEGRAM_API_BASE_URL;

  /**
   * Envía un mensaje y NUNCA lanza: cualquier fallo (timeout, red, API) se
   * devuelve como resultado para que la incidencia ya creada no se pierda.
   */
  async sendMessage(input: TelegramNotificationInput): Promise<TelegramNotificationResult> {
    if (!this.botToken) {
      return {
        delivered: false,
        status: "missing_bot_token"
      };
    }

    if (!input.chatId) {
      return {
        delivered: false,
        status: "missing_chat_id"
      };
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: input.text
        }),
        signal: AbortSignal.timeout(env.TELEGRAM_TIMEOUT_MS)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          delivered: false,
          status: "failed",
          error: errorText
        };
      }

      const data = (await response.json()) as {
        ok: boolean;
        result?: { message_id?: number };
        description?: string;
      };

      if (!data.ok) {
        return {
          delivered: false,
          status: "failed",
          error: data.description ?? "Telegram API error"
        };
      }

      return {
        delivered: true,
        status: "sent",
        messageId: data.result?.message_id ? String(data.result.message_id) : undefined
      };
    } catch (error) {
      return {
        delivered: false,
        status: "failed",
        error: error instanceof Error ? error.message : "Telegram request failed"
      };
    }
  }
}
