// Web Push de "Mi cuenta". Solo funciona en contexto seguro (HTTPS, o localhost):
// por la IP de la red local (http://192.168.x.x) el navegador no lo ofrece.
// El navegador tiene UNA suscripción para todo el sitio; cada bar la registra por separado.
import { api } from "./api";
import { customerApi } from "./customer";

export type PushSupport = "ok" | "insecure" | "unsupported" | "ios-needs-home-screen";

export type NotificationPrefs = {
  emailOptIn: boolean;
  pushDevices: number;
  thisDevice: boolean;
  tenantId: string;
  vapidPublicKey: string;
};

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return ios && !standalone ? "ios-needs-home-screen" : "unsupported";
  }
  return "ok";
}

function b64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Preferencias del cliente en este bar, incluido si ESTE celular ya recibe sus avisos */
export async function loadNotificationPrefs(venueId: string): Promise<NotificationPrefs> {
  const sub = await currentPushSubscription().catch(() => null);
  const q = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
  return customerApi<NotificationPrefs>(venueId, `/customer/notifications${q}`);
}

/** Pide permiso (solo tras un toque del cliente) y registra este celular para los avisos del bar */
export async function enablePush(venueId: string, vapidPublicKey: string): Promise<"ok" | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(vapidPublicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await customerApi(venueId, "/customer/push/subscribe", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys } });
  return "ok";
}

/** Deja de recibir los avisos de ESTE bar en este celular (los de otros bares siguen) */
export async function disablePush(tenantId: string) {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await api("/customer/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint, tenantId } });
}
