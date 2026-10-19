import type { RealtimeEventType } from "@bar/shared-types";
import type { Tx } from "../db/index.js";

export const channels = {
  staff: (venueId: string) => `venue:${venueId}:staff`,
  kitchen: (venueId: string) => `venue:${venueId}:kitchen`,
  session: (sessionId: string) => `table_session:${sessionId}`,
};

type EmitInput = {
  tenantId: string;
  venueId: string;
  type: RealtimeEventType;
  channels: string[];
  payload: Record<string, unknown>;
};

/**
 * Transactional outbox: se llama DENTRO de la misma transacción que el cambio de negocio.
 * Incrementa la secuencia de la sucursal (el UPDATE bloquea la fila y serializa por venue)
 * y escribe un evento por canal. Un relay (apps/workers) los publica al broker.
 */
export async function emit(tx: Tx, input: EmitInput): Promise<bigint> {
  let last = 0n;
  for (const channel of input.channels) {
    const venue = await tx.venue.update({
      where: { id: input.venueId },
      data: { eventSeq: { increment: 1 } },
      select: { eventSeq: true },
    });
    last = venue.eventSeq;
    await tx.outboxEvent.create({
      data: {
        tenantId: input.tenantId,
        venueId: input.venueId,
        venueSeq: venue.eventSeq,
        channel,
        type: input.type,
        payload: input.payload as object,
      },
    });
  }
  return last;
}
