import { randomInt } from "node:crypto";
import { JoinSessionBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { GUEST_COOKIE, requireGuest } from "../../shared/auth/guards.js";
import { signToken } from "../../shared/auth/tokens.js";
import { Prisma, prisma } from "../../shared/db/index.js";
import { HttpError, forbidden, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";

const ACTIVE = ["PENDING", "OPEN", "BILL_REQUESTED"] as const;
const TagParams = z.object({ code: z.string().regex(/^[0-9A-Za-z]{6,32}$/) });

async function withRetryOnUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return fn();
    throw e;
  }
}

async function resolveTag(code: string) {
  const tag = await prisma.tableTag.findUnique({
    where: { code },
    include: { table: { include: { venue: { select: { id: true, name: true, layout: true } } } } },
  });
  if (!tag || !tag.active || !tag.table.active) throw notFound("Mesa");
  return tag;
}

export async function tableSessionRoutes(app: FastifyInstance) {
  // Resolución pública del tag: qué local y qué mesa (no crea sesión)
  app.get("/tags/:code", async (req) => {
    const { code } = TagParams.parse(req.params);
    const tag = await resolveTag(code);
    return {
      venue: tag.table.venue,
      table: { id: tag.table.id, label: tag.table.label },
    };
  });

  /**
   * Unirse a la mesa. El primer dispositivo crea la sesión en PENDING (el mozo la abre)
   * y recibe el PIN; los siguientes necesitan ese PIN para unirse.
   */
  app.post(
    "/tags/:code/session",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { code } = TagParams.parse(req.params);
      const body = JoinSessionBody.parse(req.body);
      const tag = await resolveTag(code);
      const { table } = tag;

      // Si dos celulares escanean a la vez, el índice único parcial hace fallar a uno: reintenta y se une
      const result = await withRetryOnUnique(() => prisma.$transaction(async (tx) => {
        let session = await tx.tableSession.findFirst({
          where: { tableId: table.id, status: { in: [...ACTIVE] } },
        });

        if (!session) {
          session = await tx.tableSession.create({
            data: {
              tenantId: tag.tenantId,
              venueId: table.venueId,
              tableId: table.id,
              joinPin: String(randomInt(0, 10000)).padStart(4, "0"),
            },
          });
          await emit(tx, {
            tenantId: tag.tenantId,
            venueId: table.venueId,
            type: "session.requested",
            channels: [channels.staff(table.venueId)],
            payload: { sessionId: session.id, tableLabel: table.label },
          });
        } else {
          const already = await tx.guestDevice.findUnique({
            where: { sessionId_deviceKey: { sessionId: session.id, deviceKey: body.deviceKey } },
          });
          if (!already) {
            if (!body.pin) throw forbidden("PIN_REQUIRED", "Pedile el PIN a quien abrió la mesa");
            if (body.pin !== session.joinPin) throw forbidden("PIN_INVALID");
          }
        }

        const device = await tx.guestDevice.upsert({
          where: { sessionId_deviceKey: { sessionId: session.id, deviceKey: body.deviceKey } },
          create: { tenantId: tag.tenantId, sessionId: session.id, deviceKey: body.deviceKey },
          update: {},
        });
        return { session, device };
      }));

      const token = await signToken({
        typ: "guest",
        tid: tag.tenantId,
        vid: table.venueId,
        sid: result.session.id,
        did: result.device.id,
      });
      reply.setCookie(GUEST_COOKIE, token, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "lax",
        path: "/",
        maxAge: 12 * 60 * 60,
      });
      return {
        token,
        session: {
          id: result.session.id,
          status: result.session.status,
          pin: result.session.joinPin,
          venueId: table.venueId,
          table: { id: table.id, label: table.label },
        },
      };
    },
  );

  // Estado de la sesión del comensal
  app.get("/session", async (req) => {
    const guest = await requireGuest(req);
    const session = await prisma.tableSession.findFirst({
      where: { id: guest.sid, tenantId: guest.tid },
      include: {
        table: { select: { label: true } },
        orders: { include: { items: true }, orderBy: { createdAt: "asc" } },
        serviceCalls: { where: { status: { not: "RESOLVED" } } },
      },
    });
    if (!session) throw notFound("Sesión");
    if (session.status === "CLOSED") throw new HttpError(410, "SESSION_CLOSED");
    const lastSeq = (await prisma.venue.findUniqueOrThrow({ where: { id: guest.vid }, select: { eventSeq: true } }))
      .eventSeq;
    return {
      id: session.id,
      status: session.status,
      pin: session.joinPin,
      table: session.table,
      orders: session.orders,
      serviceCalls: session.serviceCalls,
      lastSeq,
    };
  });
}
