import { createCipheriv, timingSafeEqual } from "node:crypto";

// ───── AES-128-CMAC (RFC 4493) con node:crypto ─────

const ZERO = Buffer.alloc(16);

function aesEcb(key: Buffer, block: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function shiftLeft(buf: Buffer): Buffer {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = ((buf[i]! << 1) | ((buf[i + 1] ?? 0) >> 7)) & 0xff;
  return out;
}

function subkey(prev: Buffer): Buffer {
  const k = shiftLeft(prev);
  if (prev[0]! & 0x80) k[15]! ^= 0x87;
  return k;
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

export function aesCmac(key: Buffer, message: Buffer): Buffer {
  const k1 = subkey(aesEcb(key, ZERO));
  const k2 = subkey(k1);
  const n = Math.max(1, Math.ceil(message.length / 16));
  const complete = message.length > 0 && message.length % 16 === 0;

  let last: Buffer = Buffer.alloc(16);
  message.copy(last, 0, (n - 1) * 16);
  if (complete) last = xor(last, k1);
  else {
    last[message.length - (n - 1) * 16] = 0x80; // padding 10*
    last = xor(last, k2);
  }

  let x: Buffer = ZERO;
  for (let i = 0; i < n - 1; i++) x = aesEcb(key, xor(x, message.subarray(i * 16, i * 16 + 16)));
  return aesEcb(key, xor(x, last));
}

// ───── NTAG 424 DNA · Secure Unique NFC (NXP AN12196) ─────

const HEX = /^[0-9a-fA-F]+$/;

export class NfcSunService {
  /**
   * Verifica el CMAC de un mensaje SUN en modo "plain mirroring" (UID y contador en claro en la URL):
   *   https://m.dominio/t/{code}?uid=<14 hex>&ctr=<6 hex>&cmac=<16 hex>
   *
   * Algoritmo NXP AN12196:
   *   SV2       = 3C C3 00 01 00 80 || UID (7 bytes) || SDMReadCtr (3 bytes, LSB primero)
   *   KSesMAC   = AES-CMAC(SDMFileReadKey, SV2)
   *   MAC       = AES-CMAC(KSesMAC, "")      ← input vacío en modo plain
   *   MACt      = bytes impares de MAC (1, 3, …, 15)
   *
   * @param counter El contador tal como lo espeja el chip: 6 hex, big-endian ("00000A" = 10).
   * @returns el contador como número si la firma es válida; null si no.
   */
  verify(uid: string, counter: string, providedCmac: string, key: string): number | null {
    try {
      if (!HEX.test(uid) || uid.length !== 14) return null;
      if (!HEX.test(counter) || counter.length !== 6) return null;
      if (!HEX.test(providedCmac) || providedCmac.length !== 16) return null;
      if (!HEX.test(key) || key.length !== 32) return null;

      const ctrBE = Buffer.from(counter, "hex");
      const ctrLE = Buffer.from([ctrBE[2]!, ctrBE[1]!, ctrBE[0]!]);
      const sv2 = Buffer.concat([Buffer.from("3CC300010080", "hex"), Buffer.from(uid, "hex"), ctrLE]);

      const sessionKey = aesCmac(Buffer.from(key, "hex"), sv2);
      const mac = aesCmac(sessionKey, Buffer.alloc(0));
      const truncated = Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => mac[i]!));

      if (!timingSafeEqual(truncated, Buffer.from(providedCmac, "hex"))) return null;
      return ctrBE.readUIntBE(0, 3);
    } catch {
      return null;
    }
  }
}

export const nfcSunService = new NfcSunService();
