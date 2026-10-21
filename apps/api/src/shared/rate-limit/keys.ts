import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { GUEST_COOKIE, STAFF_COOKIE } from "../auth/guards.js";
import { verifyToken } from "../auth/tokens.js";

/**
 * Claves de rate limit que no dependen de la IP.
 *
 * Por qué: los front (Next) reenvían /v1/* a la API, así que para la API todos los celulares
 * vienen de la misma IP (la del servidor de Next). Limitar por IP haría que 20 mesas haciendo
 * polling compartan un solo cupo. Y confiar en X-Forwarded-For permitiría inventarse una IP
 * por request para saltear los límites (solo se confía con TRUST_PROXY, detrás de un proxy real).
 */

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);

function rawToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return req.cookies?.[GUEST_COOKIE] ?? req.cookies?.[STAFF_COOKIE];
}

/** Límite global: por dispositivo/usuario si trae un token VÁLIDO (uno inventado no sirve), si no por IP */
export async function deviceOrIpKey(req: FastifyRequest): Promise<string> {
  const token = rawToken(req);
  if (token) {
    const claims = await verifyToken(token);
    if (claims) return claims.typ === "guest" ? `guest:${claims.did}` : `${claims.typ}:${claims.sub}`;
  }
  return `ip:${req.ip}`;
}

/** Login: por cuenta (email), así cambiar de IP no habilita más intentos contra el mismo usuario */
export function loginKey(req: FastifyRequest): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? `login:${hash(email.trim().toLowerCase())}` : `login-ip:${req.ip}`;
}

/** Códigos de "Mi cuenta": por email y bar (cambiar de IP no da más intentos) */
export function customerCodeKey(req: FastifyRequest): string {
  const b = req.body as { email?: unknown; venueId?: unknown } | undefined;
  return typeof b?.email === "string"
    ? `ccode:${hash(`${String(b.venueId)}|${b.email.trim().toLowerCase()}`)}`
    : `ccode-ip:${req.ip}`;
}

/** Tope global para endpoints de alta (registro de bares): no se puede saltear cambiando de IP */
export const globalKey = (name: string) => () => `global:${name}`;
