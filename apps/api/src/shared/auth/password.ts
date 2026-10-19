import { scryptSync, timingSafeEqual } from "node:crypto";

// Formato: scrypt$<salt hex>$<hash hex> (ver packages/db/prisma/seed.ts)
export function verifyPassword(plain: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(plain, salt, expected.length);
  return timingSafeEqual(expected, actual);
}
