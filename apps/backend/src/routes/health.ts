import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  });
}
