import { CreateServiceCallBody } from "@bar/shared-types";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { FLOOR_ROLES, requireGuest, requireStaff, staffScope } from "../../shared/auth/guards.js";
import { prisma } from "../../shared/db/index.js";
import { HttpError, conflict, notFound } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";

export async function serviceCallRoutes(app: FastifyInstance) {
  /**
   * Llamar al mozo / pedir la cuenta.
   * Anti-spam: si ya hay un llamado abierto del mismo tipo se devuelve ese (deduplicado),
   * y después de resolverse hay un cooldown por mesa.
   */
  app.post("/service-calls", async (req, reply) => {
    const guest = await requireGuest(req);
    const { type } = CreateServiceCallBody.parse(req.body);

    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.tableSession.findFirst({
        where: { id: guest.sid, tenantId: guest.tid },
        include: { table: { select: { label: true } } },
      });
      if (!session) throw notFound("Sesión");
      if (session.status !== "OPEN" && session.status !== "BILL_REQUESTED") throw conflict("SESSION_NOT_OPEN");

      const open = await tx.serviceCall.findFirst({
        where: { sessionId: guest.sid, type, status: { not: "RESOLVED" } },
      });
      if (open) return { call: open, deduplicated: true };

      const recent = await tx.serviceCall.findFirst({
        where: {
          sessionId: guest.sid,
          type,
          resolvedAt: { gt: new Date(Date.now() - config.serviceCallCooldownSec * 1000) },
        },
        orderBy: { resolvedAt: "desc" },
      });
      if (recent?.resolvedAt) {
        const retryAfter = Math.ceil(
          (recent.resolvedAt.getTime() + config.serviceCallCooldownSec * 1000 - Date.now()) / 1000,
        );
        throw new HttpError(429, "COOLDOWN", `Podés volver a llamar en ${retryAfter} s`);
      }

      const call = await tx.serviceCall.create({
        data: { tenantId: guest.tid, venueId: guest.vid, sessionId: guest.sid, type },
      });
      if (type === "BILL") {
        await tx.tableSession.update({ where: { id: guest.sid }, data: { status: "BILL_REQUESTED" } });
      }
      await emit(tx, {
        tenantId: guest.tid,
        venueId: guest.vid,
        type: "service_call.created",
        channels: [channels.staff(guest.vid), channels.session(guest.sid)],
        payload: { callId: call.id, type, tableLabel: session.table.label },
      });
      return { call, deduplicated: false };
    });

    return reply.status(result.deduplicated ? 200 : 201).send(result);
  });

  // ───── Mozo ─────
  app.get("/staff/service-calls", async (req) => {
    const staff = await requireStaff(req);
    return prisma.serviceCall.findMany({
      where: { ...staffScope(staff), status: { not: "RESOLVED" } },
      include: { session: { select: { table: { select: { label: true } } } } },
      orderBy: { createdAt: "asc" },
    });
  });

  app.post("/staff/service-calls/:id/:action", async (req) => {
    const staff = await requireStaff(req, FLOOR_ROLES);
    const { id, action } = z.object({ id: z.uuid(), action: z.enum(["ack", "resolve"]) }).parse(req.params);

    return prisma.$transaction(async (tx) => {
      const call = await tx.serviceCall.findFirst({ where: { id, ...staffScope(staff) } });
      if (!call) throw notFound("Llamado");
      if (call.status === "RESOLVED") throw conflict("ALREADY_RESOLVED");

      const updated = await tx.serviceCall.update({
        where: { id },
        data: action === "ack" ? { status: "ACKNOWLEDGED" } : { status: "RESOLVED", resolvedAt: new Date() },
      });
      await emit(tx, {
        tenantId: call.tenantId,
        venueId: call.venueId,
        type: "service_call.updated",
        channels: [channels.staff(call.venueId), channels.session(call.sessionId)],
        payload: { callId: id, status: updated.status },
      });
      return updated;
    });
  });
}
