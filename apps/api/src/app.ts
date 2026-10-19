import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { config } from "./config.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { kitchenRoutes } from "./modules/kitchen/routes.js";
import { onboardingRoutes } from "./modules/onboarding/routes.js";
import { orderingRoutes } from "./modules/ordering/routes.js";
import { serviceCallRoutes } from "./modules/service-calls/routes.js";
import { staffRoutes } from "./modules/staff/routes.js";
import { tableSessionRoutes } from "./modules/table-session/routes.js";
import { errorHandler } from "./shared/errors.js";
import { realtimeRoutes } from "./shared/realtime/routes.js";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger === false ? false : { level: "info" }, trustProxy: true });

  // BigInt (venueSeq) → number en JSON
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
  );

  await app.register(cookie);
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
  });
  // Límite global por IP; las rutas sensibles definen el suyo (ver cada módulo)
  // TODO(fase 1b): store en Redis para compartir el límite entre instancias
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  });

  app.setErrorHandler(errorHandler);

  app.get("/health", async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      await v1.register(catalogRoutes);
      await v1.register(onboardingRoutes);
      await v1.register(tableSessionRoutes);
      await v1.register(orderingRoutes);
      await v1.register(serviceCallRoutes);
      await v1.register(kitchenRoutes);
      await v1.register(staffRoutes);
      await v1.register(realtimeRoutes);
    },
    { prefix: "/v1" },
  );

  return app;
}
