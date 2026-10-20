import { describe, expect, it } from "vitest";
import { NfcSunService, aesCmac } from "../src/modules/table-session/nfc-sun.service.js";

const hex = (s: string) => Buffer.from(s, "hex");

describe("AES-CMAC (vectores oficiales RFC 4493)", () => {
  const key = hex("2b7e151628aed2a6abf7158809cf4f3c");
  it.each([
    ["", "bb1d6929e95937287fa37d129b756746"],
    ["6bc1bee22e409f96e93d7e117393172a", "070a16b46b4d4144f79bdd9dd04a287c"],
    [
      "6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411",
      "dfa66747de9ae63030ca32611497c827",
    ],
  ])("mensaje de %s bytes", (msg, expected) => {
    expect(aesCmac(key, hex(msg)).toString("hex")).toBe(expected);
  });
});

describe("NfcSunService (NTAG 424 DNA, AN12196)", () => {
  const service = new NfcSunService();
  const zeroKey = "00000000000000000000000000000000";

  // Ejemplo de mirroring plain con la clave de fábrica (todo ceros)
  it("acepta un mensaje SUN de un chip con clave de fábrica", () => {
    expect(service.verify("041E3C8A2D6B80", "000006", "4B00064004B0B3D3", zeroKey)).toBe(6);
  });

  it("rechaza si cambia el contador, el UID o el CMAC", () => {
    expect(service.verify("041E3C8A2D6B80", "000007", "4B00064004B0B3D3", zeroKey)).toBeNull();
    expect(service.verify("041E3C8A2D6B81", "000006", "4B00064004B0B3D3", zeroKey)).toBeNull();
    expect(service.verify("041E3C8A2D6B80", "000006", "4B00064004B0B3D4", zeroKey)).toBeNull();
  });

  it("rechaza con otra clave", () => {
    expect(service.verify("041E3C8A2D6B80", "000006", "4B00064004B0B3D3", "00112233445566778899AABBCCDDEEFF")).toBeNull();
  });

  it("no lanza excepciones con entradas mal formadas", () => {
    expect(service.verify("", "000006", "4B00064004B0B3D3", zeroKey)).toBeNull();
    expect(service.verify("041E3C8A2D6B80", "6", "4B00064004B0B3D3", zeroKey)).toBeNull();
    expect(service.verify("041E3C8A2D6B80", "000006", "no-es-hex!!!!!!!", zeroKey)).toBeNull();
  });
});
