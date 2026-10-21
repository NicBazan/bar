import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { requireCustomer } from "../../shared/auth/guards.js";
import { signUnsubToken, verifyUnsubToken } from "../../shared/auth/tokens.js";
import { Prisma, prisma, type Tx } from "../../shared/db/index.js";
import { sendEmail } from "../../shared/email/index.js";
import { HttpError, notFound } from "../../shared/errors.js";
import { isAllowedPushEndpoint, sendPush, vapid } from "../../shared/push.js";
import { audit, requireAdmin } from "../admin/context.js";

/** Tope de campañas por bar (mails y push a clientes): 1 por semana */
export const CAMPAIGN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const INACTIVE_DAYS = 30;

const PromoBody = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(500),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  active: z.boolean().optional(),
});
const datesOk = (p: { startsAt?: Date | null; endsAt?: Date | null }) => !p.startsAt || !p.endsAt || p.endsAt > p.startsAt;
const DATES_MSG = { message: "La fecha de fin tiene que ser posterior a la de inicio", path: ["endsAt"] };

const CampaignBody = z.object({
  promotionId: z.uuid().optional(),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(300),
  segment: z.enum(["ALL", "INACTIVE_30"]),
});

/** Promos vigentes hoy (activas y dentro de sus fechas) */
const liveWhere = (tenantId: string): Prisma.PromotionWhereInput => {
  const now = new Date();
  return {
    tenantId,
    active: true,
    AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
  };
};
const promoSelect = { id: true, title: true, body: true, startsAt: true, endsAt: true } as const;

/**
 * Destinatarios de una campaña: solo quienes aceptaron avisos de ESTE bar (email o push).
 * INACTIVE_30: su último pedido fue hace 30 días o más (o nunca pidió y se registró hace 30+).
 */
async function audience(db: Tx | typeof prisma, tenantId: string, segment: "ALL" | "INACTIVE_30") {
  const since = new Date(Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000);
  return db.customer.findMany({
    where: {
      tenantId,
      OR: [{ marketingOptInAt: { not: null } }, { pushSubs: { some: {} } }],
      ...(segment === "INACTIVE_30"
        ? { createdAt: { lte: since }, orders: { none: { createdAt: { gt: since } } } }
        : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      marketingOptInAt: true,
      pushSubs: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
    },
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function promotionRoutes(app: FastifyInstance) {
  // Baja "one-click" de los clientes de correo (RFC 8058): POST con cuerpo de formulario.
  // Solo dentro de este plugin; el contenido se ignora (el token viaja en la URL)
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 1024 }, (_req, _body, done) => done(null, {}));

  // ───── Público y cliente ─────

  /** Promos vigentes de un local (para la carta) */
  app.get("/venues/:venueId/promos", async (req) => {
    const { venueId } = z.object({ venueId: z.uuid() }).parse(req.params);
    const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { tenantId: true } });
    if (!venue) throw notFound("Local");
    return prisma.promotion.findMany({ where: liveWhere(venue.tenantId), select: promoSelect, orderBy: { createdAt: "desc" }, take: 10 });
  });

  app.get("/customer/promos", async (req) => {
    const me = await requireCustomer(req);
    return prisma.promotion.findMany({ where: liveWhere(me.tid), select: promoSelect, orderBy: { createdAt: "desc" }, take: 20 });
  });

  /** Preferencias de avisos. Con ?endpoint= dice si ESTE celular recibe los avisos de este bar */
  app.get("/customer/notifications", async (req) => {
    const me = await requireCustomer(req);
    const { endpoint } = z.object({ endpoint: z.string().max(1000).optional() }).parse(req.query);
    const [c, thisDevice] = await Promise.all([
      prisma.customer.findUniqueOrThrow({
        where: { id: me.sub },
        select: { marketingOptInAt: true, _count: { select: { pushSubs: true } } },
      }),
      endpoint ? prisma.pushSubscription.count({ where: { customerId: me.sub, endpoint } }) : 0,
    ]);
    return {
      emailOptIn: Boolean(c.marketingOptInAt),
      pushDevices: c._count.pushSubs,
      thisDevice: thisDevice > 0,
      tenantId: me.tid,
      vapidPublicKey: vapid.publicKey,
    };
  });

  /** Opt-in explícito de promos por email (nunca preseleccionado) */
  app.put("/customer/notifications/email", async (req) => {
    const me = await requireCustomer(req);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    await prisma.customer.update({ where: { id: me.sub }, data: { marketingOptInAt: enabled ? new Date() : null } });
    return { ok: true };
  });

  app.post("/customer/push/subscribe", async (req) => {
    const me = await requireCustomer(req);
    const body = z
      .object({
        endpoint: z.string().max(1000),
        keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
      })
      .parse(req.body);
    if (!isAllowedPushEndpoint(body.endpoint)) throw new HttpError(400, "PUSH_ENDPOINT_INVALID", "Servicio de notificaciones no soportado");
    const keys = { p256dh: body.keys.p256dh, auth: body.keys.auth };
    await prisma.pushSubscription.upsert({
      where: { customerId_endpoint: { customerId: me.sub, endpoint: body.endpoint } },
      create: { ...keys, tenantId: me.tid, customerId: me.sub, endpoint: body.endpoint },
      update: keys,
    });
    return { ok: true };
  });

  /**
   * Baja de push de este celular para un bar ("No recibir más" en la notificación, o el perfil).
   * Sin login: el endpoint es secreto y solo lo conoce ese navegador. Sin tenantId, de todos los bares.
   */
  app.post("/customer/push/unsubscribe", async (req) => {
    const { endpoint, tenantId } = z.object({ endpoint: z.string().min(1).max(1000), tenantId: z.uuid().optional() }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, ...(tenantId ? { tenantId } : {}) } });
    return { ok: true };
  });

  /**
   * Baja de promos por email en un toque: el link de cada email (token firmado, sin login).
   * Acepta el token por query (List-Unsubscribe-Post de los clientes de correo) o en el body.
   */
  app.post("/customer/unsubscribe", async (req) => {
    const q = z.object({ t: z.string().max(2000).optional() }).parse(req.query);
    const b = z.object({ t: z.string().max(2000).optional() }).catch({}).parse(req.body ?? {});
    const claims = await verifyUnsubToken(q.t ?? b.t ?? "");
    if (!claims) throw new HttpError(400, "UNSUB_INVALID", "El link de baja no es válido");
    await prisma.customer.updateMany({
      where: { id: claims.customerId, tenantId: claims.tenantId },
      data: { marketingOptInAt: null },
    });
    return { ok: true };
  });

  // ───── Admin: promociones ─────

  app.get("/admin/promotions", async (req) => {
    const ctx = await requireAdmin(req);
    return prisma.promotion.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/admin/promotions", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = PromoBody.refine(datesOk, DATES_MSG).parse(req.body);
    const promo = await prisma.$transaction(async (tx) => {
      const p = await tx.promotion.create({ data: { ...body, tenantId: ctx.tenantId } });
      await audit(tx, ctx, "promotion.created", "Promotion", p.id, { title: p.title });
      return p;
    });
    return reply.status(201).send(promo);
  });

  app.patch("/admin/promotions/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = PromoBody.partial().refine(datesOk, DATES_MSG).parse(req.body);
    const upd = await prisma.promotion.updateMany({ where: { id, tenantId: ctx.tenantId }, data: body });
    if (upd.count === 0) throw notFound("Promoción");
    return { ok: true };
  });

  app.delete("/admin/promotions/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const del = await prisma.promotion.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    if (del.count === 0) throw notFound("Promoción");
    return { ok: true };
  });

  // ───── Admin: campañas (push + email segmentados) ─────

  app.get("/admin/campaigns", async (req) => {
    const ctx = await requireAdmin(req);
    const [campaigns, all, inactive] = await Promise.all([
      prisma.campaign.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
      audience(prisma, ctx.tenantId, "ALL"),
      audience(prisma, ctx.tenantId, "INACTIVE_30"),
    ]);
    const last = campaigns[0]?.createdAt;
    const count = (list: typeof all) => ({
      customers: list.length,
      email: list.filter((c) => c.marketingOptInAt).length,
      push: list.filter((c) => c.pushSubs.length > 0).length,
    });
    return {
      campaigns,
      nextAllowedAt: last && Date.now() - last.getTime() < CAMPAIGN_INTERVAL_MS ? new Date(last.getTime() + CAMPAIGN_INTERVAL_MS) : null,
      audience: { ALL: count(all), INACTIVE_30: count(inactive) },
    };
  });

  app.post("/admin/campaigns", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = CampaignBody.parse(req.body);

    // Reserva la campaña con un lock por bar: dos envíos simultáneos no saltean el tope semanal
    const { campaign, recipients, venue } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`campaign:${ctx.tenantId}`}))`;
      const last = await tx.campaign.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      if (last && Date.now() - last.createdAt.getTime() < CAMPAIGN_INTERVAL_MS) {
        const next = new Date(last.createdAt.getTime() + CAMPAIGN_INTERVAL_MS);
        throw new HttpError(429, "CAMPAIGN_WEEKLY_LIMIT", `Podés mandar 1 aviso por semana. El próximo, desde el ${next.toLocaleDateString("es-AR")}.`);
      }
      if (body.promotionId) {
        const p = await tx.promotion.findFirst({ where: { id: body.promotionId, tenantId: ctx.tenantId }, select: { id: true } });
        if (!p) throw notFound("Promoción");
      }
      const campaign = await tx.campaign.create({ data: { ...body, tenantId: ctx.tenantId, staffId: ctx.staff.sub } });
      await audit(tx, ctx, "campaign.sent", "Campaign", campaign.id, { segment: body.segment });
      const venue = await tx.venue.findUniqueOrThrow({ where: { id: ctx.venueId }, select: { id: true, name: true } });
      return { campaign, recipients: await audience(tx, ctx.tenantId, body.segment), venue };
    });

    const url = `${config.publicGuestUrl}/v/${venue.id}/cuenta?tab=promos`;
    let pushSent = 0;
    let emailSent = 0;
    const gone: string[] = [];

    for (const c of recipients) {
      for (const s of c.pushSubs) {
        const r = await sendPush(s, { title: `${venue.name}: ${body.title}`, body: body.body, url, tid: ctx.tenantId });
        if (r === "sent") pushSent++;
        if (r === "gone") gone.push(s.id);
      }
      if (c.marketingOptInAt) {
        const unsub = `${config.publicGuestUrl}/baja?t=${await signUnsubToken(c.id, ctx.tenantId)}`;
        const oneClick = `${config.publicGuestUrl}/v1/customer/unsubscribe?t=${await signUnsubToken(c.id, ctx.tenantId)}`;
        try {
          await sendEmail({
            to: c.email,
            subject: `${venue.name}: ${body.title}`,
            text: `${c.name ? `Hola ${c.name}:\n\n` : ""}${body.body}\n\nVer en Mi cuenta: ${url}\n\nNo quiero recibir más promos de ${venue.name}: ${unsub}`,
            html:
              `<p>${c.name ? `Hola ${escapeHtml(c.name)}:` : ""}</p><p>${escapeHtml(body.body)}</p>` +
              `<p><a href="${escapeHtml(url)}">Ver en Mi cuenta</a></p>` +
              `<p style="font-size:12px;color:#666"><a href="${escapeHtml(unsub)}">Darme de baja de las promos de ${escapeHtml(venue.name)}</a></p>`,
            headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
          });
          emailSent++;
        } catch (e) {
          req.log.warn({ err: e }, "campaign email failed");
        }
      }
    }

    if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    const done = await prisma.campaign.update({ where: { id: campaign.id }, data: { pushSent, emailSent } });
    return reply.status(201).send(done);
  });
}
