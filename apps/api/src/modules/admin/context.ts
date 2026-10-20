import type { FastifyRequest } from "fastify";
import { ADMIN_ROLES, requireStaff } from "../../shared/auth/guards.js";
import type { StaffClaims } from "../../shared/auth/tokens.js";
import { prisma, type Tx } from "../../shared/db/index.js";
import { notFound } from "../../shared/errors.js";

export type AdminContext = {
  staff: StaffClaims;
  tenantId: string;
  venueId: string;
  venueMenuId: string;
  menuId: string;
};

/**
 * Autentica al admin (OWNER/MANAGER) y resuelve su sucursal y su carta activa.
 * Toda consulta del admin parte de acá: el tenantId sale del token, nunca del request.
 */
export async function requireAdmin(req: FastifyRequest): Promise<AdminContext> {
  const staff = await requireStaff(req, ADMIN_ROLES);
  const venue = staff.vid
    ? await prisma.venue.findFirst({ where: { id: staff.vid, tenantId: staff.tid }, select: { id: true } })
    : await prisma.venue.findFirst({ where: { tenantId: staff.tid }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!venue) throw notFound("Local");

  let vm = await prisma.venueMenu.findFirst({
    where: { venueId: venue.id, tenantId: staff.tid, active: true },
    select: { id: true, menuId: true },
  });
  if (!vm) {
    // Bar sin carta (no debería pasar, el onboarding la crea): se crea vacía
    const menu = await prisma.menu.create({ data: { tenantId: staff.tid, name: "Carta principal" } });
    vm = await prisma.venueMenu.create({
      data: { tenantId: staff.tid, venueId: venue.id, menuId: menu.id },
      select: { id: true, menuId: true },
    });
  }
  return { staff, tenantId: staff.tid, venueId: venue.id, venueMenuId: vm.id, menuId: vm.menuId };
}

/** Cada cambio de carta sube la versión (invalida cachés de la carta pública y del Chef IA) */
export async function bumpMenuVersion(tx: Tx, venueMenuId: string) {
  await tx.venueMenu.update({ where: { id: venueMenuId }, data: { version: { increment: 1 } } });
}

export async function audit(
  tx: Tx,
  ctx: { tenantId: string; staff: StaffClaims },
  action: string,
  entity: string,
  entityId: string,
  data?: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: { tenantId: ctx.tenantId, actorId: ctx.staff.sub, action, entity, entityId, data: (data ?? {}) as object },
  });
}
