import { afterEach, describe, expect, it, vi } from "vitest";
import {
  optimizedImageUrl,
  parseCloudinaryAssetUrl,
  parseCloudinaryUrl,
  sign,
  uploadToCloudinary,
} from "../src/shared/cloudinary.js";

const cfg = { cloudName: "demo", apiKey: "1234", apiSecret: "abcd" };

describe("Cloudinary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("firma igual que el ejemplo de la documentación oficial", () => {
    // https://cloudinary.com/documentation/authentication_signatures
    const params = { eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 };
    expect(sign(params, "abcd")).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("parsea CLOUDINARY_URL y rechaza formatos inválidos", () => {
    expect(parseCloudinaryUrl("cloudinary://111:secreto@mi-cuenta")).toEqual({ apiKey: "111", apiSecret: "secreto", cloudName: "mi-cuenta" });
    expect(parseCloudinaryUrl(undefined)).toBeNull();
    expect(() => parseCloudinaryUrl("https://no-es-esto")).toThrow();
  });

  it("reconoce solo URLs de la propia cuenta y saca el public_id", () => {
    const tenant = "11111111-2222-3333-4444-555555555555";
    expect(
      parseCloudinaryAssetUrl(cfg, `https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1200/v17/bar/${tenant}/abc.jpg`),
    ).toEqual({ resourceType: "image", publicId: `bar/${tenant}/abc` });
    expect(parseCloudinaryAssetUrl(cfg, `https://res.cloudinary.com/demo/raw/upload/v17/bar/${tenant}/modelo.glb`)).toEqual({
      resourceType: "raw",
      publicId: `bar/${tenant}/modelo.glb`,
    });
    expect(parseCloudinaryAssetUrl(cfg, "https://res.cloudinary.com/otra-cuenta/image/upload/bar/x/y.jpg")).toBeNull();
    expect(parseCloudinaryAssetUrl(cfg, "https://ejemplo.com/foto.jpg")).toBeNull();
  });

  it("pide las fotos optimizadas", () => {
    expect(optimizedImageUrl("https://res.cloudinary.com/demo/image/upload/v1/bar/t/x.jpg")).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_1200/v1/bar/t/x.jpg",
    );
  });

  it("sube firmado al endpoint correcto sin mandar el secreto", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get("api_key")).toBe("1234");
      expect(form.get("public_id")).toBe("bar/t/foto");
      expect(String(form.get("signature"))).toMatch(/^[0-9a-f]{40}$/);
      // El secreto nunca viaja en el request
      for (const [, v] of form.entries()) expect(String(v)).not.toContain("abcd");
      return new Response(JSON.stringify({ secure_url: "https://res.cloudinary.com/demo/image/upload/v1/bar/t/foto.jpg", public_id: "bar/t/foto", bytes: 3 }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await uploadToCloudinary(cfg, Buffer.from([1, 2, 3]), { resourceType: "image", publicId: "bar/t/foto", mime: "image/jpeg" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
    expect(r.url).toContain("res.cloudinary.com/demo");
  });

  it("un error de Cloudinary se informa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 })));
    await expect(uploadToCloudinary(cfg, Buffer.from([1]), { resourceType: "raw", publicId: "bar/t/x.glb", mime: "model/gltf-binary" })).rejects.toThrow(
      "Invalid Signature",
    );
  });
});
