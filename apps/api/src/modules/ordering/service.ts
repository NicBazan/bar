import type { CreateOrderBody } from "@bar/shared-types";
import type { GuestClaims } from "../../shared/auth/tokens.js";
import { Prisma, prisma, type Tx } from "../../shared/db/index.js";
import { HttpError, conflict } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";
import { assertOrderAllowed } from "./order-policy.js";
import { type PricedItem, loadOrderCatalog, orderTotal, priceItems } from "./pricing.js";

/**
 * Caso de uso "pedir desde la mesa" (GRASP Controller): coordina, no calcula.
 * - Idempotente por (sesión, Idempotency-Key): un reintento por mala red devuelve el mismo pedido.
 * - Precios en el servidor (pricing.ts) y reglas anti-abuso / anti-duplicado (order-policy.ts).
 * - La sesión se bloquea en la transacción: dos pedidos simultáneos de la mesa van en fila.
 */
export async function createOrder(guest: GuestClaims, idempotencyKey: string, body: CreateOrderBody) {
  const existing = await findByKey(guest.sid, idempotencyKey);
  if (existing) return { order: existing, replayed: true };

  const catalog = await loadOrderCatalog(guest, body.items);
  const items = priceItems(guest.tid, body.items, catalog);

  try {
    const order = await prisma.$transaction(async (tx) => {
      const tableLabel = await lockOpenSession(tx, guest);
      await assertOrderAllowed({ tx, sessionId: guest.sid, items, confirmDuplicate: body.confirmDuplicate ?? false, now: new Date() });
      return insertOrder(tx, guest, idempotencyKey, body.note, items, tableLabel);
    });
    return { order, replayed: false };
  } catch (e) {
    // Dos reintentos simultáneos con la misma key: gana uno, el otro devuelve el mismo pedido
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await findByKey(guest.sid, idempotencyKey);
      if (again) return { order: again, replayed: true };
    }
    throw e;
  }
}

/** Bloquea la fila de la sesión hasta el COMMIT y verifica que la mesa siga abierta. Devuelve el nombre de la mesa */
async function lockOpenSession(tx: Tx, guest: GuestClaims): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ status: string; label: string }>>`
    SELECT s.status::text AS status, t.label
    FROM "TableSession" s JOIN "DiningTable" t ON t.id = s."tableId"
    WHERE s.id = ${guest.sid}::uuid AND s."tenantId" = ${guest.tid}::uuid
    FOR UPDATE OF s`;
  const session = rows[0];
  if (!session) throw new HttpError(404, "NOT_FOUND");
  if (session.status !== "OPEN") throw conflict("SESSION_NOT_OPEN", "El mozo todavía no abrió la mesa");
  return session.label;
}

async function insertOrder(tx: Tx, guest: GuestClaims, idempotencyKey: string, note: string | undefined, items: PricedItem[], tableLabel: string) {
  // Si el cliente se identificó desde este celular ("Mi cuenta"), el pedido queda en su historial
  const device = await tx.guestDevice.findUnique({ where: { id: guest.did }, select: { customerId: true } });
  const totalCents = orderTotal(items);
  const created = await tx.order.create({
    data: {
      tenantId: guest.tid,
      venueId: guest.vid,
      sessionId: guest.sid,
      deviceId: guest.did,
      customerId: device?.customerId ?? null,
      idempotencyKey,
      note,
      totalCents,
      items: { create: items },
    },
    include: { items: true },
  });
  await emit(tx, {
    tenantId: guest.tid,
    venueId: guest.vid,
    type: "order.submitted",
    channels: [channels.staff(guest.vid), channels.session(guest.sid)],
    payload: { orderId: created.id, tableLabel, totalCents, itemCount: items.length },
  });
  return created;
}

function findByKey(sessionId: string, idempotencyKey: string) {
  return prisma.order.findUnique({
    where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } },
    include: { items: true },
  });
}
