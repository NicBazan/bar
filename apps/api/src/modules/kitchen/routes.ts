import { UpdateItemStatusBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireStaff, staffScope } from "../../shared/auth/guards.js";
import type { StaffRole } from "../../shared/auth/tokens.js";
import { prisma } from "../../shared/db/index.js";
import { HttpError, conflict, forbidden, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";

type ItemStatus = z.infer<typeof UpdateItemStatusBody>["status"];

// Máquina de estados del ítem: desde → hacia
const TRANSITIONS: Record<string, ItemStatus[]> = {
  FIRED: ["IN_PROGRESS", "READY", "VOIDED"],
  IN_PROGRESS: ["READY", "VOIDED"],
  READY: ["SERVED", "VOIDED"],
};
// Quién puede mover a cada estado
const ROLES_FOR: Record<ItemStatus, StaffRole[]> = {
  FIRED: [],
  IN_PROGRESS: ["OWNER", "MANAGER", "KITCHEN"],
  READY: ["OWNER", "MANAGER", "KITCHEN"],
  SERVED: ["OWNER", "MANAGER", "WAITER"],
  VOIDED: ["OWNER", "MANAGER"],
};

export async function kitchenRoutes(app: FastifyInstance) {
  // Comandas activas del KDS, opcionalmente filtradas por estación
  app.get("/staff/kitchen/items", async (req) => {
    const staff = await requireStaff(req);
    const { station } = z.object({ station: z.string().max(40).optional() }).parse(req.query);
    return prisma.orderItem.findMany({
      where: {
        tenantId: staff.tid,
        status: { in: ["FIRED", "IN_PROGRESS", "READY"] },
        // Mesas cerradas no ensucian el KDS ni la lista "para llevar"
        order: { ...staffScope(staff), session: { status: { not: "CLOSED" } } },
        ...(station ? { station: { key: station } } : {}),
      },
      include: {
        station: { select: { key: true, name: true } },
        order: {
          select: { id: true, createdAt: true, note: true, session: { select: { table: { select: { label: true } } } } },
        },
      },
      orderBy: { updatedAt: "asc" },
    });
  });

  app.patch("/staff/order-items/:id/status", async (req) => {
    const staff = await requireStaff(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { status, reason } = UpdateItemStatusBody.parse(req.body);
    if (!ROLES_FOR[status].includes(staff.role)) throw forbidden("ROLE_NOT_ALLOWED");
    if (status === "VOIDED" && !reason) throw new HttpError(400, "REASON_REQUIRED");

    return prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({
        where: { id, tenantId: staff.tid, order: staffScope(staff) },
        include: { order: true },
      });
      if (!item) throw notFound("Ítem");
      if (!TRANSITIONS[item.status]?.includes(status)) {
        throw conflict("INVALID_TRANSITION", `${item.status} → ${status} no permitido`);
      }

      const updated = await tx.orderItem.update({
        where: { id },
        data: { status, voidReason: status === "VOIDED" ? reason : undefined },
      });
      if (status === "VOIDED") {
        await tx.auditLog.create({
          data: {
            tenantId: staff.tid,
            actorId: staff.sub,
            action: "item.voided",
            entity: "OrderItem",
            entityId: id,
            data: { reason },
          },
        });
      }

      // Si no quedan ítems pendientes, el pedido se completa
      const pending = await tx.orderItem.count({
        where: { orderId: item.orderId, status: { notIn: ["SERVED", "VOIDED", "REJECTED"] } },
      });
      if (pending === 0) await tx.order.update({ where: { id: item.orderId }, data: { status: "COMPLETED" } });

      const { venueId, sessionId } = item.order;
      await emit(tx, {
        tenantId: staff.tid,
        venueId,
        type: "item.status_changed",
        channels: [channels.staff(venueId), channels.kitchen(venueId), channels.session(sessionId)],
        payload: { itemId: id, orderId: item.orderId, status, name: item.nameSnapshot, orderCompleted: pending === 0 },
      });
      return updated;
    });
  });
}
