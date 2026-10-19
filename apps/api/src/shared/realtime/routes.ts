import { StateQuery } from "@bar/shared-types";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireGuest, requireStaff } from "../auth/guards.js";
import { verifyToken } from "../auth/tokens.js";
import { prisma } from "../db/index.js";
import { channels } from "../outbox/outbox.js";

/**
 * Catch-up de eventos: GET /state?since=<seq>.
 * El cliente lo llama al reconectar (celular bloqueado, cambio de 4G a Wi-Fi)
 * para no perder eventos. Mientras no exista el broker, sirve también como polling.
 */
export async function realtimeRoutes(app: FastifyInstance) {
  app.get("/state", async (req) => {
    const { since } = StateQuery.parse(req.query);
    const { venueId, chans } = await resolveChannels(req);

    const [events, venue] = await Promise.all([
      prisma.outboxEvent.findMany({
        where: { venueId, channel: { in: chans }, venueSeq: { gt: BigInt(since) } },
        orderBy: { venueSeq: "asc" },
        take: 500,
        select: { venueSeq: true, channel: true, type: true, payload: true, createdAt: true },
      }),
      prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { eventSeq: true } }),
    ]);

    return { lastSeq: venue.eventSeq, events };
  });
}

// El comensal solo ve su mesa; el staff ve el canal de salón y el de cocina
async function resolveChannels(req: FastifyRequest) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? await verifyToken(header.slice(7)) : null;
  const isStaff = bearer ? bearer.typ === "staff" : Boolean(req.cookies?.bar_staff);

  if (isStaff) {
    const staff = await requireStaff(req);
    const venueId = staff.vid ?? (await prisma.venue.findFirstOrThrow({ where: { tenantId: staff.tid } })).id;
    return { venueId, chans: [channels.staff(venueId), channels.kitchen(venueId)] };
  }
  const guest = await requireGuest(req);
  return { venueId: guest.vid, chans: [channels.session(guest.sid)] };
}
