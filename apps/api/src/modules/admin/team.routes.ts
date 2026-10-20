import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { invalidateStaffStatus } from "../../shared/auth/guards.js";
import { hashPassword } from "../../shared/auth/password.js";
import type { StaffRole } from "../../shared/auth/tokens.js";
import { prisma } from "../../shared/db/index.js";
import { conflict, forbidden, notFound } from "../../shared/errors.js";
import { audit, requireAdmin } from "./context.js";
import { IdParams, StaffCreate, StaffUpdate, VenueUpdate } from "./schemas.js";

/** Qué roles puede asignar cada rol: un encargado no puede crear otro encargado */
const CAN_ASSIGN: Partial<Record<StaffRole, StaffRole[]>> = {
  OWNER: ["MANAGER", "WAITER", "KITCHEN", "CASHIER"],
  MANAGER: ["WAITER", "KITCHEN", "CASHIER"],
};

const DAY = 24 * 60 * 60 * 1000;
const BILLABLE = ["APPROVED", "COMPLETED"] as const;

export async function adminTeamRoutes(app: FastifyInstance) {
  // ───── Resumen para el inicio del admin ─────
  app.get("/admin/overview", async (req) => {
    const ctx = await requireAdmin(req);
    const since24h = new Date(Date.now() - DAY);
    const since7d = new Date(Date.now() - 7 * DAY);
    const [venue, sub, orders24h, activeSessions, counts, top] = await Promise.all([
      prisma.venue.findUniqueOrThrow({ where: { id: ctx.venueId }, select: { id: true, name: true, currency: true } }),
      prisma.subscription.findUnique({ where: { tenantId: ctx.tenantId } }),
      prisma.order.aggregate({
        where: { venueId: ctx.venueId, createdAt: { gte: since24h }, status: { in: [...BILLABLE] } },
        _count: true,
        _sum: { totalCents: true },
      }),
      prisma.tableSession.count({ where: { venueId: ctx.venueId, status: { not: "CLOSED" } } }),
      Promise.all([
        prisma.dish.count({ where: { tenantId: ctx.tenantId, active: true, category: { menuId: ctx.menuId } } }),
        prisma.diningTable.count({ where: { venueId: ctx.venueId, active: true } }),
        prisma.staffUser.count({ where: { tenantId: ctx.tenantId, active: true } }),
      ]),
      prisma.orderItem.groupBy({
        by: ["nameSnapshot"],
        where: { tenantId: ctx.tenantId, order: { venueId: ctx.venueId, createdAt: { gte: since7d }, status: { in: [...BILLABLE] } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 5,
      }),
    ]);
    return {
      venue,
      role: ctx.staff.role,
      guestBaseUrl: config.publicGuestUrl,
      plan: sub
        ? { plan: sub.plan, used: sub.tableSessionsThisMonth, limit: sub.tableSessionLimit, periodEnd: sub.currentPeriodEnd }
        : null,
      last24h: { orders: orders24h._count, salesCents: orders24h._sum.totalCents ?? 0 },
      activeSessions,
      counts: { dishes: counts[0], tables: counts[1], staff: counts[2] },
      topDishes7d: top.map((t) => ({ name: t.nameSnapshot, quantity: t._sum.quantity ?? 0 })),
    };
  });

  // ───── Equipo ─────
  app.get("/admin/staff", async (req) => {
    const ctx = await requireAdmin(req);
    return prisma.staffUser.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
    });
  });

  app.post("/admin/staff", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = StaffCreate.parse(req.body);
    if (!CAN_ASSIGN[ctx.staff.role]?.includes(body.role)) throw forbidden("ROLE_NOT_ALLOWED", "No podés crear ese rol");
    const exists = await prisma.staffUser.findUnique({ where: { email: body.email } });
    if (exists) throw conflict("EMAIL_ALREADY_REGISTERED", "Ese email ya está en uso");
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.staffUser.create({
        data: {
          tenantId: ctx.tenantId,
          venueId: ctx.venueId,
          name: body.name,
          email: body.email,
          role: body.role,
          passwordHash: hashPassword(body.password),
        },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      });
      await audit(tx, ctx, "staff.created", "StaffUser", u.id, { role: u.role, email: u.email });
      return u;
    });
    return reply.status(201).send(user);
  });

  app.patch("/admin/staff/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const body = StaffUpdate.parse(req.body);
    const target = await prisma.staffUser.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!target) throw notFound("Usuario");

    const self = target.id === ctx.staff.sub;
    // Nadie se cambia el propio rol ni se desactiva a sí mismo (evita quedarse afuera)
    if (self && (body.role !== undefined || body.active !== undefined)) {
      throw forbidden("CANNOT_EDIT_SELF", "No podés cambiar tu propio rol ni desactivarte");
    }
    // El dueño solo lo gestiona la plataforma; un encargado no toca a otros encargados
    if (!self && target.role === "OWNER") throw forbidden("ROLE_NOT_ALLOWED", "El dueño no se puede editar desde acá");
    if (!self && ctx.staff.role === "MANAGER" && target.role === "MANAGER") {
      throw forbidden("ROLE_NOT_ALLOWED", "Un encargado no puede editar a otro encargado");
    }
    if (body.role && !CAN_ASSIGN[ctx.staff.role]?.includes(body.role)) throw forbidden("ROLE_NOT_ALLOWED", "No podés asignar ese rol");

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.staffUser.update({
        where: { id },
        data: {
          name: body.name,
          role: body.role,
          active: body.active,
          ...(body.password ? { passwordHash: hashPassword(body.password) } : {}),
        },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      });
      await audit(tx, ctx, "staff.updated", "StaffUser", id, {
        role: body.role,
        active: body.active,
        passwordChanged: Boolean(body.password),
      });
      return u;
    });
    invalidateStaffStatus(id); // la baja o el cambio de rol aplica en el próximo request
    return updated;
  });

  // ───── Datos del local ─────
  app.get("/admin/venue", async (req) => {
    const ctx = await requireAdmin(req);
    const v = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.venueId } });
    return {
      id: v.id,
      name: v.name,
      currency: v.currency,
      timezone: v.timezone,
      layoutMode: (v.layout as { mode?: string } | null)?.mode ?? "classic",
      wifiSsid: v.wifiSsid,
      wifiPassword: v.wifiPassword,
      googleReviewUrl: v.googleReviewUrl,
    };
  });

  app.patch("/admin/venue", async (req) => {
    const ctx = await requireAdmin(req);
    const body = VenueUpdate.parse(req.body);
    const current = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.venueId } });
    const layout = { ...((current.layout as object | null) ?? {}), ...(body.layoutMode ? { mode: body.layoutMode } : {}) };
    await prisma.venue.update({
      where: { id: ctx.venueId },
      data: {
        name: body.name,
        layout,
        wifiSsid: body.wifiSsid === undefined ? undefined : body.wifiSsid || null,
        wifiPassword: body.wifiPassword === undefined ? undefined : body.wifiPassword || null,
        googleReviewUrl: body.googleReviewUrl === undefined ? undefined : body.googleReviewUrl || null,
      },
    });
    return { ok: true };
  });
}
