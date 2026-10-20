import { createHash } from "node:crypto";

/**
 * Cliente mínimo de Cloudinary (API REST firmada, sin SDK).
 * Se activa con CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME (panel de Cloudinary → API Keys).
 * El secreto nunca sale del servidor: el navegador sube a la API y la API sube a Cloudinary.
 */

export type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

export function parseCloudinaryUrl(raw: string | undefined): CloudinaryConfig | null {
  if (!raw) return null;
  const m = /^cloudinary:\/\/([^:@\s]+):([^@\s]+)@([a-z0-9_-]+)\/?$/i.exec(raw.trim());
  if (!m) throw new Error("CLOUDINARY_URL inválida: debe ser cloudinary://API_KEY:API_SECRET@CLOUD_NAME");
  return { apiKey: m[1]!, apiSecret: m[2]!, cloudName: m[3]! };
}

/** Firma de Cloudinary: SHA-1 de los parámetros ordenados (a=1&b=2) + api_secret */
export function sign(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

// Fotos como "image" (Cloudinary las optimiza al servir); modelos 3D como "raw" (bytes intactos)
export type ResourceType = "image" | "raw";

export async function uploadToCloudinary(
  cfg: CloudinaryConfig,
  file: Buffer,
  opts: { resourceType: ResourceType; publicId: string; mime: string },
): Promise<{ url: string; publicId: string; bytes: number }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: opts.publicId, timestamp, overwrite: "false" };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type: opts.mime }));
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append("api_key", cfg.apiKey);
  form.append("signature", sign(params, cfg.apiSecret));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/${opts.resourceType}/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json().catch(() => ({}))) as { secure_url?: string; public_id?: string; bytes?: number; error?: { message?: string } };
  if (!res.ok || !data.secure_url) throw new Error(`Cloudinary: ${data.error?.message ?? res.status}`);
  return { url: data.secure_url, publicId: data.public_id ?? opts.publicId, bytes: data.bytes ?? file.length };
}

export async function destroyInCloudinary(cfg: CloudinaryConfig, publicId: string, resourceType: ResourceType) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp };
  const form = new FormData();
  for (const [k, v] of Object.entries(params)) form.append(k, String(v));
  form.append("api_key", cfg.apiKey);
  form.append("signature", sign(params, cfg.apiSecret));
  await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/${resourceType}/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined); // borrar es "mejor esfuerzo": no bloquea el cambio en la carta
}

/**
 * De una URL de Cloudinary de NUESTRA cuenta saca el tipo y el public_id.
 *   https://res.cloudinary.com/{cloud}/{image|raw}/upload/[transformaciones/][v123/]{public_id}[.ext]
 * Para "image" el public_id va sin extensión; para "raw" la extensión es parte del public_id.
 */
export function parseCloudinaryAssetUrl(cfg: CloudinaryConfig, url: string): { resourceType: ResourceType; publicId: string } | null {
  const prefix = `https://res.cloudinary.com/${cfg.cloudName}/`;
  if (!url.startsWith(prefix)) return null;
  const m = /^(image|raw)\/upload\/(.+)$/.exec(url.slice(prefix.length));
  if (!m) return null;
  const resourceType = m[1] as ResourceType;
  // Se descartan los segmentos de transformación y versión: el public_id empieza en "bar/"
  const idx = m[2]!.indexOf("bar/");
  if (idx < 0) return null;
  let publicId = m[2]!.slice(idx);
  if (resourceType === "image") publicId = publicId.replace(/\.[a-z0-9]+$/i, "");
  return { resourceType, publicId };
}

/** URL de entrega optimizada para fotos: formato y calidad automáticos, hasta 1200 px */
export function optimizedImageUrl(url: string): string {
  return url.replace("/image/upload/", "/image/upload/f_auto,q_auto,c_limit,w_1200/");
}
