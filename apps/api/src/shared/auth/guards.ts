import type { FastifyRequest } from "fastify";
import { prisma } from "../db/index.js";
import { HttpError, forbidden } from "../errors.js";
import { type CustomerClaims, type GuestClaims, type StaffClaims, type StaffRole, verifyToken } from "./tokens.js";

export const GUEST_COOKIE = "bar_guest";
export const STAFF_COOKIE = "bar_staff";

// Acepta Bearer (App Clip, tests) o cookie HttpOnly (PWA)
async function readClaims(req: FastifyRequest, cookieName: string) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : req.cookies?.[cookieName];
  if (!token) throw new HttpError(401, "UNAUTHENTICATED");
  const claims = await verifyToken(token);
  if (!claims) throw new HttpError(401, "INVALID_TOKEN");
  return claims;
}

export async function requireGuest(req: FastifyRequest): Promise<GuestClaims> {
  const claims = await readClaims(req, GUEST_COOKIE);
  if (claims.typ !== "guest") throw forbidden();
  await assertTenantActive(claims.tid);
  return claims;
}

/**
 * Cliente con "Mi cuenta" (solo Bearer: el token vive en el celular del cliente).
 * Se consulta la base en cada request: una cuenta borrada pierde el acceso al instante.
 */
export async function requireCustomer(req: FastifyRequest): Promise<CustomerClaims & { email: string; name: string | null }> {
  const header = req.headers.authorization;
  const claims = header?.startsWith("Bearer ") ? await verifyToken(header.slice(7)) : null;
  if (!claims) throw new HttpError(401, "UNAUTHENTICATED");
  if (claims.typ !== "customer") throw forbidden();
  const customer = await prisma.customer.findFirst({
    where: { id: claims.sub, tenantId: claims.tid },
    select: { email: true, name: true },
  });
  if (!customer) throw new HttpError(401, "CUSTOMER_GONE");
  await assertTenantActive(claims.tid);
  return { ...claims, ...customer };
}

// ───── Bar suspendido ─────
const tenantCache = new Map<string, { at: number; suspended: boolean }>();

/** 402 si el bar está suspendido por la plataforma (la carta lo muestra como "atención en mesa") */
export async function assertTenantActive(tenantId: string) {
  let hit = tenantCache.get(tenantId);
  if (!hit || Date.now() - hit.at > STATUS_TTL_MS) {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { suspendedAt: true } });
    hit = { at: Date.now(), suspended: !t || Boolean(t.suspendedAt) };
    tenantCache.set(tenantId, hit);
    if (tenantCache.size > 5000) tenantCache.clear();
  }
  if (hit.suspended) throw new HttpError(402, "TENANT_SUSPENDED", "El sistema digital de este local no está disponible.");
}

// ───── Estado vivo del staff ─────
// El JWT dura 12 h: sin este chequeo, un mozo dado de baja (o un bar suspendido) seguiría
// operando hasta que venza el token. Se consulta la base con un caché corto por usuario.

type StaffStatus = {
  active: boolean;
  role: StaffRole;
  tenantId: string;
  venueId: string | null;
  suspended: boolean;
  isPlatform: boolean;
};

const STATUS_TTL_MS = 10_000;
const statusCache = new Map<string, { at: number; status: StaffStatus | null }>();

async function loadStaffStatus(userId: string): Promise<StaffStatus | null> {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.status;
  const user = await prisma.staffUser.findUnique({
    where: { id: userId },
    select: {
      active: true,
      role: true,
      tenantId: true,
      venueId: true,
      tenant: { select: { suspendedAt: true, isPlatform: true } },
    },
  });
  const status = user
    ? {
        active: user.active,
        role: user.role as StaffRole,
        tenantId: user.tenantId,
        venueId: user.venueId,
        suspended: Boolean(user.tenant.suspendedAt),
        isPlatform: user.tenant.isPlatform,
      }
    : null;
  statusCache.set(userId, { at: Date.now(), status });
  if (statusCache.size > 5000) statusCache.clear(); // tope de memoria
  return status;
}

/** Llamar después de cambiar rol, activar/desactivar o suspender, para que aplique ya */
export function invalidateStaffStatus(userId?: string) {
  if (userId) statusCache.delete(userId);
  else statusCache.clear();
}

export function invalidateTenantStatus(tenantId: string) {
  tenantCache.delete(tenantId);
  statusCache.clear(); // los usuarios de ese tenant también cambian de estado
}

export async function requireStaff(req: FastifyRequest, roles?: StaffRole[]): Promise<StaffClaims> {
  const claims = await readClaims(req, STAFF_COOKIE);
  if (claims.typ !== "staff") throw forbidden();

  const status = await loadStaffStatus(claims.sub);
  if (!status || !status.active || status.tenantId !== claims.tid) throw new HttpError(401, "STAFF_INACTIVE");
  if (status.suspended) throw new HttpError(403, "TENANT_SUSPENDED", "Este local está suspendido");

  // Rol y sucursal vigentes en la base (no los del token)
  const fresh: StaffClaims = { ...claims, role: status.role, vid: status.venueId };
  if (roles && !roles.includes(fresh.role)) throw forbidden("ROLE_NOT_ALLOWED");
  return fresh;
}

/** Super admin: rol SUPER_ADMIN y además usuario del tenant de la plataforma */
export async function requireSuperAdmin(req: FastifyRequest): Promise<StaffClaims> {
  const staff = await requireStaff(req, ["SUPER_ADMIN"]);
  const status = await loadStaffStatus(staff.sub);
  if (!status?.isPlatform) throw forbidden("ROLE_NOT_ALLOWED");
  return staff;
}

/** Filtro de aislamiento: siempre por tenant y, si el staff está atado a una sucursal, por sucursal */
export function staffScope(staff: StaffClaims) {
  return staff.vid ? { tenantId: staff.tid, venueId: staff.vid } : { tenantId: staff.tid };
}

export const FLOOR_ROLES: StaffRole[] = ["OWNER", "MANAGER", "WAITER"];
export const KITCHEN_ROLES: StaffRole[] = ["OWNER", "MANAGER", "KITCHEN"];
export const ADMIN_ROLES: StaffRole[] = ["OWNER", "MANAGER"];
