import { randomInt } from "node:crypto";
import { StaffLoginBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { FLOOR_ROLES, STAFF_COOKIE, requireStaff, staffScope } from "../../shared/auth/guards.js";
import { hashPassword, verifyPassword } from "../../shared/auth/password.js";
import { signToken } from "../../shared/auth/tokens.js";
import { prisma } from "../../shared/db/index.js";
import { loginKey } from "../../shared/rate-limit/keys.js";
import { HttpError, conflict, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";
import { assertTenantCanOpenSession, incrementSessionUsage } from "../billing/billing.guard.js";
import { awardSession } from "../loyalty/service.js";

// Hash con el mismo costo que uno real, para igualar tiempos cuando el email no existe
const DUMMY_HASH = hashPassword("usuario-inexistente-para-igualar-tiempos");

export async function staffRoutes(app: FastifyInstance) {
  app.post(
    "/staff/login",
    // 10 intentos por minuto POR CUENTA (la clave se calcula con el body: hook preHandler)
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: loginKey, hook: "preHandler" } } },
    async (req, reply) => {
      const { email, password } = StaffLoginBody.parse(req.body);
      const user = await prisma.staffUser.findUnique({
        where: { email: email.toLowerCase() },
        include: { tenant: { select: { suspendedAt: true } } },
      });
      // Siempre se corre scrypt (con un hash falso si el email no existe): el tiempo de respuesta
      // no revela qué emails están registrados
      const passwordOk = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.active || !passwordOk) {
        throw new HttpError(401, "INVALID_CREDENTIALS");
      }
      if (user.tenant.suspendedAt) {
        throw new HttpError(403, "TENANT_SUSPENDED", "Este local está suspendido. Contactá a soporte.");
      }
      const token = await signToken({ typ: "staff", sub: user.id, tid: user.tenantId, vid: user.venueId, role: user.role });
      reply.setCookie(STAFF_COOKIE, token, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "strict",
        path: "/",
        maxAge: 12 * 60 * 60,
      });
      return { token, user: { id: user.id, name: user.name, role: user.role, venueId: user.venueId } };
    },
  );

  // Una cookie HttpOnly solo la puede borrar el servidor (lección de taller)
  app.post("/staff/logout", async (_req, reply) => {
    reply.clearCookie(STAFF_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: "strict", path: "/" });
    return { ok: true };
  });

  // Mesas activas (incluye las PENDING que esperan que el mozo las abra)
  app.get("/staff/sessions", async (req) => {
    const staff = await requireStaff(req);
    return prisma.tableSession.findMany({
      where: { ...staffScope(staff), status: { not: "CLOSED" } },
      include: { table: { select: { label: true } }, _count: { select: { devices: true, orders: true } } },
      orderBy: { openedAt: "asc" },
    });
  });

  app.post("/staff/sessions/:id/:action", async (req) => {
    const staff = await requireStaff(req, FLOOR_ROLES);
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(["open", "close", "new-pin"]) }).parse(req.params);

    return prisma.$transaction(async (tx) => {
      const session = await tx.tableSession.findFirst({ where: { id, ...staffScope(staff) } });
      if (!session) throw notFound("Sesión");

      if (action === "open") {
        if (session.status !== "PENDING") throw conflict("SESSION_NOT_PENDING");
        // Abrir la mesa consume una sesión del plan (402 si el bar FREE llegó al límite del mes)
        await assertTenantCanOpenSession(tx, session.tenantId);
        await incrementSessionUsage(tx, session.tenantId);
        const updated = await tx.tableSession.update({
          where: { id },
          data: { status: "OPEN", approvedById: staff.sub },
        });
        await emit(tx, {
          tenantId: session.tenantId,
          venueId: session.venueId,
          type: "session.opened",
          channels: [channels.staff(session.venueId), channels.session(id)],
          payload: { sessionId: id },
        });
        return updated;
      }

      if (session.status === "CLOSED") throw conflict("SESSION_ALREADY_CLOSED");

      if (action === "new-pin") {
        // PIN nuevo y desbloqueo (por intentos fallidos o porque el PIN se filtró)
        const updated = await tx.tableSession.update({
          where: { id },
          data: { joinPin: String(randomInt(0, 10000)).padStart(4, "0"), pinFailures: 0 },
        });
        await emit(tx, {
          tenantId: session.tenantId,
          venueId: session.venueId,
          type: "session.pin_changed",
          channels: [channels.staff(session.venueId), channels.session(id)],
          payload: { sessionId: id },
        });
        return updated;
      }

      const updated = await tx.tableSession.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
      // Pedidos que nadie confirmó no deben quedar flotando: se cancelan con la mesa
      const stale = await tx.order.findMany({ where: { sessionId: id, status: "PENDING_APPROVAL" }, select: { id: true } });
      if (stale.length > 0) {
        const ids = stale.map((o) => o.id);
        await tx.order.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED" } });
        await tx.orderItem.updateMany({ where: { orderId: { in: ids } }, data: { status: "VOIDED", voidReason: "Mesa cerrada" } });
      }
      // Fidelización: sellos o puntos para los clientes identificados en esta visita
      await awardSession(tx, id);
      // Llamados abiertos se resuelven al cerrar la mesa
      await tx.serviceCall.updateMany({
        where: { sessionId: id, status: { not: "RESOLVED" } },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await emit(tx, {
        tenantId: session.tenantId,
        venueId: session.venueId,
        type: "session.closed",
        channels: [channels.staff(session.venueId), channels.session(id)],
        payload: { sessionId: id },
      });
      return updated;
    });
  });
}
