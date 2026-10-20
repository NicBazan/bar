import { randomBytes, randomInt } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Código público de una mesa para la URL /t/{code}: 10 caracteres base62 aleatorios
 * (~59 bits), imposible de adivinar o recorrer. Sin sesgo: se descartan bytes >= 248.
 */
export function generateTagCode(len = 10): string {
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248 && out.length < len) out += BASE62[b % 62];
    }
  }
  return out;
}

/** Contraseña temporal legible para entregar por WhatsApp/teléfono (12 caracteres) */
export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // sin 0/O, 1/l/I
  return Array.from({ length: 12 }, () => alphabet[randomInt(0, alphabet.length)]).join("");
}
