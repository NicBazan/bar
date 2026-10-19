import { randomInt } from "node:crypto";
import { JoinSessionBody } from "@bar/shared-types";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { GUEST_COOKIE, requireGuest } from "../../shared/auth/guards.js";
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
  const activeSession = table.sessions[0];

  let isPhysicalPresence = false;
  let parsedCounter = 0;

  const hasNfcParams = Boolean(query.uid && query.ctr && query.cmac);

  // 2. Si los parámetros NFC están presentes, validar anti-replay y firma criptográfica
  if (hasNfcParams) {
    const { uid, ctr, cmac } = query;

    // Parsea el ctr a entero (hexadecimal estándar NXP o decimal)
    parsedCounter = /^[0-9a-fA-F]+$/.test(ctr!) ? parseInt(ctr!, 16) : Number(ctr);

    if (Number.isNaN(parsedCounter) || parsedCounter <= tag.sunCounter) {
      throw forbidden("REPLAY_ATTACK_DETECTED", "El contador NFC ya fue utilizado o es inválido");
    }

    const isValidSignature = nfcSunService.verifyNfcSignature(
      uid!,
      ctr!,
      cmac!,
      config.nfcMasterKey,
    );

    if (!isValidSignature) {
      throw forbidden("INVALID_NFC_SIGNATURE", "Firma criptográfica del tag NFC inválida");
    }

    isPhysicalPresence = true;
  }

  // 3. Si no ingresó por NFC válido (ej. QR estático), exige y valida el PIN si ya existe sesión activa
  if (!isPhysicalPresence && activeSession) {
    if (!body.pin) {
      throw forbidden("PIN_REQUIRED", "Pedile el PIN de 4 dígitos a quien abrió la mesa");
    }
    if (body.pin !== activeSession.joinPin) {
      throw forbidden("PIN_INVALID", "El PIN ingresado es incorrecto");
    }
  }

  // 4. Transacción atómica: quemar contador SUN, crear/obtener sesión y registrar dispositivo
  const result = await withRetryOnUnique(() =>
    prisma.$transaction(async (tx) => {
      // Si la firma es válida, actualiza el sunCounter en Prisma para "quemar" esa URL
      if (isPhysicalPresence) {
        await tx.tableTag.update({
          where: { code: tag.code },
          data: { sunCounter: parsedCounter },
        });
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

        // Incremento de consumo mensual en el plan
        await incrementSessionUsage(tx, tag.tenantId);

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
          if (!body.pin) {
            throw forbidden("PIN_REQUIRED", "Pedile el PIN a quien abrió la mesa");
          }
          if (body.pin !== session.joinPin) {
            throw forbidden("PIN_INVALID", "El PIN ingresado es incorrecto");
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
  };
}
