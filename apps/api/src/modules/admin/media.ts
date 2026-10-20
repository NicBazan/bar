import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import {
  destroyInCloudinary,
  optimizedImageUrl,
  parseCloudinaryAssetUrl,
  uploadToCloudinary,
} from "../../shared/cloudinary.js";
import { HttpError, notFound } from "../../shared/errors.js";

/**
 * Archivos subidos por el admin (fotos de platos y modelos 3D).
 *
 * Seguridad (lecciones de Enterprice/taller):
 * - Se valida el CONTENIDO (firma de bytes), no la extensión ni el Content-Type que manda el cliente.
 * - Solo JPG / PNG / WebP / GLB / USDZ. Nunca SVG ni HTML (podrían ejecutar scripts).
 * - El nombre del archivo lo genera el servidor (UUID): imposible pisar archivos o salir de la carpeta.
 * - Se sirven con nosniff + CSP "default-src 'none'" + Content-Disposition inline.
 */

export type MediaKind = "PHOTO" | "GLB_LOD0" | "USDZ";

const TYPES = {
  jpg: { mime: "image/jpeg", max: 5 * 1024 * 1024 },
  png: { mime: "image/png", max: 5 * 1024 * 1024 },
  webp: { mime: "image/webp", max: 5 * 1024 * 1024 },
  glb: { mime: "model/gltf-binary", max: 25 * 1024 * 1024 },
  usdz: { mime: "model/vnd.usdz+zip", max: 25 * 1024 * 1024 },
} as const;
type Ext = keyof typeof TYPES;

const ALLOWED_FOR: Record<MediaKind, Ext[]> = {
  PHOTO: ["jpg", "png", "webp"],
  GLB_LOD0: ["glb"],
  USDZ: ["usdz"],
};

/** Detecta el tipo real por los primeros bytes */
export function sniff(buf: Buffer): Ext | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  // GLB: "glTF" + versión 2 + largo declarado == largo real
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "glTF" && buf.readUInt32LE(4) === 2 && buf.readUInt32LE(8) === buf.length) {
    return "glb";
  }
  // USDZ: es un ZIP (PK\x03\x04) cuyo primer archivo es .usd/.usda/.usdc
  if (buf.length >= 30 && buf.readUInt32LE(0) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(26);
    const name = buf.toString("utf8", 30, 30 + nameLen).toLowerCase();
    if (/\.usd[ac]?$/.test(name)) return "usdz";
  }
  return null;
}

/**
 * Valida y guarda el archivo. Con CLOUDINARY_URL va a Cloudinary (carpeta bar/{tenant}/);
 * sin ella, al disco local (/v1/media/{tenant}/{uuid}.{ext}). La validación es la misma en los dos casos.
 */
export async function saveMedia(tenantId: string, kind: MediaKind, buf: Buffer) {
  const ext = sniff(buf);
  if (!ext || !ALLOWED_FOR[kind].includes(ext)) {
    const expected = ALLOWED_FOR[kind].join(", ").toUpperCase();
    throw new HttpError(415, "UNSUPPORTED_FILE", `Archivo no válido. Formatos aceptados: ${expected}.`);
  }
  if (buf.length > TYPES[ext].max) {
    throw new HttpError(413, "FILE_TOO_LARGE", `El archivo supera ${TYPES[ext].max / 1024 / 1024} MB.`);
  }

  if (config.cloudinary) {
    const isImage = kind === "PHOTO";
    const id = randomUUID();
    try {
      const up = await uploadToCloudinary(config.cloudinary, buf, {
        resourceType: isImage ? "image" : "raw",
        // raw: la extensión va en el public_id para que se sirva con su tipo (.glb / .usdz)
        publicId: `bar/${tenantId}/${isImage ? id : `${id}.${ext}`}`,
        mime: TYPES[ext].mime,
      });
      return { url: isImage ? optimizedImageUrl(up.url) : up.url, bytes: up.bytes };
    } catch (e) {
      throw new HttpError(502, "STORAGE_ERROR", `No se pudo subir a Cloudinary: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  const dir = path.join(config.uploadsDir, tenantId);
  await mkdir(dir, { recursive: true });
  const file = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, file), buf, { flag: "wx" });
  return { url: `/v1/media/${tenantId}/${file}`, bytes: buf.length };
}

/** Borra un archivo propio del tenant a partir de su URL pública (ignora URLs externas) */
export async function deleteMediaByUrl(tenantId: string, url: string) {
  if (config.cloudinary) {
    const asset = parseCloudinaryAssetUrl(config.cloudinary, url);
    // Solo se borra lo que está en la carpeta de ESTE bar
    if (asset && asset.publicId.startsWith(`bar/${tenantId}/`)) {
      await destroyInCloudinary(config.cloudinary, asset.publicId, asset.resourceType);
      return;
    }
  }
  const m = MEDIA_URL.exec(url);
  if (!m || m[1] !== tenantId) return;
  await unlink(path.join(config.uploadsDir, m[1], m[2]!)).catch(() => undefined);
}

const MEDIA_URL = /^\/v1\/media\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp|glb|usdz))$/;

export async function mediaRoutes(app: FastifyInstance) {
  // Público (la carta lo muestra), pero solo nombres generados por el servidor
  app.get("/media/:tenantId/:file", async (req, reply) => {
    const { tenantId, file } = z
      .object({
        tenantId: z.uuid(),
        file: z.string().regex(/^[0-9a-f-]{36}\.(jpg|png|webp|glb|usdz)$/),
      })
      .parse(req.params);
    const full = path.join(config.uploadsDir, tenantId, file);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw notFound("Archivo");

    const ext = file.split(".").pop() as Ext;
    reply
      .header("Content-Type", TYPES[ext].mime)
      .header("Content-Length", info.size)
      .header("Cache-Control", "public, max-age=31536000, immutable") // el nombre cambia con cada subida
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("Content-Disposition", "inline")
      .header("Cross-Origin-Resource-Policy", "cross-origin"); // Scene Viewer / Quick Look lo bajan
    return reply.send(createReadStream(full));
  });
}
