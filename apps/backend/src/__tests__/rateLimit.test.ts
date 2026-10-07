import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../utils/rateLimit.js";

describe("fixed window rate limiter", () => {
  it("permite peticiones hasta el límite de la ventana", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 3 });

    expect(limiter.check("ip-1", 0).allowed).toBe(true);
    expect(limiter.check("ip-1", 0).allowed).toBe(true);
    expect(limiter.check("ip-1", 0).allowed).toBe(true);
    expect(limiter.check("ip-1", 0).allowed).toBe(false);
  });

  it("informa del tiempo de espera cuando se supera el límite", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 10_000, max: 1 });
    limiter.check("ip-1", 0);

    const blocked = limiter.check("ip-1", 4_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(6);
  });

  it("vuelve a permitir peticiones al abrirse una ventana nueva", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    limiter.check("ip-1", 0);

    expect(limiter.check("ip-1", 1001).allowed).toBe(true);
  });

  it("limita por clave, no de forma global", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 1000, max: 1 });
    limiter.check("ip-1", 0);

    expect(limiter.check("ip-2", 0).allowed).toBe(true);
  });

  it("acota el número de claves activas para no crecer sin control", () => {
    const limiter = new FixedWindowRateLimiter({ windowMs: 100_000, max: 5, maxKeys: 3 });

    // Todas las peticiones caen en la misma ventana, así que ninguna caduca.
    for (let index = 0; index < 50; index += 1) {
      limiter.check(`ip-${index}`, 0);
    }

    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
