import type { FastifyInstance } from "fastify";
import {
  getSessionHandler,
  joinTableSession,
  resolveTagHandler,
} from "./table-session.controller.js";

export async function tableSessionRoutes(app: FastifyInstance) {
  // Resolución pública del tag: qué local y qué mesa (no crea sesión)
  app.get("/tags/:code", resolveTagHandler);

  /**
   * Unirse a la mesa mediante verificación criptográfica NFC SUN o PIN (QR).
   */
  app.post(
    "/tags/:code/session",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    joinTableSession,
  );

  // Estado de la sesión del comensal
  app.get("/session", getSessionHandler);
}
