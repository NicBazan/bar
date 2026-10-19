import { Redis } from "ioredis";
import { OutboxRelayWorker } from "./jobs/outbox-relay.job.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";

console.log(`[Workers] Iniciando servicios de background...`);
console.log(`[Workers] Conectando a Redis en: ${REDIS_URL}`);

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 3000);
    console.warn(`[Redis] Intento de reconexión #${times} en ${delay}ms...`);
    return delay;
  },
  reconnectOnError(err: Error) {
    console.error("[Redis] Error crítico de socket:", err.message);
    return true;
  },
});

redis.on("connect", () => {
  console.log("[Redis] Conexión establecida con el broker.");
});

redis.on("ready", () => {
  console.log("[Redis] Listo para operaciones de Pub/Sub.");
});

redis.on("error", (err: Error) => {
  console.error("[Redis] Error de conexión:", err.message);
});

redis.on("close", () => {
  console.warn("[Redis] Conexión cerrada.");
});

const outboxWorker = new OutboxRelayWorker(redis, {
  batchSize: 50,
  pollIntervalMs: 150,
  onErrorBackoffMs: 2000,
});

outboxWorker.start();

const shutdown = async (signal: string) => {
  console.log(`\n[Workers] Señal ${signal} recibida. Deteniendo servicios...`);
  await outboxWorker.stop();
  await redis.quit();
  console.log("[Workers] Servicios detenidos limpiamente.");
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
