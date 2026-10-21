import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FLOOR_ROLES, requireCustomer, requireStaff, staffScope } from "../../shared/auth/guards.js";
import { prisma } from "../../shared/db/index.js";
import { HttpError, conflict, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";
import { audit, requireAdmin } from "../admin/context.js";
import { balanceOf, getProgram, loyaltySummary } from "./service.js";

const ProgramBody = z.object({
  active: z.boolean(),
  mode: z.enum(["STAMPS", "POINTS"]),
  centsPerPoint: z.number().int().min(100).max(10_000_000),
  rewards: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(60),
        cost: z.number().int().min(1).max(100_000),
        active: z.boolean(),
      }),
    )
    .max(10),
});

const REDEEM_ROLES = [...FLOOR_ROLES, "CASHIER" as const];

export async function loyaltyRoutes(app: FastifyInstance) {
  // ───── Admin: configurar el programa ─────

  app.get("/admin/loyalty", async (req) => {
    const ctx = await requireAdmin(req);
    const program = await getProgram(prisma, ctx.tenantId);
    const [customers, redeemed] = await Promise.all([
      prisma.customer.count({ where: { tenantId: ctx.tenantId } }),
      prisma.loyaltyEvent.count({ where: { tenantId: ctx.tenantId, kind: "REDEEM" } }),
    ]);
    return {
      active: program?.active ?? false,
      mode: program?.mode ?? "STAMPS",
      centsPerPoint: program?.centsPerPoint ?? 100000,
      rewards: (program?.rewards ?? []).map((r) => ({ id: r.id, name: r.name, cost: r.cost, active: r.active })),
      stats: { customers, redeemed },
    };
  });

  app.put("/admin/loyalty", async (req) => {
    const ctx = await requireAdmin(req);
    const body = ProgramBody.parse(req.body);
    if (body.active && !body.rewards.some((r) => r.active)) {
      throw new HttpError(400, "REWARD_REQUIRED", "Agregá al menos un premio activo");
    }
    await prisma.$transaction(async (tx) => {
      const program = await tx.loyaltyProgram.upsert({
        where: { tenantId: ctx.tenantId },
        create: { tenantId: ctx.tenantId, active: body.active, mode: body.mode, centsPerPoint: body.centsPerPoint },
        update: { active: body.active, mode: body.mode, centsPerPoint: body.centsPerPoint },
      });
      const keep = body.rewards.filter((r) => r.id).map((r) => r.id!);
      // Premios quitados: se borran (los canjes guardan el nombre como snapshot)
      await tx.loyaltyReward.deleteMany({ where: { programId: program.id, id: { notIn: keep } } });
      for (const [position, r] of body.rewards.entries()) {
        const data = { name: r.name, cost: r.cost, active: r.active, position };
        if (r.id) {
          const upd = await tx.loyaltyReward.updateMany({ where: { id: r.id, programId: program.id }, data });
          if (upd.count === 0) throw notFound("Premio");
        } else {
          await tx.loyaltyReward.create({ data: { ...data, tenantId: ctx.tenantId, programId: program.id } });
        }
      }
      await audit(tx, ctx, "loyalty.updated", "LoyaltyProgram", program.id, { active: body.active, mode: body.mode });
    });
    return { ok: true };
  });

  // ───── Cliente: su tarjeta ─────

  app.get("/customer/me/loyalty", async (req) => {
    const me = await requireCustomer(req);
    const summary = await loyaltySummary(prisma, me.tid, me.sub);
    if (!summary.active) return summary;
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const [month, events] = await Promise.all([
      prisma.loyaltyEvent.aggregate({
        where: { customerId: me.sub, mode: summary.mode, kind: "EARN", createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.loyaltyEvent.findMany({
        where: { customerId: me.sub, mode: summary.mode },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { kind: true, amount: true, sessionId: true, rewardName: true, createdAt: true },
      }),
    ]);
    return { ...summary, earnedThisMonth: month._sum.amount ?? 0, events };
  });

  // ───── Mozo: clientes de la mesa y canje ─────

  app.get("/staff/sessions/:id/customers", async (req) => {
    const staff = await requireStaff(req, REDEEM_ROLES);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const session = await prisma.tableSession.findFirst({ where: { id, ...staffScope(staff) }, select: { id: true } });
    if (!session) throw notFound("Sesión");
    const devices = await prisma.guestDevice.findMany({
      where: { sessionId: id, customerId: { not: null } },
      select: { customer: { select: { id: true, name: true, email: true } } },
    });
    const unique = new Map(devices.map((d) => [d.customer!.id, d.customer!]));
    const result = [];
    for (const c of unique.values()) {
      const summary = await loyaltySummary(prisma, staff.tid, c.id);
      // El mozo ve el nombre y el email enmascarado (para confirmar con el cliente), no el email completo
      result.push({ id: c.id, name: c.name, email: c.email.replace(/^(.).*(@.*)$/, "$1•••$2"), loyalty: summary });
    }
    return result;
  });

  app.post("/staff/loyalty/redeem", async (req) => {
    const staff = await requireStaff(req, REDEEM_ROLES);
    const body = z.object({ sessionId: z.uuid(), customerId: z.uuid(), rewardId: z.uuid() }).parse(req.body);

    return prisma.$transaction(async (tx) => {
      const session = await tx.tableSession.findFirst({ where: { id: body.sessionId, ...staffScope(staff) } });
      if (!session) throw notFound("Sesión");
      // El cliente tiene que estar en esa mesa (se identificó desde un celular de la sesión)
      const here = await tx.guestDevice.findFirst({ where: { sessionId: session.id, customerId: body.customerId }, select: { id: true } });
      if (!here) throw notFound("Cliente");
      const program = await getProgram(tx, session.tenantId);
      if (!program?.active) throw conflict("LOYALTY_INACTIVE", "El programa de fidelización está apagado");
      const reward = program.rewards.find((r) => r.id === body.rewardId && r.active);
      if (!reward) throw notFound("Premio");

      // Bloquea al cliente: dos canjes simultáneos no pueden gastar el mismo saldo
      await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${body.customerId}::uuid AND "tenantId" = ${session.tenantId}::uuid FOR UPDATE`;
      const balance = await balanceOf(tx, body.customerId, program.mode);
      if (balance < reward.cost) {
        throw conflict("INSUFFICIENT_BALANCE", `Le faltan ${reward.cost - balance} ${program.mode === "STAMPS" ? "sellos" : "puntos"}`);
      }
      const event = await tx.loyaltyEvent.create({
        data: {
          tenantId: session.tenantId,
          customerId: body.customerId,
          kind: "REDEEM",
          mode: program.mode,
          amount: -reward.cost,
          rewardId: reward.id,
          rewardName: reward.name,
          staffId: staff.sub,
        },
      });
      await tx.auditLog.create({
        data: { tenantId: session.tenantId, actorId: staff.sub, action: "loyalty.redeemed", entity: "Customer", entityId: body.customerId, data: { reward: reward.name, cost: reward.cost } },
      });
      await emit(tx, {
        tenantId: session.tenantId,
        venueId: session.venueId,
        type: "loyalty.redeemed",
        channels: [channels.session(session.id)],
        payload: { reward: reward.name },
      });
      return { ok: true, eventId: event.id, balance: balance - reward.cost };
    });
  });
}
