import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
  const module = await import("../config/env.js");
  return module.env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env flags", () => {
  it("interpreta CHATBOT_TRACE_AI=false como desactivado", async () => {
    const env = await loadEnv({ CHATBOT_TRACE_AI: "false" });

    expect(env.CHATBOT_TRACE_AI).toBe(false);
  });

  it("activa CHATBOT_TRACE_AI con true y con 1", async () => {
    expect((await loadEnv({ CHATBOT_TRACE_AI: "true" })).CHATBOT_TRACE_AI).toBe(true);
    expect((await loadEnv({ CHATBOT_TRACE_AI: "1" })).CHATBOT_TRACE_AI).toBe(true);
  });

  it("usa false por defecto cuando la variable no está definida", async () => {
    vi.resetModules();
    vi.stubEnv("CHATBOT_TRACE_AI", undefined as unknown as string);
    const module = await import("../config/env.js");

    expect(module.env.CHATBOT_TRACE_AI).toBe(false);
  });

  it("aplica los valores por defecto del limitador de peticiones", async () => {
    const env = await loadEnv({});

    expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(30);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it("convierte CORS_ALLOWED_ORIGINS en una lista limpia", async () => {
    vi.resetModules();
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "https://a.example.com, https://b.example.com ,");
    const module = await import("../config/env.js");

    expect(module.getAllowedCorsOrigins()).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("devuelve una lista vacía cuando no hay orígenes configurados", async () => {
    vi.resetModules();
    vi.stubEnv("CORS_ALLOWED_ORIGINS", "");
    const module = await import("../config/env.js");

    expect(module.getAllowedCorsOrigins()).toEqual([]);
  });
});
