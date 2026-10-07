import Fastify from "fastify";
import cors from "@fastify/cors";
import { getAllowedCorsOrigins } from "./config/env.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerManualRoutes } from "./routes/manuals.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  const allowedOrigins = getAllowedCorsOrigins();

  await app.register(cors, {
    // El widget se embebe en webs de terceros, así que por defecto se refleja el
    // origen de la petición. Con CORS_ALLOWED_ORIGINS se restringe a una lista.
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86_400
  });

  await registerHealthRoutes(app);
  await registerChatRoutes(app);
  await registerManualRoutes(app);

  return app;
}
