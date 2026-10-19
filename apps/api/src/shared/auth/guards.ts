import type { FastifyRequest } from "fastify";
import { HttpError, forbidden } from "../errors.js";
import { type GuestClaims, type StaffClaims, type StaffRole, verifyToken } from "./tokens.js";

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
  return claims;
}

export async function requireStaff(req: FastifyRequest, roles?: StaffRole[]): Promise<StaffClaims> {
  const claims = await readClaims(req, STAFF_COOKIE);
  if (claims.typ !== "staff") throw forbidden();
  if (roles && !roles.includes(claims.role)) throw forbidden("ROLE_NOT_ALLOWED");
  return claims;
}

/** Filtro de aislamiento: siempre por tenant y, si el staff está atado a una sucursal, por sucursal */
export function staffScope(staff: StaffClaims) {
  return staff.vid ? { tenantId: staff.tid, venueId: staff.vid } : { tenantId: staff.tid };
}

export const FLOOR_ROLES: StaffRole[] = ["OWNER", "MANAGER", "WAITER"];
export const KITCHEN_ROLES: StaffRole[] = ["OWNER", "MANAGER", "KITCHEN"];
