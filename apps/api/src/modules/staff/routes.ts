import { StaffLoginBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { FLOOR_ROLES, STAFF_COOKIE, requireStaff, staffScope } from "../../shared/auth/guards.js";
import { hashPassword, verifyPassword } from "../../shared/auth/password.js";
import { signToken } from "../../shared/auth/tokens.js";
import { prisma, type Tx } from "../../shared/db/index.js";
import { type SessionRef, closeSession, openSession, rotatePin } from "../table-session/lifecycle.js";
import { receiptOf } from "../table-session/receipt.js";
import { loginKey } from "../../shared/rate-limit/keys.js";
import { HttpError, notFound } from "../../shared/errors.js";

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

  // Acciones del mozo sobre una mesa (Command): cada una es una transición de lifecycle.ts
  app.post("/staff/sessions/:id/:action", async (req) => {
    const staff = await requireStaff(req, FLOOR_ROLES);
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(["open", "close", "new-pin"]) }).parse(req.params);
    return prisma.$transaction(async (tx) => {
      const session = await tx.tableSession.findFirst({ where: { id, ...staffScope(staff) }, select: { id: true, tenantId: true, venueId: true } });
      if (!session) throw notFound("Sesión");
      return SESSION_ACTIONS[action](tx, session, staff.sub);
    });
  });

  // Comprobante de la mesa para el mozo o la caja: provisorio mientras está abierta, final al cerrarla
  app.get("/staff/sessions/:id/receipt", async (req) => {
    const staff = await requireStaff(req, [...FLOOR_ROLES, "CASHIER"]);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const session = await prisma.tableSession.findFirst({ where: { id, ...staffScope(staff) }, select: { id: true } });
    if (!session) throw notFound("Sesión");
    return receiptOf(session.id);
  });
}

const SESSION_ACTIONS = {
  open: (tx: Tx, s: SessionRef, staffId: string) => openSession(tx, s, staffId),
  "new-pin": (tx: Tx, s: SessionRef) => rotatePin(tx, s),
  close: async (tx: Tx, s: SessionRef) => {
    const { receipt } = await closeSession(tx, s, "STAFF");
    return { ...(await tx.tableSession.findUniqueOrThrow({ where: { id: s.id } })), receipt };
  },
} satisfies Record<string, (tx: Tx, s: SessionRef, staffId: string) => Promise<unknown>>;
