import { createECDH, createHash } from "node:crypto";
import webpush from "web-push";
import { config } from "../config.js";

/**
 * Web Push con VAPID (estándar abierto, sin servicios pagos).
 * Claves: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY si están; si no, se derivan de JWT_SECRET
 * (estables entre reinicios, así las suscripciones no se pierden en el MVP local).
 */
function vapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const priv = createHash("sha256").update("vapid|").update(config.jwtSecret).digest();
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(priv);
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: priv.toString("base64url") };
}

export const vapid = vapidKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:no-reply@example.com", vapid.publicKey, vapid.privateKey);

/**
 * Solo servicios de push reales: el endpoint lo manda el navegador del cliente y la API le hace
 * un POST. Sin esta lista, cualquiera podría usar la API para pegarle a URLs internas (SSRF).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Android y escritorio), Samsung Internet
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge heredado / Windows
  /^web\.push\.apple\.com$/, // Safari / iPhone (iOS 16.4+ agregada a inicio)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/** tid: el bar que manda el aviso (la baja desde la notificación es solo de ese bar) */
export type PushPayload = { title: string; body: string; url: string; tid: string };
/** "gone" = el navegador dio de baja la suscripción: hay que borrarla */
export type PushResult = "sent" | "gone" | "failed";

type Sender = (target: PushTarget, payload: PushPayload) => Promise<PushResult>;

let sender: Sender = async (target, payload) => {
  if (!isAllowedPushEndpoint(target.endpoint)) return "gone";
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      { TTL: 24 * 60 * 60, timeout: 10_000 },
    );
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "failed";
  }
};

export const sendPush = (target: PushTarget, payload: PushPayload) => sender(target, payload);

/** Solo para tests: reemplaza el envío real */
export function setPushSender(fn: Sender) {
  if (config.isProd) throw new Error("setPushSender no se usa en producción");
  sender = fn;
}
