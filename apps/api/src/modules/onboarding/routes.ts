import type { FastifyInstance } from "fastify";
import { registerOnboardingHandler } from "./onboarding.controller.js";

export async function onboardingRoutes(app: FastifyInstance) {
  /**
   * Registro y aprovisionamiento self-service de un nuevo bar.
   * Límite estricto de rate limit para prevenir registros masivos.
   */
  app.post(
    "/onboarding/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    registerOnboardingHandler,
  );
}
