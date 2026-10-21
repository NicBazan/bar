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
