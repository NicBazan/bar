import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invalidateTenantStatus, invalidateStaffStatus, requireSuperAdmin } from "../../shared/auth/guards.js";
import { hashPassword } from "../../shared/auth/password.js";
import type { StaffClaims } from "../../shared/auth/tokens.js";
import { generateTempPassword } from "../../shared/codes.js";
import { prisma, type Tx } from "../../shared/db/index.js";
import { forbidden, notFound } from "../../shared/errors.js";
import { RegisterOnboardingBody, provisionTenant } from "../onboarding/onboarding.controller.js";

/**
 * Panel de la plataforma (dueños del producto): ve y gestiona TODOS los bares.
 * - Solo SUPER_ADMIN del tenant de la plataforma (requireSuperAdmin).
 * - Cada acción que cambia algo queda en el AuditLog del bar afectado.
 * - Nunca expone hashes de contraseñas ni datos de comensales.
 */

const DAY = 24 * 60 * 60 * 1000;
const BILLABLE = ["APPROVED", "COMPLETED"] as const;
const TenantParams = z.object({ id: z.uuid() });

async function bar(id: string) {
  const t = await prisma.tenant.findFirst({ where: { id, isPlatform: false } });
  if (!t) throw notFound("Bar");
  return t;
}

async function log(tx: Tx, admin: StaffClaims, tenantId: string, action: string, data?: Record<string, unknown>) {
  await tx.auditLog.create({
    data: { tenantId, actorId: admin.sub, action: `superadmin.${action}`, entity: "Tenant", entityId: tenantId, data: (data ?? {}) as object },
  });
}

export async function superAdminRoutes(app: FastifyInstance) {
  // ───── Métricas de la plataforma ─────
  app.get("/superadmin/stats", async (req) => {
    await requireSuperAdmin(req);
    const since30 = new Date(Date.now() - 30 * DAY);
    const since1 = new Date(Date.now() - DAY);
    const [tenants, byPlan, suspended, sessions30, sessions1, orders30] = await Promise.all([
      prisma.tenant.count({ where: { isPlatform: false } }),
      prisma.subscription.groupBy({ by: ["plan"], where: { tenant: { isPlatform: false } }, _count: true }),
      prisma.tenant.count({ where: { isPlatform: false, suspendedAt: { not: null } } }),
      prisma.tableSession.count({ where: { openedAt: { gte: since30 }, status: { not: "PENDING" } } }),
      prisma.tableSession.count({ where: { openedAt: { gte: since1 }, status: { not: "PENDING" } } }),
      prisma.order.aggregate({ where: { createdAt: { gte: since30 }, status: { in: [...BILLABLE] } }, _count: true, _sum: { totalCents: true } }),
    ]);
    return {
      tenants,
      suspended,
      plans: Object.fromEntries(byPlan.map((p) => [p.plan, p._count])),
      sessions: { last24h: sessions1, last30d: sessions30 },
      orders30d: { count: orders30._count, gmvCents: orders30._sum.totalCents ?? 0 },
    };
  });

  // ───── Listado de bares ─────
  app.get("/superadmin/tenants", async (req) => {
    await requireSuperAdmin(req);
    const { q } = z.object({ q: z.string().trim().max(80).optional() }).parse(req.query);
    const since30 = new Date(Date.now() - 30 * DAY);
    const tenants = await prisma.tenant.findMany({
      where: {
        isPlatform: false,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { slug: { contains: q, mode: "insensitive" } },
                { staffUsers: { some: { email: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: {
        subscription: true,
        staffUsers: { where: { role: "OWNER" }, select: { name: true, email: true }, take: 1 },
        _count: { select: { venues: true, staffUsers: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Actividad de los últimos 30 días por bar (2 consultas agrupadas, no N+1)
    const ids = tenants.map((t) => t.id);
    const [orders, sessions] = await Promise.all([
      prisma.order.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: ids }, createdAt: { gte: since30 }, status: { in: [...BILLABLE] } },
        _count: true,
        _sum: { totalCents: true },
      }),
      prisma.tableSession.groupBy({
        by: ["tenantId"],
        where: { tenantId: { in: ids }, openedAt: { gte: since30 }, status: { not: "PENDING" } },
        _count: true,
      }),
    ]);
    const ordersBy = new Map(orders.map((o) => [o.tenantId, o]));
    const sessionsBy = new Map(sessions.map((s) => [s.tenantId, s._count]));

    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      createdAt: t.createdAt,
      suspendedAt: t.suspendedAt,
      suspendReason: t.suspendReason,
      owner: t.staffUsers[0] ?? null,
      counts: { venues: t._count.venues, staff: t._count.staffUsers },
      subscription: t.subscription
        ? {
            plan: t.subscription.plan,
            used: t.subscription.tableSessionsThisMonth,
            limit: t.subscription.tableSessionLimit,
            periodEnd: t.subscription.currentPeriodEnd,
          }
        : null,
      last30d: {
        sessions: sessionsBy.get(t.id) ?? 0,
        orders: ordersBy.get(t.id)?._count ?? 0,
        salesCents: ordersBy.get(t.id)?._sum.totalCents ?? 0,
      },
    }));
  });

  // ───── Detalle de un bar ─────
  app.get("/superadmin/tenants/:id", async (req) => {
    await requireSuperAdmin(req);
    const { id } = TenantParams.parse(req.params);
    await bar(id);
    const [tenant, audit] = await Promise.all([
      prisma.tenant.findUniqueOrThrow({
        where: { id },
        include: {
          subscription: true,
          venues: { select: { id: true, name: true, createdAt: true, _count: { select: { tables: true } } } },
          staffUsers: {
            select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
            orderBy: [{ role: "asc" }, { name: "asc" }],
          },
        },
      }),
      prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return { ...tenant, audit };
  });

  // ───── Alta de un bar para un cliente ─────
  app.post("/superadmin/tenants", async (req, reply) => {
    const admin = await requireSuperAdmin(req);
    const body = RegisterOnboardingBody.extend({
      plan: z.enum(["FREE", "PRO"]).default("FREE"),
      tableSessionLimit: z.number().int().min(1).max(100000).default(50),
    }).parse(req.body);
    const result = await provisionTenant(body, { plan: body.plan, tableSessionLimit: body.tableSessionLimit });
    await prisma.$transaction((tx) => log(tx, admin, result.tenant.id, "tenant_created", { plan: body.plan }));
    return reply.status(201).send({
      tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug },
      owner: { email: result.owner.email },
      tables: result.tables.length,
    });
  });

  // ───── Plan y cuota ─────
  app.patch("/superadmin/tenants/:id/subscription", async (req) => {
    const admin = await requireSuperAdmin(req);
    const { id } = TenantParams.parse(req.params);
    const body = z
      .object({
        plan: z.enum(["FREE", "PRO", "CANCELED"]).optional(),
        tableSessionLimit: z.number().int().min(1).max(100000).optional(),
        resetUsage: z.boolean().optional(),
        extendDays: z.number().int().min(1).max(366).optional(),
      })
      .parse(req.body);
    await bar(id);
    return prisma.$transaction(async (tx) => {
      const sub =
        (await tx.subscription.findUnique({ where: { tenantId: id } })) ??
        (await tx.subscription.create({ data: { tenantId: id, currentPeriodEnd: new Date(Date.now() + 30 * DAY) } }));
      const base = Math.max(sub.currentPeriodEnd.getTime(), Date.now());
      const updated = await tx.subscription.update({
        where: { tenantId: id },
        data: {
          plan: body.plan,
          tableSessionLimit: body.tableSessionLimit,
          ...(body.resetUsage ? { tableSessionsThisMonth: 0 } : {}),
          ...(body.extendDays ? { currentPeriodEnd: new Date(base + body.extendDays * DAY) } : {}),
        },
      });
      await log(tx, admin, id, "subscription_changed", body);
      return updated;
    });
  });

  // ───── Suspender / reactivar ─────
  app.post("/superadmin/tenants/:id/:action", async (req) => {
    const admin = await requireSuperAdmin(req);
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(["suspend", "unsuspend"]) }).parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {});
    await bar(id);
    const t = await prisma.$transaction(async (tx) => {
      const updated = await tx.tenant.update({
        where: { id },
        data: action === "suspend" ? { suspendedAt: new Date(), suspendReason: reason ?? null } : { suspendedAt: null, suspendReason: null },
        select: { id: true, suspendedAt: true, suspendReason: true },
      });
      await log(tx, admin, id, action === "suspend" ? "tenant_suspended" : "tenant_unsuspended", { reason });
      return updated;
    });
    invalidateTenantStatus(id); // corta el acceso del staff y de la carta en el próximo request
    return t;
  });

  // ───── Soporte: contraseña temporal para un usuario de un bar ─────
  app.post("/superadmin/staff/:id/reset-password", async (req) => {
    const admin = await requireSuperAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const user = await prisma.staffUser.findUnique({ where: { id }, include: { tenant: { select: { isPlatform: true } } } });
    if (!user) throw notFound("Usuario");
    if (user.tenant.isPlatform) throw forbidden("ROLE_NOT_ALLOWED", "Las cuentas de la plataforma no se resetean desde acá");
    const temp = generateTempPassword();
    await prisma.$transaction(async (tx) => {
      await tx.staffUser.update({ where: { id }, data: { passwordHash: hashPassword(temp), active: true } });
      await log(tx, admin, user.tenantId, "password_reset", { userId: id, email: user.email });
    });
    invalidateStaffStatus(id);
    // Se muestra UNA vez: no se guarda en claro en ningún lado
    return { email: user.email, temporaryPassword: temp };
  });

  // ───── Registro de auditoría global ─────
  app.get("/superadmin/audit", async (req) => {
    await requireSuperAdmin(req);
    const { tenantId } = z.object({ tenantId: z.uuid().optional() }).parse(req.query);
    const rows = await prisma.auditLog.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.tenantId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => ({ ...r, id: Number(r.id), tenantName: names.get(r.tenantId) ?? "?" }));
  });
}

