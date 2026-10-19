import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config.js";

export type GuestClaims = {
  typ: "guest";
  tid: string; // tenant
  vid: string; // venue
  sid: string; // table session
  did: string; // guest device
};

export type StaffRole = "OWNER" | "MANAGER" | "WAITER" | "KITCHEN" | "CASHIER";

export type StaffClaims = {
  typ: "staff";
  sub: string;
  tid: string;
  vid: string | null;
  role: StaffRole;
};

export type Claims = GuestClaims | StaffClaims;

export async function signToken(claims: Claims): Promise<string> {
  const { typ, ...rest } = claims;
  return new SignJWT({ typ, ...rest })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(typ === "guest" ? config.guestTokenTtl : config.staffTokenTtl)
    .sign(config.jwtSecret);
}

export async function verifyToken(token: string): Promise<Claims | null> {
  try {
    const { payload } = await jwtVerify(token, config.jwtSecret, { algorithms: ["HS256"] });
    if (payload.typ === "guest" || payload.typ === "staff") return payload as unknown as Claims;
    return null;
  } catch {
    return null;
  }
}
