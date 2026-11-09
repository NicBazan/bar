import { CreateOrderBody, RejectOrderBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FLOOR_ROLES, requireGuest, requireStaff, staffScope } from "../../shared/auth/guards.js";
import type { StaffClaims } from "../../shared/auth/tokens.js";
import { prisma, type Tx } from "../../shared/db/index.js";
import { deviceOrIpKey } from "../../shared/rate-limit/keys.js";
import { HttpError, conflict, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";
import { createOrder } from "./service.js";

const IdParams = z.object({ id: z.uuid() });
const IdempotencyKey = z.string().min(8).max(100);
const OrderStatus = z.enum(["PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]);

export async function orderingRoutes(app: FastifyInstance) {
  // ───── Comensal ─────
  app.post(
    "/orders",
    // Límite por dispositivo/mesa, no por IP (toda la mesa comparte el Wi-Fi). Las reglas de negocio
    // (tamaño, pendientes, volumen por hora, repetidos) están en order-policy.ts
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: deviceOrIpKey } } },
    async (req, reply) => {
      const guest = await requireGuest(req);
      const key = IdempotencyKey.safeParse(req.headers["idempotency-key"]);
      if (!key.success) throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED");
      const body = CreateOrderBody.parse(req.body);
      const { order, replayed } = await createOrder(guest, key.data, body);
      return reply.status(replayed ? 200 : 201).send(order);
    },
  );

  // ───── Mozo ─────
  app.get("/staff/orders", async (req) => {
    const staff = await requireStaff(req);
    const { status } = z.object({ status: OrderStatus.optional() }).parse(req.query);
    return prisma.order.findMany({
      where: {
        ...staffScope(staff),
        status: status ?? { in: ["PENDING_APPROVAL", "APPROVED"] },
        // El salón solo trabaja con mesas activas: lo de mesas cerradas es historial
        ...(status ? {} : { session: { status: { not: "CLOSED" } } }),
      },
      include: { items: true, session: { select: { table: { select: { label: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  });

  // Aprobar = validar el pedido y mandarlo a cocina (ítems → FIRED)
  app.post("/staff/orders/:id/approve", async (req) => {
    const staff = await requireStaff(req, FLOOR_ROLES);
    const { id } = IdParams.parse(req.params);
    return prisma.$transaction((tx) =>
      decidePendingOrder(tx, staff, id, {
        order: { status: "APPROVED", approvedById: staff.sub },
        itemStatus: "FIRED",
        event: "order.approved",
        toKitchen: true,
      }),
    );
  });

  app.post("/staff/orders/:id/reject", async (req) => {
    const staff = await requireStaff(req, FLOOR_ROLES);
    const { id } = IdParams.parse(req.params);
    const { reason } = RejectOrderBody.parse(req.body);
    return prisma.$transaction((tx) =>
      decidePendingOrder(tx, staff, id, {
        order: { status: "REJECTED", rejectReason: reason },
        itemStatus: "REJECTED",
        event: "order.rejected",
        toKitchen: false,
        reason,
      }),
    );
  });
}

async function whyNotPending(tx: Tx, staff: StaffClaims, id: string) {
  const order = await tx.order.findFirst({ where: { id, ...staffScope(staff) }, select: { status: true, session: { select: { status: true } } } });
  if (!order) return notFound("Pedido");
  if (order.status === "PENDING_APPROVAL") return conflict("SESSION_CLOSED", "La mesa ya se cerró: el pedido no se puede confirmar");
  return conflict("ORDER_NOT_PENDING", "Otro mozo ya resolvió este pedido");
}

type Decision = {
  order: { status: "APPROVED"; approvedById: string } | { status: "REJECTED"; rejectReason: string };
  itemStatus: "FIRED" | "REJECTED";
  event: "order.approved" | "order.rejected";
  toKitchen: boolean;
  reason?: string;
};

/**
 * Aprobar o rechazar un pedido pendiente. Transición reclamada con escritura condicional:
 * si dos mozos tocan a la vez, uno cambia el estado y el otro recibe 409 (nunca dos comandas a cocina).
 */
async function decidePendingOrder(tx: Tx, staff: StaffClaims, id: string, d: Decision) {
  // Un pedido de una mesa ya cerrada no se aprueba: no figuraría en ningún comprobante
  const claimed = await tx.order.updateMany({
    where: { id, ...staffScope(staff), status: "PENDING_APPROVAL", session: { status: { not: "CLOSED" } } },
    data: d.order,
  });
  if (claimed.count === 0) throw await whyNotPending(tx, staff, id);
  await tx.orderItem.updateMany({ where: { orderId: id }, data: { status: d.itemStatus } });
  const order = await tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
  await emit(tx, {
    tenantId: order.tenantId,
    venueId: order.venueId,
    type: d.event,
    channels: [
      channels.staff(order.venueId),
      ...(d.toKitchen ? [channels.kitchen(order.venueId)] : []),
      channels.session(order.sessionId),
    ],
    payload: d.reason ? { orderId: id, reason: d.reason } : { orderId: id },
  });
  return order;
}
