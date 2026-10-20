import { CreateOrderBody, RejectOrderBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FLOOR_ROLES, requireGuest, requireStaff, staffScope } from "../../shared/auth/guards.js";
import { prisma } from "../../shared/db/index.js";
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
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
          // Límite por dispositivo/mesa, no por IP (toda la mesa comparte el Wi-Fi)
          keyGenerator: deviceOrIpKey,
        },
      },
    },
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
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, ...staffScope(staff) } });
      if (!order) throw notFound("Pedido");
      if (order.status !== "PENDING_APPROVAL") throw conflict("ORDER_NOT_PENDING");

      await tx.order.update({ where: { id }, data: { status: "APPROVED", approvedById: staff.sub } });
      await tx.orderItem.updateMany({ where: { orderId: id }, data: { status: "FIRED" } });
      await emit(tx, {
        tenantId: order.tenantId,
        venueId: order.venueId,
        type: "order.approved",
        channels: [channels.staff(order.venueId), channels.kitchen(order.venueId), channels.session(order.sessionId)],
        payload: { orderId: id },
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
  });

  app.post("/staff/orders/:id/reject", async (req) => {
    const staff = await requireStaff(req, FLOOR_ROLES);
    const { id } = IdParams.parse(req.params);
    const { reason } = RejectOrderBody.parse(req.body);
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, ...staffScope(staff) } });
      if (!order) throw notFound("Pedido");
      if (order.status !== "PENDING_APPROVAL") throw conflict("ORDER_NOT_PENDING");

      await tx.order.update({ where: { id }, data: { status: "REJECTED", rejectReason: reason } });
      await tx.orderItem.updateMany({ where: { orderId: id }, data: { status: "REJECTED" } });
      await emit(tx, {
        tenantId: order.tenantId,
        venueId: order.venueId,
        type: "order.rejected",
        channels: [channels.staff(order.venueId), channels.session(order.sessionId)],
        payload: { orderId: id, reason },
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
  });
}
