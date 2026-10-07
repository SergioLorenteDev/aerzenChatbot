import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { FlowEngine, SessionNotFoundError } from "../flow/engine.js";
import { env } from "../config/env.js";
import { FixedWindowRateLimiter } from "../utils/rateLimit.js";

const chatMessageSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(4000)
});

export async function registerChatRoutes(app: FastifyInstance) {
  const flowEngine = new FlowEngine();
  const rateLimiter = new FixedWindowRateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS
  });

  /**
   * El chat no tiene autenticación (el widget se embebe en webs de terceros), así
   * que se limita por IP para evitar abuso y consumo descontrolado de tokens.
   */
  function rejectIfRateLimited(request: FastifyRequest, reply: FastifyReply) {
    const result = rateLimiter.check(request.ip);
    if (result.allowed) {
      return false;
    }

    void reply.header("Retry-After", String(result.retryAfterSeconds));
    void reply.code(429).send({
      error: "Too many requests",
      retryAfterSeconds: result.retryAfterSeconds
    });
    return true;
  }

  app.post("/api/chat/start", async (request, reply) => {
    if (rejectIfRateLimited(request, reply)) {
      return reply;
    }

    return flowEngine.startConversation();
  });

  app.post("/api/chat/message", async (request, reply) => {
    if (rejectIfRateLimited(request, reply)) {
      return reply;
    }

    const payload = chatMessageSchema.safeParse(request.body);
    if (!payload.success) {
      reply.status(400);
      return {
        error: "Invalid payload",
        details: payload.error.flatten()
      };
    }

    try {
      return await flowEngine.handleMessage(payload.data.sessionId, payload.data.message);
    } catch (error) {
      if (error instanceof SessionNotFoundError) {
        reply.status(404);
        return { error: "Session not found" };
      }
      throw error;
    }
  });
}
