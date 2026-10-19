import { timingSafeEqual } from "node:crypto";
import { aesCmac } from "node-aes-cmac";

export class NfcSunService {
  /**
   * Verifica la firma criptográfica SUN (Secure Unique NFC) de un tag NTAG 424 DNA.
   *
   * @param uid Identificador único del chip (7 bytes en hexadecimal, ej. "04A1B2C3D4E5F6").
   * @param counter Contador de lectura del tag (3 bytes en hexadecimal o decimal, ej. "000001").
   * @param providedCmac CMAC truncado enviado por el tag (8 bytes en hexadecimal = 16 caracteres).
   * @param masterKey Clave maestra AES-128 (16 bytes en hexadecimal = 32 caracteres).
   * @returns true si la firma es válida y coincide de forma segura con el cálculo.
   */
  verifyNfcSignature(
    uid: string,
    counter: string,
    providedCmac: string,
    masterKey: string,
  ): boolean {
    try {
      if (!uid || !counter || !providedCmac || !masterKey) {
        return false;
      }

      const uidClean = uid.trim().replace(/[^0-9a-fA-F]/g, "");
      const ctrClean = counter.trim().replace(/[^0-9a-fA-F]/g, "");
      const cmacClean = providedCmac.trim().replace(/[^0-9a-fA-F]/g, "");
      const keyClean = masterKey.trim().replace(/[^0-9a-fA-F]/g, "");

      // Clave maestra AES-128: exactamente 16 bytes (32 caracteres hex)
      if (keyClean.length !== 32) {
        return false;
      }

      // El CMAC truncado del NTAG 424 DNA debe tener 8 bytes (16 caracteres hex)
      if (cmacClean.length !== 16) {
        return false;
      }

      const keyBuffer = Buffer.from(keyClean, "hex");
      // El contador NTAG 424 tiene 3 bytes (6 caracteres hex), rellenamos con ceros a la izquierda si es necesario
      const ctrBuffer = Buffer.from(ctrClean.padStart(6, "0"), "hex");
      const uidBuffer = Buffer.from(uidClean, "hex");

      // Construcción del mensaje a firmar: 0x3C + counter (3 bytes) + uid (7 bytes)
      const prefix = Buffer.from([0x3c]);
      const message = Buffer.concat([prefix, ctrBuffer, uidBuffer]);

      // Cálculo del AES-CMAC completo (16 bytes)
      const fullCmacRaw = aesCmac(keyBuffer, message, { returnAsBuffer: true });
      const fullCmacBuffer = Buffer.isBuffer(fullCmacRaw)
        ? fullCmacRaw
        : Buffer.from(fullCmacRaw as string, "hex");

      if (fullCmacBuffer.length !== 16) {
        return false;
      }

      // Truncamiento estándar NTAG 424 DNA: extraer los bytes en posiciones impares
      // (1, 3, 5, 7, 9, 11, 13, 15) para obtener exactamente 8 bytes
      const truncatedCmac = Buffer.alloc(8);
      for (let i = 0; i < 8; i++) {
        truncatedCmac[i] = fullCmacBuffer[2 * i + 1]!;
      }

      const providedBuffer = Buffer.from(cmacClean, "hex");
      if (truncatedCmac.length !== providedBuffer.length) {
        return false;
      }

      return timingSafeEqual(truncatedCmac, providedBuffer);
    } catch {
      return false;
    }
  }
}

export const nfcSunService = new NfcSunService();
