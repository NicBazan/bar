import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config.js";

export type GuestClaims = {
  typ: "guest";
  tid: string; // tenant
  vid: string; // venue
  sid: string; // table session
  did: string; // guest device
  phys?: boolean; // presencia física confirmada por NFC SUN
};

export type StaffRole = "SUPER_ADMIN" | "OWNER" | "MANAGER" | "WAITER" | "KITCHEN" | "CASHIER";

export type StaffClaims = {
  typ: "staff";
  sub: string;
  tid: string;
  vid: string | null;
  role: StaffRole;
};

/** Cliente identificado por email ("Mi cuenta"): una cuenta por bar, por eso lleva el tenant */
export type CustomerClaims = {
  typ: "customer";
  sub: string; // customer
  tid: string; // tenant
};

export type Claims = GuestClaims | StaffClaims | CustomerClaims;

const TTL: Record<Claims["typ"], string> = {
  guest: config.guestTokenTtl,
  staff: config.staffTokenTtl,
  customer: config.customerTokenTtl,
};

export async function signToken(claims: Claims): Promise<string> {
  const { typ, ...rest } = claims;
  return new SignJWT({ typ, ...rest })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TTL[typ])
    .sign(config.jwtSecret);
}

export async function verifyToken(token: string): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (payload.typ === "guest" || payload.typ === "staff" || payload.typ === "customer") return payload as unknown as Claims;
    return null;
  } catch {
    return null;
  }
}

/**
 * Token de baja de promos por email ("baja en un toque", Ley 25.326): va en cada email y no
 * sirve para nada más (no es un token de sesión, verifyToken lo rechaza).
 */
export async function signUnsubToken(customerId: string, tenantId: string): Promise<string> {
  return new SignJWT({ typ: "unsub", tid: tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(customerId)
    .setIssuedAt()
    .setExpirationTime("400d")
    .sign(config.jwtSecret);
}

export async function verifyUnsubToken(token: string): Promise<{ customerId: string; tenantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (payload.typ !== "unsub" || typeof payload.sub !== "string" || typeof payload.tid !== "string") return null;
    return { customerId: payload.sub, tenantId: payload.tid };
  } catch {
    return null;
  }
}
