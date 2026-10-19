import { describe, expect, it } from "vitest";
import { aesCmac } from "node-aes-cmac";
import { NfcSunService } from "../src/modules/table-session/nfc-sun.service.js";

describe("NfcSunService", () => {
  const service = new NfcSunService();
  const masterKey = "00112233445566778899AABBCCDDEEFF";
  const uid = "04A1B2C3D4E5F6";
  const counter = "000001";

  it("calculates and verifies valid truncated odd-byte CMAC", () => {
    // Generate valid CMAC directly using the exact formula
    const keyBuf = Buffer.from(masterKey, "hex");
    const prefix = Buffer.from([0x3c]);
    const ctrBuf = Buffer.from(counter, "hex");
    const uidBuf = Buffer.from(uid, "hex");
    const message = Buffer.concat([prefix, ctrBuf, uidBuf]);

    const fullCmac = aesCmac(keyBuf, message, { returnAsBuffer: true }) as Buffer;

    // Odd bytes (1, 3, 5, 7, 9, 11, 13, 15)
    const truncated = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
      truncated[i] = fullCmac[2 * i + 1]!;
    }
    const validCmacHex = truncated.toString("hex");

    const result = service.verifyNfcSignature(uid, counter, validCmacHex, masterKey);
    expect(result).toBe(true);
  });

  it("rejects altered CMAC signature", () => {
    const invalidCmac = "0102030405060708";
    const result = service.verifyNfcSignature(uid, counter, invalidCmac, masterKey);
    expect(result).toBe(false);
  });

  it("rejects mismatched UID or Counter", () => {
    // Valid CMAC for counter "000001"
    const keyBuf = Buffer.from(masterKey, "hex");
    const message = Buffer.concat([Buffer.from([0x3c]), Buffer.from(counter, "hex"), Buffer.from(uid, "hex")]);
    const fullCmac = aesCmac(keyBuf, message, { returnAsBuffer: true }) as Buffer;
    const truncated = Buffer.alloc(8);
    for (let i = 0; i < 8; i++) {
      truncated[i] = fullCmac[2 * i + 1]!;
    }
    const validCmacHex = truncated.toString("hex");

    // Different counter
    expect(service.verifyNfcSignature(uid, "000002", validCmacHex, masterKey)).toBe(false);
    // Different UID
    expect(service.verifyNfcSignature("04FFFFFFFFFFFF", counter, validCmacHex, masterKey)).toBe(false);
  });

  it("handles malformed or invalid hex strings safely without throwing", () => {
    expect(service.verifyNfcSignature("", counter, "1234", masterKey)).toBe(false);
    expect(service.verifyNfcSignature(uid, counter, "not-hex-at-all!!", masterKey)).toBe(false);
    expect(service.verifyNfcSignature(uid, counter, "1234", masterKey)).toBe(false);
  });
});
