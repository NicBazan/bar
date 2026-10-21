import path from "node:path";
import { parseCloudinaryUrl } from "./shared/cloudinary.js";

const isProd = process.env.NODE_ENV === "production";

function required(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProd) throw new Error(`Falta la variable de entorno ${name}`);
  return devDefault;
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 4000),
  // 127.0.0.1 en el MVP local (solo los front de Next llegan a la API); 0.0.0.0 en Docker
  host: process.env.HOST ?? "0.0.0.0",
  // Confiar en X-Forwarded-For SOLO detrás de un proxy real: número de saltos (ej. 2 = Vercel + Render).
  // Por defecto no: si no, cualquiera podría inventarse una IP por request.
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY ?? "") ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY === "true",
  // En dev se usa un secreto fijo; en producción es obligatorio
  jwtSecret: new TextEncoder().encode(required("JWT_SECRET", "dev-only-secret-change-me-0123456789")),
  nfcMasterKey: required("NFC_MASTER_KEY", "00112233445566778899AABBCCDDEEFF"),
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001").split(",").map((o) => o.trim()),
  // Solo en desarrollo: aceptar el front servido desde la red local (probar con el celular por Wi-Fi)
  allowLanOrigins: !isProd && process.env.CORS_ALLOW_LAN !== "false",
  // Fotos y modelos 3D subidos desde el admin. En producción: disco persistente (o R2 más adelante)
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? "uploads"),
  // URL pública de la carta, para armar los links/QR de las mesas en el admin
  publicGuestUrl: (process.env.PUBLIC_GUEST_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  // Fotos y 3D en Cloudinary (recomendado en producción). Sin la variable, se guardan en UPLOADS_DIR
  cloudinary: parseCloudinaryUrl(process.env.CLOUDINARY_URL),
  guestTokenTtl: "12h",
  staffTokenTtl: "12h",
  // "Mi cuenta": el celular queda reconocido por 90 días (se revoca al borrar la cuenta)
  customerTokenTtl: "90d",
  // Envío de emails (códigos de ingreso y promos): "console" en local (se ve en el log de la API)
  // o "resend" en producción (RESEND_API_KEY + EMAIL_FROM con un dominio verificado)
  email: {
    provider: (process.env.EMAIL_PROVIDER ?? (process.env.RESEND_API_KEY ? "resend" : "console")) as "console" | "resend",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "Bar <no-reply@example.com>",
  },
  serviceCallCooldownSec: 60,
};
