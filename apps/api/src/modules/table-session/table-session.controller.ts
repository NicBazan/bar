import { randomInt, timingSafeEqual } from "node:crypto";
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
            select: { id: true, name: true, layout: true },
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

/**
 * POST /v1/tags/:code/session
 * Une al comensal a la mesa mediante verificación criptográfica NFC SUN o PIN de sesión (QR).
 */
export async function joinTableSession(req: FastifyRequest, reply: FastifyReply) {
  const { code } = TagParams.parse(req.params);
  const query = NfcQuery.parse(req.query);
  const body = JoinSessionBody.parse(req.body);

  // 1. Consulta tableTag en Prisma junto a su sesión activa
  const tag = await getTableTagWithActiveSession(code);
  const { table } = tag;
  // Bar suspendido por la plataforma: la carta muestra "atención en mesa" (402)
  await assertTenantActive(tag.tenantId);

  let isPhysicalPresence = false;
  let parsedCounter = 0;

  // 2. Toque NFC (NTAG 424 SUN): validar que el chip sea el de ESTA mesa y que la firma sea válida
  if (query.uid || query.ctr || query.cmac) {
    const { uid = "", ctr = "", cmac = "" } = query;
    // El UID grabado en la mesa ata la firma al tag: una URL válida de otra mesa no sirve acá
    if (!tag.nfcUid || tag.nfcUid.toUpperCase() !== uid.toUpperCase()) {
      throw forbidden("INVALID_NFC_SIGNATURE", "El tag NFC no corresponde a esta mesa");
    }
    const counter = nfcSunService.verify(uid, ctr, cmac, config.nfcMasterKey);
    if (counter === null) {
      throw forbidden("INVALID_NFC_SIGNATURE", "Firma criptográfica del tag NFC inválida");
    }
    parsedCounter = counter;
    isPhysicalPresence = true;
  }

  // 3. Transacción atómica: quemar contador SUN, crear/obtener sesión y registrar dispositivo.
  //    El PIN se valida adentro: un dispositivo que ya estaba en la mesa vuelve a entrar sin PIN.
  const result = await joinWithPinAccounting(() =>
    prisma.$transaction(async (tx) => {
      if (isPhysicalPresence) {
        // Anti-replay atómico: solo avanza si el contador es mayor que el último aceptado.
        // Dos requests con la misma URL a la vez: una actualiza, la otra ve count = 0.
        const burned = await tx.tableTag.updateMany({
          where: { code: tag.code, sunCounter: { lt: parsedCounter } },
          data: { sunCounter: parsedCounter },
        });
        if (burned.count === 0) {
          throw forbidden("REPLAY_ATTACK_DETECTED", "Este toque NFC ya fue utilizado. Apoyá el celular de nuevo.");
        }
      }

      let session = await tx.tableSession.findFirst({
        where: { tableId: table.id, status: { in: [...ACTIVE_SESSION_STATUSES] } },
      });

      if (!session) {
        // Validación de cuota Freemium antes de abrir la mesa
        await assertTenantCanOpenSession(tx, tag.tenantId);

        // Primera apertura de la mesa
        session = await tx.tableSession.create({
          data: {
            tenantId: tag.tenantId,
            venueId: table.venueId,
            tableId: table.id,
            status: isPhysicalPresence ? "OPEN" : "PENDING",
            joinPin: String(randomInt(0, 10000)).padStart(4, "0"),
          },
        });

        // La cuota mensual se consume cuando la mesa se ABRE de verdad (NFC acá, o el mozo en
        // POST /staff/sessions/:id/open). Escaneos de un QR fotografiado que nadie abre no la gastan.
        if (isPhysicalPresence) await incrementSessionUsage(tx, tag.tenantId);

        await emit(tx, {
          tenantId: tag.tenantId,
          venueId: table.venueId,
          type: "session.requested",
          channels: [channels.staff(table.venueId)],
          payload: { sessionId: session.id, tableLabel: table.label },
        });
      } else if (!isPhysicalPresence) {
        // Si no tiene presencia física y el dispositivo no está previamente registrado, valida el PIN
        const alreadyJoined = await tx.guestDevice.findUnique({
          where: { sessionId_deviceKey: { sessionId: session.id, deviceKey: body.deviceKey } },
        });

        if (!alreadyJoined) {
          if (session.pinFailures >= PIN_MAX_FAILURES) {
            throw new HttpError(423, "PIN_LOCKED", "Demasiados intentos. Pedile al mozo que te sume a la mesa.");
          }
          if (!body.pin) {
            throw forbidden("PIN_REQUIRED", "Pedile el PIN a quien abrió la mesa");
          }
          if (!safeEqual(body.pin, session.joinPin)) {
            // Se cuenta FUERA de esta transacción (que se revierte al lanzar el error)
            throw new WrongPinError(session.id);
          }
        }
      }

      const device = await tx.guestDevice.upsert({
        where: { sessionId_deviceKey: { sessionId: session.id, deviceKey: body.deviceKey } },
        create: {
          tenantId: tag.tenantId,
          sessionId: session.id,
          deviceKey: body.deviceKey,
        },
        update: {},
      });

      return { session, device };
    }),
  );

  // 5. Firma de token JWT con jose y envío en cookie HttpOnly
  const token = await signToken({
    typ: "guest",
    tid: tag.tenantId,
    vid: table.venueId,
    sid: result.session.id,
    did: result.device.id,
    phys: isPhysicalPresence,
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
    physicalPresence: isPhysicalPresence,
    session: {
      id: result.session.id,
      status: result.session.status,
      pin: result.session.joinPin,
      venueId: table.venueId,
      table: { id: table.id, label: table.label },
    },
  };
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
