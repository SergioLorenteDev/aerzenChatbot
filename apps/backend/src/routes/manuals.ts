import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { prisma } from "../db/prisma.js";
import { resolveServableManualFile } from "../utils/manualFiles.js";

export async function registerManualRoutes(app: FastifyInstance) {
  app.get("/api/manuals", async () => {
    return prisma.manual.findMany({ orderBy: { model: "asc" } });
  });

  app.get("/api/manuals/:id/file", async (request, reply) => {
    const { id } = request.params as { id: string };
    const manual = await prisma.manual.findUnique({ where: { id } });

    if (!manual) {
      return reply.code(404).send({ error: "Manual not found" });
    }

    if (/^https?:\/\//i.test(manual.fileUrl)) {
      return reply.redirect(manual.fileUrl);
    }

    const filePath = resolveServableManualFile(manual.fileUrl);
    if (!filePath || !existsSync(filePath)) {
      return reply.code(404).send({ error: "Manual file not found" });
    }

    reply.type("application/pdf");
    reply.header("Content-Disposition", `inline; filename="${manual.title.replace(/"/g, "")}.pdf"`);
    return reply.send(createReadStream(filePath));
  });
}
