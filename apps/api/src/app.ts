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

// IPs privadas (192.168.x, 10.x, 172.16-31.x) en los puertos de los front de desarrollo
const LAN_ORIGIN = /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):(3000|3001)$/;

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl, apps nativas, server-side rendering (sin header Origin)
  if (config.corsOrigins.includes(origin)) return true;
  return config.allowLanOrigins && LAN_ORIGIN.test(origin);
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger === false ? false : { level: "info" }, trustProxy: true });

  // BigInt (venueSeq) → number en JSON
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
  );

  await app.register(cookie);
  await app.register(cors, {
    // Nunca `origin: true` con credentials: cualquier sitio podría usar la sesión del navegador
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
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
