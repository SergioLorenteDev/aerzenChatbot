import "dotenv/config";
import { z } from "zod";

/**
 * Los flags de entorno llegan como texto. `z.coerce.boolean()` no sirve porque
 * Boolean("false") es `true`, así que "CHATBOT_TRACE_AI=false" activaría las trazas.
 */
const booleanFlag = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) =>
      typeof value === "boolean" ? value : ["true", "1", "yes", "on"].includes(value.trim().toLowerCase())
    );

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:55432/aerzen_chatbot?schema=public"),
  PORT: z.coerce.number().default(3001),
  PUBLIC_API_BASE_URL: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(30),
  VECTOR_PROVIDER: z.enum(["memory", "pgvector", "qdrant"]).default("memory"),
  VECTOR_CACHE_TTL_MS: z.coerce.number().int().nonnegative().default(30_000),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-20b"),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_API_BASE_URL: z.string().default("https://api.telegram.org"),
  TELEGRAM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  TELEGRAM_DEFAULT_CHAT_ID: z.string().optional(),
  TELEGRAM_DEFAULT_CHAT_IDS: z.string().optional(),
  MANUALS_DIR: z.string().optional(),
  QDRANT_URL: z.string().optional(),
  QDRANT_API_KEY: z.string().optional(),
  CHATBOT_TRACE_AI: booleanFlag(false)
});

export const env = envSchema.parse(process.env);

export function getAllowedCorsOrigins() {
  return (env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
