import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { assertTenantActive, requireCustomer } from "../../shared/auth/guards.js";
import { signToken, verifyToken } from "../../shared/auth/tokens.js";
import { prisma, type Tx } from "../../shared/db/index.js";
import { sendEmail } from "../../shared/email/index.js";
import { HttpError, notFound } from "../../shared/errors.js";
import { customerCodeKey } from "../../shared/rate-limit/keys.js";
import { getVenueMenu } from "../catalog/service.js";
import { awardSession } from "../loyalty/service.js";

/** El código de ingreso vence a los 10 minutos y admite 5 intentos */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** Entre dos códigos para el mismo email: evita usar el bar para mandar spam a un tercero */
const CODE_RESEND_MS = 30 * 1000;

const Email = z.string().trim().toLowerCase().max(200).pipe(z.email());

const RequestCodeBody = z.object({ venueId: z.uuid(), email: Email });
const VerifyBody = z.object({
  venueId: z.uuid(),
  email: Email,
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(60).optional(),
  // Consentimiento informado: obligatorio solo al crear la cuenta (Ley 25.326)
  acceptPrivacy: z.boolean().optional(),
  // Token de la mesa actual: vincula esta visita a la cuenta
  guestToken: z.string().max(2000).optional(),
});

const hashCode = (tenantId: string, email: string, code: string) =>
  createHmac("sha256", config.jwtSecret).update(`${tenantId}|${email}|${code}`).digest("hex");

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

async function venueTenant(venueId: string) {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true, name: true, tenantId: true, tenant: { select: { isPlatform: true } } },
  });
  if (!venue || venue.tenant.isPlatform) throw notFound("Local");
  await assertTenantActive(venue.tenantId);
  return venue;
}

/**
 * Vincula el celular de la mesa (y sus pedidos de esta visita) a la cuenta del cliente.
 * Solo si el token de mesa es válido y del MISMO bar que la cuenta.
 */
export async function linkGuestToken(tx: Tx, guestToken: string, customer: { id: string; tenantId: string }) {
  const claims = await verifyToken(guestToken);
  if (!claims || claims.typ !== "guest" || claims.tid !== customer.tenantId) return false;
  const device = await tx.guestDevice.updateMany({
    where: { id: claims.did, tenantId: claims.tid, sessionId: claims.sid },
    data: { customerId: customer.id },
  });
  if (device.count === 0) return false;
  await tx.order.updateMany({
    where: { tenantId: claims.tid, sessionId: claims.sid, deviceId: claims.did, customerId: null },
    data: { customerId: customer.id },
  });
  // Si la mesa ya se cerró (guardó la cuenta al irse), la visita suma igual
  await awardSession(tx, claims.sid);
  return true;
}

const COUNTED: Array<"APPROVED" | "COMPLETED"> = ["APPROVED", "COMPLETED"];

export async function customerRoutes(app: FastifyInstance) {
  // ───── Ingreso con código por email (sin contraseña) ─────

  app.post(
    "/customer/auth/request-code",
    {
      config: {
        // Por email+bar (no por IP: detrás de Next todos comparten IP); el tope global protege el resto
        rateLimit: { max: 5, timeWindow: "15 minutes", keyGenerator: customerCodeKey, hook: "preHandler" },
      },
    },
    async (req) => {
      const { venueId, email } = RequestCodeBody.parse(req.body);
      const venue = await venueTenant(venueId);

      const last = await prisma.customerLoginCode.findFirst({
        where: { tenantId: venue.tenantId, email },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      // Misma respuesta exista o no la cuenta, y aunque se haya pedido hace instantes
      if (last && Date.now() - last.createdAt.getTime() < CODE_RESEND_MS) {
        return { ok: true, expiresInSec: CODE_TTL_MS / 1000 };
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await prisma.$transaction([
        // Un código nuevo invalida los anteriores
        prisma.customerLoginCode.updateMany({
          where: { tenantId: venue.tenantId, email, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.customerLoginCode.create({
          data: {
            tenantId: venue.tenantId,
            email,
            codeHash: hashCode(venue.tenantId, email, code),
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
          },
        }),
      ]);

      await sendEmail({
        to: email,
        subject: `${code} es tu código para ${venue.name}`,
        text: `Tu código para entrar a "Mi cuenta" en ${venue.name} es: ${code}\n\nVence en 10 minutos. Si no lo pediste, ignorá este email.`,
      });
      return { ok: true, expiresInSec: CODE_TTL_MS / 1000 };
    },
  );

  app.post(
    "/customer/auth/verify",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator: customerCodeKey, hook: "preHandler" } } },
    async (req) => {
      const body = VerifyBody.parse(req.body);
      const venue = await venueTenant(body.venueId);
      const tenantId = venue.tenantId;

      const row = await prisma.customerLoginCode.findFirst({
        where: { tenantId, email: body.email, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (!row) throw new HttpError(400, "CODE_INVALID", "El código venció. Pedí uno nuevo.");
      if (row.attempts >= CODE_MAX_ATTEMPTS) {
        throw new HttpError(429, "CODE_LOCKED", "Demasiados intentos. Pedí un código nuevo.");
      }
      if (!safeEqualHex(row.codeHash, hashCode(tenantId, body.email, body.code))) {
        const upd = await prisma.customerLoginCode.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 } },
          select: { attempts: true },
        });
        const left = Math.max(0, CODE_MAX_ATTEMPTS - upd.attempts);
        throw new HttpError(400, "CODE_INVALID", left ? `Código incorrecto. Te quedan ${left} intento(s).` : "Demasiados intentos. Pedí un código nuevo.");
      }

      const existing = await prisma.customer.findUnique({
        where: { tenantId_email: { tenantId, email: body.email } },
        select: { id: true },
      });
      if (!existing && body.acceptPrivacy !== true) {
        // El código sigue sirviendo: el cliente solo tiene que aceptar y reintentar
        throw new HttpError(400, "PRIVACY_REQUIRED", "Para crear tu cuenta tenés que aceptar la política de privacidad.");
      }

      const result = await prisma.$transaction(async (tx) => {
        // Consumo atómico: dos verificaciones simultáneas con el mismo código, solo una gana
        const used = await tx.customerLoginCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
        if (used.count === 0) throw new HttpError(400, "CODE_INVALID", "El código ya se usó. Pedí uno nuevo.");
        const customer = existing
          ? await tx.customer.update({
              where: { id: existing.id },
              data: { lastLoginAt: new Date(), ...(body.name ? { name: body.name } : {}) },
            })
          : await tx.customer.create({
              data: { tenantId, email: body.email, name: body.name, privacyAcceptedAt: new Date(), lastLoginAt: new Date() },
            });
        const linked = body.guestToken ? await linkGuestToken(tx, body.guestToken, customer) : false;
        return { customer, linked };
      });

      const token = await signToken({ typ: "customer", sub: result.customer.id, tid: tenantId });
      return {
        token,
        isNew: !existing,
        linkedVisit: result.linked,
        customer: { id: result.customer.id, email: result.customer.email, name: result.customer.name },
      };
    },
  );

  /** Vincular la visita actual (celular ya reconocido que se sienta a otra mesa) */
  app.post("/customer/link", async (req) => {
    const me = await requireCustomer(req);
    const { guestToken } = z.object({ guestToken: z.string().max(2000) }).parse(req.body);
    const linked = await prisma.$transaction((tx) => linkGuestToken(tx, guestToken, { id: me.sub, tenantId: me.tid }));
    return { linked };
  });

  // ───── Mi cuenta ─────

  app.get("/customer/me", async (req) => {
    const me = await requireCustomer(req);
    const [visits, spent, lastOrder] = await Promise.all([
      prisma.order.groupBy({ by: ["sessionId"], where: { customerId: me.sub, tenantId: me.tid, status: { in: COUNTED } } }),
      prisma.order.aggregate({ where: { customerId: me.sub, tenantId: me.tid, status: { in: COUNTED } }, _sum: { totalCents: true } }),
      prisma.order.findFirst({ where: { customerId: me.sub, tenantId: me.tid }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: me.sub }, select: { createdAt: true } });
    return {
      id: me.sub,
      email: me.email,
      name: me.name,
      createdAt: c.createdAt,
      stats: { visits: visits.length, spentCents: spent._sum.totalCents ?? 0, lastVisitAt: lastOrder?.createdAt ?? null },
    };
  });

  app.patch("/customer/me", async (req) => {
    const me = await requireCustomer(req);
    const body = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    await prisma.customer.update({ where: { id: me.sub }, data: { name: body.name } });
    return { ok: true };
  });

  /** Historial: una entrada por visita (sesión de mesa) con sus pedidos */
  app.get("/customer/me/history", async (req) => {
    const me = await requireCustomer(req);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const orders = await prisma.order.findMany({
      where: { customerId: me.sub, tenantId: me.tid },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true,
        status: true,
        totalCents: true,
        createdAt: true,
        sessionId: true,
        venue: { select: { id: true, name: true, currency: true } },
        session: { select: { table: { select: { label: true } } } },
        items: { select: { nameSnapshot: true, variantName: true, modifiers: true, quantity: true, unitPriceCents: true, status: true } },
      },
    });
    const visits = new Map<string, {
      sessionId: string;
      venue: { id: string; name: string; currency: string };
      tableLabel: string;
      date: Date;
      totalCents: number;
      orders: Array<Omit<(typeof orders)[number], "venue" | "session" | "sessionId">>;
    }>();
    for (const o of orders) {
      let v = visits.get(o.sessionId);
      if (!v) {
        if (visits.size >= limit) continue;
        v = { sessionId: o.sessionId, venue: o.venue, tableLabel: o.session.table.label, date: o.createdAt, totalCents: 0, orders: [] };
        visits.set(o.sessionId, v);
      }
      const { venue: _v, session: _s, sessionId: _id, ...order } = o;
      v.orders.push(order);
      if (COUNTED.includes(o.status as "APPROVED")) v.totalCents += o.totalCents;
    }
    return [...visits.values()];
  });

  /**
   * "Pedir lo mismo": traduce un pedido viejo a la carta de hoy (ids actuales de opciones y extras).
   * Lo que ya no existe o está agotado vuelve marcado para que la carta avise.
   */
  app.get("/customer/me/orders/:id/reorder", async (req) => {
    const me = await requireCustomer(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const order = await prisma.order.findFirst({
      where: { id, customerId: me.sub, tenantId: me.tid },
      select: { venueId: true, items: { select: { dishId: true, nameSnapshot: true, variantName: true, modifiers: true, quantity: true, note: true } } },
    });
    if (!order) throw notFound("Pedido");
    const menu = await getVenueMenu(order.venueId);
    const dishes = new Map(menu.categories.flatMap((c) => c.dishes).map((d) => [d.id, d]));

    const items = order.items.map((it) => {
      const dish = dishes.get(it.dishId);
      if (!dish || !dish.available) return { name: it.nameSnapshot, available: false as const };
      const variant = it.variantName ? dish.variants.find((v) => v.name === it.variantName) : undefined;
      if (dish.variants.length > 0 && !variant) return { name: it.nameSnapshot, available: false as const };
      const wanted = (it.modifiers as Array<{ name: string }>).map((m) => m.name);
      const mods = dish.modifierGroups.flatMap((g) => g.modifiers).filter((m) => wanted.includes(m.name));
      if (mods.length !== wanted.length) return { name: it.nameSnapshot, available: false as const };
      return {
        available: true as const,
        dishId: dish.id,
        name: dish.name,
        variantId: variant?.id,
        variantName: variant?.name,
        modifierIds: mods.map((m) => m.id),
        modifierNames: mods.map((m) => m.name),
        note: it.note ?? undefined,
        quantity: it.quantity,
        priceCents: (variant?.priceCents ?? dish.priceCents) + mods.reduce((s, m) => s + m.priceCents, 0),
      };
    });
    return { venueId: order.venueId, items };
  });

  // ───── Derechos del titular (Ley 25.326): acceso y supresión ─────

  app.get("/customer/me/export", async (req, reply) => {
    const me = await requireCustomer(req);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: me.sub },
      select: {
        email: true,
        name: true,
        createdAt: true,
        privacyAcceptedAt: true,
        lastLoginAt: true,
        marketingOptInAt: true,
        tenant: { select: { name: true } },
        loyaltyEvents: { orderBy: { createdAt: "asc" }, select: { kind: true, mode: true, amount: true, rewardName: true, createdAt: true } },
        pushSubs: { select: { createdAt: true } },
        orders: {
          orderBy: { createdAt: "asc" },
          select: {
            createdAt: true,
            status: true,
            totalCents: true,
            venue: { select: { name: true } },
            items: { select: { nameSnapshot: true, variantName: true, modifiers: true, quantity: true, unitPriceCents: true } },
          },
        },
      },
    });
    reply.header("Content-Disposition", 'attachment; filename="mis-datos.json"');
    return { exportedAt: new Date(), ...customer };
  });

  /** Borra la cuenta: los pedidos quedan en el bar pero anónimos (el bar los necesita para su caja) */
  app.delete("/customer/me", async (req) => {
    const me = await requireCustomer(req);
    await prisma.$transaction(async (tx) => {
      await tx.customer.delete({ where: { id: me.sub } });
      await tx.customerLoginCode.deleteMany({ where: { tenantId: me.tid, email: me.email } });
      await tx.auditLog.create({ data: { tenantId: me.tid, action: "customer.deleted", entity: "Customer", entityId: me.sub } });
    });
    return { ok: true };
  });
}
