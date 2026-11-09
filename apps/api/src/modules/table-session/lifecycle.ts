import { randomInt } from "node:crypto";
import type { RealtimeEventType } from "@bar/shared-types";
import type { Tx } from "../../shared/db/index.js";
import { conflict } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";
import { assertTenantCanOpenSession, incrementSessionUsage } from "../billing/billing.guard.js";
import { awardSession } from "../loyalty/service.js";
import { type Receipt, issueFinalReceipt } from "./receipt.js";

/**
 * Ciclo de vida de una mesa: PENDING → OPEN → (BILL_REQUESTED) → CLOSED.
 *
 * GRASP Information Expert + Creator: este módulo es el único que cambia el estado de una sesión,
 * así el mozo, el cierre por abandono y cualquier caso futuro aplican exactamente las mismas reglas.
 * Cada transición se reclama con escritura condicional (`updateMany ... where status`): si dos mozos
 * tocan a la vez, uno gana y el otro recibe 409.
 */

export type SessionRef = { id: string; tenantId: string; venueId: string };

export const newJoinPin = () => String(randomInt(0, 10000)).padStart(4, "0");

/** El mozo abre una mesa que esperaba (consume una mesa del plan: 402 si el FREE llegó al límite) */
export async function openSession(tx: Tx, s: SessionRef, staffId: string) {
  const claimed = await tx.tableSession.updateMany({ where: { id: s.id, status: "PENDING" }, data: { status: "OPEN", approvedById: staffId } });
  if (claimed.count === 0) throw conflict("SESSION_NOT_PENDING", "La mesa ya no está esperando");
  await assertTenantCanOpenSession(tx, s.tenantId);
  await incrementSessionUsage(tx, s.tenantId);
  await notify(tx, s, "session.opened");
  return tx.tableSession.findUniqueOrThrow({ where: { id: s.id } });
}

/** PIN nuevo y desbloqueo (por intentos fallidos o porque el PIN se filtró) */
export async function rotatePin(tx: Tx, s: SessionRef) {
  const claimed = await tx.tableSession.updateMany({
    where: { id: s.id, status: { not: "CLOSED" } },
    data: { joinPin: newJoinPin(), pinFailures: 0 },
  });
  if (claimed.count === 0) throw conflict("SESSION_ALREADY_CLOSED");
  await notify(tx, s, "session.pin_changed");
  return tx.tableSession.findUniqueOrThrow({ where: { id: s.id } });
}

export type CloseReason = "STAFF" | "ABANDONED";

/**
 * Cierra la mesa y deja todo en un estado final coherente:
 * pedidos sin confirmar → cancelados, llamados → resueltos, sellos/puntos → acreditados,
 * comprobante → numerado y guardado. Devuelve la sesión y su comprobante.
 */
export async function closeSession(tx: Tx, s: SessionRef, reason: CloseReason): Promise<{ receipt: Receipt }> {
  const claimed = await tx.tableSession.updateMany({ where: { id: s.id, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  if (claimed.count === 0) throw conflict("SESSION_ALREADY_CLOSED", "La mesa ya estaba cerrada");
  await cancelUnconfirmedOrders(tx, s.id, reason);
  await tx.serviceCall.updateMany({ where: { sessionId: s.id, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  await awardSession(tx, s.id);
  const receipt = await issueFinalReceipt(tx, s.id);
  await notify(tx, s, "session.closed", { receiptNumber: receipt.number });
  return { receipt };
}

async function cancelUnconfirmedOrders(tx: Tx, sessionId: string, reason: CloseReason) {
  const stale = await tx.order.findMany({ where: { sessionId, status: "PENDING_APPROVAL" }, select: { id: true } });
  if (stale.length === 0) return;
  const ids = stale.map((o) => o.id);
  await tx.order.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
  await tx.orderItem.updateMany({
    where: { orderId: { in: ids } },
    data: { status: "VOIDED", voidReason: reason === "ABANDONED" ? "Mesa cerrada por inactividad" : "Mesa cerrada sin confirmar" },
  });
}

function notify(tx: Tx, s: SessionRef, type: RealtimeEventType, extra: Record<string, unknown> = {}) {
  return emit(tx, {
    tenantId: s.tenantId,
    venueId: s.venueId,
    type,
    channels: [channels.staff(s.venueId), channels.session(s.id)],
    payload: { sessionId: s.id, ...extra },
  });
}
