import type { FastifyInstance } from "fastify";
import { globalKey } from "../../shared/rate-limit/keys.js";
import { registerOnboardingHandler } from "./onboarding.controller.js";

export async function onboardingRoutes(app: FastifyInstance) {
  /**
   * Registro y aprovisionamiento self-service de un nuevo bar.
   * Límite estricto de rate limit para prevenir registros masivos.
   */
  app.post(
    "/onboarding/register",
    // Tope de la plataforma: 30 altas por hora en total (no se saltea cambiando de IP)
    { config: { rateLimit: { max: 30, timeWindow: "1 hour", keyGenerator: globalKey("onboarding") } } },
    registerOnboardingHandler,
  );
}
