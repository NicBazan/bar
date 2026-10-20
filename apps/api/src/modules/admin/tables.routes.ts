import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { prisma } from "../../shared/db/index.js";
import { generateTagCode } from "../../shared/codes.js";
import { conflict, notFound } from "../../shared/errors.js";
import { type AdminContext, audit, requireAdmin } from "./context.js";
import { AreaCreate, IdParams, NfcPut, TableCreate, TableUpdate } from "./schemas.js";

const guestUrl = (code: string) => `${config.publicGuestUrl}/t/${code}`;

async function ownTable(ctx: AdminContext, id: string) {
  const t = await prisma.diningTable.findFirst({ where: { id, tenantId: ctx.tenantId, venueId: ctx.venueId } });
  if (!t) throw notFound("Mesa");
  return t;
}

async function assertArea(ctx: AdminContext, areaId: string | null | undefined) {
  if (!areaId) return;
  const a = await prisma.area.findFirst({ where: { id: areaId, tenantId: ctx.tenantId, venueId: ctx.venueId } });
  if (!a) throw notFound("Área");
}

export async function adminTablesRoutes(app: FastifyInstance) {
  // Mesas con su QR activo, su NFC y el estado actual
  app.get("/admin/tables", async (req) => {
    const ctx = await requireAdmin(req);
    const [areas, tables] = await Promise.all([
      prisma.area.findMany({ where: { venueId: ctx.venueId }, orderBy: { position: "asc" } }),
      prisma.diningTable.findMany({
        where: { venueId: ctx.venueId, tenantId: ctx.tenantId },
        include: {
          tags: { where: { active: true }, orderBy: { createdAt: "desc" } },
          sessions: { where: { status: { not: "CLOSED" } }, take: 1, select: { status: true } },
        },
        orderBy: [{ active: "desc" }, { label: "asc" }],
      }),
    ]);
    return {
      guestBaseUrl: config.publicGuestUrl,
      areas: areas.map((a) => ({ id: a.id, name: a.name })),
      tables: tables.map((t) => {
        const qr = t.tags.find((g) => g.type === "QR");
        const nfc = t.tags.find((g) => g.type === "NFC_SUN");
        return {
          id: t.id,
          label: t.label,
          seats: t.seats,
          areaId: t.areaId,
          active: t.active,
          status: t.sessions[0]?.status ?? "FREE",
          qr: qr ? { code: qr.code, url: guestUrl(qr.code) } : null,
          nfc: nfc ? { code: nfc.code, uid: nfc.nfcUid, urlTemplate: `${guestUrl(nfc.code)}?uid={UID}&ctr={CTR}&cmac={CMAC}` } : null,
        };
      }),
    };
  });

  app.post("/admin/tables", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = TableCreate.parse(req.body);
    await assertArea(ctx, body.areaId);
    const dup = await prisma.diningTable.findFirst({ where: { venueId: ctx.venueId, label: body.label } });
    if (dup) throw conflict("TABLE_EXISTS", `Ya existe la mesa "${body.label}"`);
    const table = await prisma.$transaction(async (tx) => {
      const t = await tx.diningTable.create({
        data: { tenantId: ctx.tenantId, venueId: ctx.venueId, label: body.label, seats: body.seats, areaId: body.areaId ?? null },
      });
      await tx.tableTag.create({ data: { code: generateTagCode(), tenantId: ctx.tenantId, tableId: t.id, type: "QR" } });
      return t;
    });
    return reply.status(201).send(table);
  });

  app.patch("/admin/tables/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const body = TableUpdate.parse(req.body);
    await ownTable(ctx, id);
    await assertArea(ctx, body.areaId);
    if (body.label) {
      const dup = await prisma.diningTable.findFirst({ where: { venueId: ctx.venueId, label: body.label, id: { not: id } } });
      if (dup) throw conflict("TABLE_EXISTS", `Ya existe la mesa "${body.label}"`);
    }
    return prisma.diningTable.update({ where: { id }, data: body });
  });

  // QR nuevo: el impreso anterior deja de funcionar (útil si se filtró una foto del QR)
  app.post("/admin/tables/:id/regenerate-qr", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    await ownTable(ctx, id);
    const code = generateTagCode();
    await prisma.$transaction(async (tx) => {
      await tx.tableTag.updateMany({ where: { tableId: id, type: "QR", active: true }, data: { active: false } });
      await tx.tableTag.create({ data: { code, tenantId: ctx.tenantId, tableId: id, type: "QR" } });
      await audit(tx, ctx, "table.qr_regenerated", "DiningTable", id);
    });
    return { code, url: guestUrl(code) };
  });

  // Vincula el chip NTAG 424 DNA de la mesa (su UID) o lo desvincula con uid = null
  app.put("/admin/tables/:id/nfc", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const { uid } = NfcPut.parse(req.body);
    await ownTable(ctx, id);

    if (uid === null) {
      await prisma.tableTag.updateMany({ where: { tableId: id, type: "NFC_SUN" }, data: { active: false, nfcUid: null } });
      return { nfc: null };
    }

    // El UID es único en toda la plataforma: no se revela de qué bar es si ya está tomado
    const taken = await prisma.tableTag.findFirst({ where: { nfcUid: uid, NOT: { tableId: id } } });
    if (taken) throw conflict("NFC_UID_TAKEN", "Ese chip ya está vinculado a otra mesa");

    const tag = await prisma.$transaction(async (tx) => {
      const current = await tx.tableTag.findFirst({ where: { tableId: id, type: "NFC_SUN" }, orderBy: { createdAt: "desc" } });
      const t = current
        ? await tx.tableTag.update({ where: { code: current.code }, data: { nfcUid: uid, sunCounter: 0, active: true } })
        : await tx.tableTag.create({
            data: { code: generateTagCode(), tenantId: ctx.tenantId, tableId: id, type: "NFC_SUN", nfcUid: uid },
          });
      await audit(tx, ctx, "table.nfc_linked", "DiningTable", id, { uid });
      return t;
    });
    return { nfc: { code: tag.code, uid: tag.nfcUid, urlTemplate: `${guestUrl(tag.code)}?uid={UID}&ctr={CTR}&cmac={CMAC}` } };
  });

  app.post("/admin/areas", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = AreaCreate.parse(req.body);
    const last = await prisma.area.aggregate({ where: { venueId: ctx.venueId }, _max: { position: true } });
    const area = await prisma.area.create({
      data: { tenantId: ctx.tenantId, venueId: ctx.venueId, name: body.name, position: (last._max.position ?? -1) + 1 },
    });
    return reply.status(201).send(area);
  });
}
