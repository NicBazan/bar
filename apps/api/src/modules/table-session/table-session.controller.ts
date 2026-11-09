import { timingSafeEqual } from "node:crypto";
import { JoinSessionBody } from "@bar/shared-types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { GUEST_COOKIE, assertTenantActive, requireGuest } from "../../shared/auth/guards.js";
import { signToken } from "../../shared/auth/tokens.js";
import { Prisma, prisma } from "../../shared/db/index.js";
import { HttpError, forbidden, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";
import { assertTenantCanOpenSession, incrementSessionUsage } from "../billing/billing.guard.js";
import { closeSession, newJoinPin } from "./lifecycle.js";
import { nfcSunService } from "./nfc-sun.service.js";

export const ACTIVE_SESSION_STATUSES = ["PENDING", "OPEN", "BILL_REQUESTED"] as const;

export const TagParams = z.object({
  code: z.string().regex(/^[0-9A-Za-z]{6,32}$/),
});

export const NfcQuery = z.object({
  uid: z.string().optional(),
  ctr: z.string().optional(),
  cmac: z.string().optional(),
});

export type NfcQuery = z.infer<typeof NfcQuery>;

/** Una mesa "esperando al mozo" que nadie abrió en este tiempo se descarta al próximo escaneo */
export const PENDING_TTL_MS = 30 * 60 * 1000;
/** Una mesa abierta sin pedidos ni celulares nuevos en este tiempo se cierra al próximo escaneo */
export const IDLE_TTL_MS = 12 * 60 * 60 * 1000;

async function isAbandoned(tx: Prisma.TransactionClient, s: { id: string; status: string; openedAt: Date }): Promise<boolean> {
  const now = Date.now();
  if (s.status === "PENDING") return now - s.openedAt.getTime() > PENDING_TTL_MS;
  const [lastOrder, lastDevice] = await Promise.all([
    tx.order.findFirst({ where: { sessionId: s.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    tx.guestDevice.findFirst({ where: { sessionId: s.id }, orderBy: { joinedAt: "desc" }, select: { joinedAt: true } }),
  ]);
  const last = Math.max(s.openedAt.getTime(), lastOrder?.createdAt.getTime() ?? 0, lastDevice?.joinedAt.getTime() ?? 0);
  return now - last > IDLE_TTL_MS;
}

/** Intentos de PIN incorrectos permitidos por sesión antes de bloquear el ingreso por PIN */
export const PIN_MAX_FAILURES = 8;

class WrongPinError extends Error {
  constructor(public sessionId: string) {
    super("PIN_INVALID");
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Corre el ingreso y, si el PIN fue incorrecto, suma el intento fallido en una escritura aparte */
async function joinWithPinAccounting<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await withRetryOnUnique(fn);
  } catch (e) {
    if (!(e instanceof WrongPinError)) throw e;
    const s = await prisma.tableSession.update({
      where: { id: e.sessionId },
      data: { pinFailures: { increment: 1 } },
      select: { pinFailures: true },
    });
    const left = Math.max(0, PIN_MAX_FAILURES - s.pinFailures);
    if (left === 0) {
      throw new HttpError(423, "PIN_LOCKED", "Demasiados intentos. Pedile al mozo que te sume a la mesa.");
    }
    throw forbidden("PIN_INVALID", `El PIN ingresado es incorrecto. Te quedan ${left} intento(s).`);
  }
}

async function withRetryOnUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fn();
    }
    throw e;
  }
}

/**
 * Resuelve un TableTag en la base de datos junto a la mesa y su sesión activa.
 */
export async function getTableTagWithActiveSession(code: string) {
  const tag = await prisma.tableTag.findUnique({
    where: { code },
    include: {
      table: {
        include: {
          venue: {
            select: { id: true, name: true, layout: true, logoUrl: true },
          },
          sessions: {
            where: { status: { in: [...ACTIVE_SESSION_STATUSES] } },
            orderBy: { openedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!tag || !tag.active || !tag.table.active) {
    throw notFound("Mesa");
  }

  return tag;
}

/**
 * GET /v1/tags/:code
 * Resolución pública del tag: información del local y mesa sin crear sesión.
 */
export async function resolveTagHandler(req: FastifyRequest) {
  const { code } = TagParams.parse(req.params);
  const tag = await getTableTagWithActiveSession(code);

  return {
    venue: tag.table.venue,
    table: { id: tag.table.id, label: tag.table.label },
  };
}

type ActiveTag = Awaited<ReturnType<typeof getTableTagWithActiveSession>>;
type JoinBody = ReturnType<typeof JoinSessionBody.parse>;

/**
 * POST /v1/tags/:code/session
 * Une al comensal a la mesa mediante verificación criptográfica NFC SUN o PIN de sesión (QR).
 * Controlador fino (GRASP Controller): cada paso es una función con una sola responsabilidad.
 */
export async function joinTableSession(req: FastifyRequest, reply: FastifyReply) {
  const { code } = TagParams.parse(req.params);
  const query = NfcQuery.parse(req.query);
  const body = JoinSessionBody.parse(req.body);

  const tag = await getTableTagWithActiveSession(code);
  // Bar suspendido por la plataforma: la carta muestra "atención en mesa" (402)
  await assertTenantActive(tag.tenantId);
  const sunCounter = verifyNfcPresence(tag, query);
  const physical = sunCounter !== null;

  // Transacción atómica: quemar contador SUN, crear/obtener sesión y registrar dispositivo.
  // El PIN se valida adentro: un dispositivo que ya estaba en la mesa vuelve a entrar sin PIN.
  const { session, device } = await joinWithPinAccounting(() =>
    prisma.$transaction(async (tx) => {
      if (physical) await burnSunCounter(tx, tag.code, sunCounter);
      const current = await currentSession(tx, tag);
      const session = current ?? (await startSession(tx, tag, physical));
      if (current && !physical) await assertMayJoin(tx, current, body);
      const device = await tx.guestDevice.upsert({
        where: { sessionId_deviceKey: { sessionId: session.id, deviceKey: body.deviceKey } },
        create: { tenantId: tag.tenantId, sessionId: session.id, deviceKey: body.deviceKey },
        update: {},
      });
      return { session, device };
    }),
  );

  const token = await issueGuestToken(reply, { tag, sessionId: session.id, deviceId: device.id, physical });
  return {
    token,
    physicalPresence: physical,
    session: {
      id: session.id,
      status: session.status,
      pin: session.joinPin,
      venueId: tag.table.venueId,
      table: { id: tag.table.id, label: tag.table.label },
    },
  };
}

/** Toque NFC (NTAG 424 SUN): el chip tiene que ser el de ESTA mesa y la firma válida. Devuelve el contador o null si es QR */
function verifyNfcPresence(tag: ActiveTag, query: NfcQuery): number | null {
  if (!query.uid && !query.ctr && !query.cmac) return null;
  const { uid = "", ctr = "", cmac = "" } = query;
  // El UID grabado en la mesa ata la firma al tag: una URL válida de otra mesa no sirve acá
  if (!tag.nfcUid || tag.nfcUid.toUpperCase() !== uid.toUpperCase()) {
    throw forbidden("INVALID_NFC_SIGNATURE", "El tag NFC no corresponde a esta mesa");
  }
  const counter = nfcSunService.verify(uid, ctr, cmac, config.nfcMasterKey);
  if (counter === null) throw forbidden("INVALID_NFC_SIGNATURE", "Firma criptográfica del tag NFC inválida");
  return counter;
}

/** Anti-replay atómico: solo avanza si el contador es mayor que el último aceptado (dos requests iguales: una gana) */
async function burnSunCounter(tx: Prisma.TransactionClient, code: string, counter: number) {
  const burned = await tx.tableTag.updateMany({ where: { code, sunCounter: { lt: counter } }, data: { sunCounter: counter } });
  if (burned.count === 0) {
    throw forbidden("REPLAY_ATTACK_DETECTED", "Este toque NFC ya fue utilizado. Apoyá el celular de nuevo.");
  }
}

/**
 * Sesión activa de la mesa. Si quedó abandonada (alguien escaneó y se fue, o el mozo se olvidó de cerrar),
 * se cierra con las mismas reglas que un cierre del mozo, para que el próximo cliente no herede un PIN ajeno.
 */
async function currentSession(tx: Prisma.TransactionClient, tag: ActiveTag) {
  const session = await tx.tableSession.findFirst({ where: { tableId: tag.table.id, status: { in: [...ACTIVE_SESSION_STATUSES] } } });
  if (!session || !(await isAbandoned(tx, session))) return session;
  await closeSession(tx, session, "ABANDONED");
  return null;
}

/** Primera apertura de la mesa: OPEN si hubo toque NFC, PENDING (espera al mozo) si fue por QR */
async function startSession(tx: Prisma.TransactionClient, tag: ActiveTag, physical: boolean) {
  await assertTenantCanOpenSession(tx, tag.tenantId);
  const session = await tx.tableSession.create({
    data: {
      tenantId: tag.tenantId,
      venueId: tag.table.venueId,
      tableId: tag.table.id,
      status: physical ? "OPEN" : "PENDING",
      joinPin: newJoinPin(),
    },
  });
  // La cuota mensual se consume cuando la mesa se ABRE de verdad (NFC acá, o el mozo en
  // POST /staff/sessions/:id/open). Escaneos de un QR fotografiado que nadie abre no la gastan.
  if (physical) await incrementSessionUsage(tx, tag.tenantId);
  await emit(tx, {
    tenantId: tag.tenantId,
    venueId: tag.table.venueId,
    type: "session.requested",
    channels: [channels.staff(tag.table.venueId)],
    payload: { sessionId: session.id, tableLabel: tag.table.label },
  });
  return session;
}

/** Sin presencia física: un celular nuevo necesita el PIN; uno que ya estaba en la mesa entra directo */
async function assertMayJoin(tx: Prisma.TransactionClient, session: { id: string; joinPin: string; pinFailures: number }, body: JoinBody) {
  const alreadyJoined = await tx.guestDevice.findUnique({ where: { sessionId_deviceKey: { sessionId: session.id, deviceKey: body.deviceKey } } });
  if (alreadyJoined) return;
  if (session.pinFailures >= PIN_MAX_FAILURES) {
    throw new HttpError(423, "PIN_LOCKED", "Demasiados intentos. Pedile al mozo que te sume a la mesa.");
  }
  if (!body.pin) throw forbidden("PIN_REQUIRED", "Pedile el PIN a quien abrió la mesa");
  // El intento fallido se cuenta FUERA de esta transacción (que se revierte al lanzar el error)
  if (!safeEqual(body.pin, session.joinPin)) throw new WrongPinError(session.id);
}

/** Token del comensal (JWT) en cookie HttpOnly; también se devuelve para el cliente que use Bearer */
async function issueGuestToken(reply: FastifyReply, p: { tag: ActiveTag; sessionId: string; deviceId: string; physical: boolean }) {
  const token = await signToken({ typ: "guest", tid: p.tag.tenantId, vid: p.tag.table.venueId, sid: p.sessionId, did: p.deviceId, phys: p.physical });
  reply.setCookie(GUEST_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 });
  return token;
}

/**
 * GET /v1/session
 * Retorna el estado en vivo de la sesión actual del comensal.
 */
export async function getSessionHandler(req: FastifyRequest) {
  const guest = await requireGuest(req);

  const session = await prisma.tableSession.findFirst({
    where: { id: guest.sid, tenantId: guest.tid },
    include: {
      table: { select: { label: true } },
      venue: { select: { wifiSsid: true, wifiPassword: true, googleReviewUrl: true } },
      orders: { include: { items: true }, orderBy: { createdAt: "asc" } },
      serviceCalls: { where: { status: { not: "RESOLVED" } } },
    },
  });

  if (!session) throw notFound("Sesión");
  if (session.status === "CLOSED") throw new HttpError(410, "SESSION_CLOSED");

  const lastSeq = (
    await prisma.venue.findUniqueOrThrow({
      where: { id: guest.vid },
      select: { eventSeq: true },
    })
  ).eventSeq;

  return {
    id: session.id,
    status: session.status,
    pin: session.joinPin,
    table: session.table,
    orders: session.orders,
    serviceCalls: session.serviceCalls,
    lastSeq,
    // Hub en mesa: el Wi-Fi solo se entrega a mesas abiertas (no a quien solo escaneó el QR)
    hub: {
      wifi:
        session.status !== "PENDING" && session.venue.wifiSsid
          ? { ssid: session.venue.wifiSsid, password: session.venue.wifiPassword ?? "" }
          : null,
      googleReviewUrl: session.venue.googleReviewUrl,
    },
  };
}
