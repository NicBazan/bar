import { Prisma, prisma } from "@bar/db";
import type { Redis } from "ioredis";

export interface OutboxEventRow {
  id: bigint;
  tenantId: string;
  venueId: string;
  venueSeq: bigint;
  channel: string;
  type: string;
  payload: unknown;
  createdAt: Date;
}

/**
 * Resuelve el canal de Redis para un evento de outbox:
 * Utiliza el canal configurado en el registro o lo infiere del payload.
 */
export function resolveChannel(event: {
  channel?: string | null;
  venueId?: string | null;
  payload?: unknown;
}): string {
  if (event.channel && event.channel.trim().length > 0) {
    return event.channel.trim();
  }

  const p = (typeof event.payload === "object" && event.payload !== null
    ? event.payload
    : {}) as Record<string, unknown>;

  if (typeof p.sessionId === "string" && p.sessionId.length > 0) {
    return `table_session:${p.sessionId}`;
  }
  if (typeof p.venueId === "string" && p.venueId.length > 0) {
    return `venue:${p.venueId}:staff`;
  }
  if (event.venueId) {
    return `venue:${event.venueId}:staff`;
  }

  return "venue:default:staff";
}

export interface OutboxRelayOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  onErrorBackoffMs?: number;
}

/**
 * Procesa un lote atómico de eventos pendientes utilizando SELECT FOR UPDATE SKIP LOCKED.
 * Retorna la cantidad de eventos procesados y despachados.
 */
export async function processOutboxBatch(
  redis: Redis,
  batchSize: number = 50,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      // 1. Bloqueo de lote sin colisiones de concurrencia entre workers
      const events = await tx.$queryRaw<OutboxEventRow[]>`
        SELECT id, "tenantId", "venueId", "venueSeq", channel, type, payload, "createdAt"
        FROM "OutboxEvent"
        ORDER BY id ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED;
      `;

      if (!events || events.length === 0) {
        return 0;
      }

      // 2. Publicación at-least-once hacia Redis Pub/Sub
      for (const event of events) {
        const targetChannel = resolveChannel(event);
        const payloadJson = JSON.stringify({
          id: event.id.toString(),
          tenantId: event.tenantId,
          venueId: event.venueId,
          venueSeq: Number(event.venueSeq),
          channel: targetChannel,
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt.toISOString(),
        });

        await redis.publish(targetChannel, payloadJson);
      }

      // 3. Eliminación de la base de datos tras publicación confirmada
      const eventIds = events.map((e) => e.id);
      await tx.$executeRaw`
        DELETE FROM "OutboxEvent"
        WHERE id IN (${Prisma.join(eventIds)});
      `;

      return events.length;
    },
    {
      timeout: 15000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}

/**
 * Worker de ciclo continuo para el Outbox Relay con backoff defensivo y apagado limpio.
 */
export class OutboxRelayWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly onErrorBackoffMs: number;

  constructor(
    private readonly redis: Redis,
    options: OutboxRelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 50;
    this.pollIntervalMs = options.pollIntervalMs ?? 150;
    this.onErrorBackoffMs = options.onErrorBackoffMs ?? 2000;
  }

  /**
   * Inicia el bucle de procesamiento continuo.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(
      `[OutboxRelay] Worker iniciado (lote: ${this.batchSize}, intervalo: ${this.pollIntervalMs}ms)`,
    );
    void this.loop();
  }

  /**
   * Detiene el worker de forma ordenada.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[OutboxRelay] Worker detenido.");
  }

  private async loop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const processed = await processOutboxBatch(this.redis, this.batchSize);

      if (!this.isRunning) return;

      // Si el lote estuvo lleno, no esperamos para drenar la cola inmediatamente
      const delay = processed >= this.batchSize ? 0 : this.pollIntervalMs;
      this.timer = setTimeout(() => void this.loop(), delay);
    } catch (error) {
      console.error("[OutboxRelay] Error al procesar lote de eventos:", error);

      if (!this.isRunning) return;

      // Backoff defensivo ante desconexiones temporales
      this.timer = setTimeout(() => void this.loop(), this.onErrorBackoffMs);
    }
  }
}
