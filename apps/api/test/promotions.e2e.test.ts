// Promociones, Web Push y emails segmentados: opt-in explícito, tope semanal y baja en un toque.
// Usa bares temporales (el tope de 1 campaña por semana no debe afectar al bar demo).
import { randomUUID } from "node:crypto";
import { prisma, purgeTenant } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { devOutbox } from "../src/shared/email/index.js";
import { type PushResult, setPushSender } from "../src/shared/push.js";

let app: FastifyInstance;
const created: string[] = [];
const pushed: Array<{ endpoint: string; title: string }> = [];
let pushResult: PushResult = "sent";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const FCM = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

type Bar = { token: string; venueId: string; tenantId: string };

async function onboard(): Promise<Bar> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/onboarding/register",
    payload: { ownerName: "Dueña", email: `owner-${randomUUID()}@test.local`, password: "clave-segura-123", barName: `Bar Promos ${randomUUID().slice(0, 4)}` },
  });
  const b = res.json();
  created.push(b.tenant.id);
  return { token: b.token, venueId: b.venue.id, tenantId: b.tenant.id };
}

async function customer(bar: Bar) {
  const email = `promo-${randomUUID()}@test.local`;
  await app.inject({ method: "POST", url: "/v1/customer/auth/request-code", payload: { venueId: bar.venueId, email } });
  const code = [...devOutbox()].reverse().find((m) => m.to === email)!.text.match(/\b(\d{6})\b/)![1];
  const res = await app.inject({ method: "POST", url: "/v1/customer/auth/verify", payload: { venueId: bar.venueId, email, code, acceptPrivacy: true } });
  return { email, token: res.json().token as string, id: res.json().customer.id as string };
}

const send = (bar: Bar, payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/admin/campaigns", headers: auth(bar.token), payload });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  setPushSender(async (target, payload) => {
    pushed.push({ endpoint: target.endpoint, title: payload.title });
    return pushResult;
  });
});

afterAll(async () => {
  for (const id of created) await purgeTenant(prisma, id);
  await app.close();
  await prisma.$disconnect();
});

describe("promociones", () => {
  it("el dueño carga promos; la carta ve solo las vigentes y otro bar no las toca", async () => {
    const A = await onboard();
    const B = await onboard();
    const ok = await app.inject({ method: "POST", url: "/v1/admin/promotions", headers: auth(A.token), payload: { title: "2x1 en pintas", body: "De 18 a 20 h" } });
    expect(ok.statusCode).toBe(201);
    await app.inject({
      method: "POST",
      url: "/v1/admin/promotions",
      headers: auth(A.token),
      payload: { title: "Vencida", body: "Ya fue", endsAt: new Date(Date.now() - 1000).toISOString() },
    });
    const bad = await app.inject({
      method: "POST",
      url: "/v1/admin/promotions",
      headers: auth(A.token),
      payload: { title: "Fechas al revés", body: "x", startsAt: "2026-12-10", endsAt: "2026-12-01" },
    });
    expect(bad.statusCode).toBe(400);

    const live = (await app.inject({ url: `/v1/venues/${A.venueId}/promos` })).json();
    expect(live.map((p: { title: string }) => p.title)).toEqual(["2x1 en pintas"]);

    const id = ok.json().id;
    expect((await app.inject({ method: "PATCH", url: `/v1/admin/promotions/${id}`, headers: auth(B.token), payload: { active: false } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/promotions/${id}`, headers: auth(B.token) })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/venues/${B.venueId}/promos` })).json()).toHaveLength(0);
  });
});

describe("avisos: opt-in, push y emails", () => {
  it("nada preseleccionado; push solo a servicios reales", async () => {
    const A = await onboard();
    const c = await customer(A);
    const n = (await app.inject({ url: "/v1/customer/notifications", headers: auth(c.token) })).json();
    expect(n.emailOptIn).toBe(false);
    expect(n.pushDevices).toBe(0);
    expect(n.vapidPublicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);

    // SSRF: la API nunca le hace POST a un endpoint que no sea de un servicio de push
    for (const endpoint of ["http://127.0.0.1:4000/v1/admin", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com:8443/x"]) {
      const r = await app.inject({ method: "POST", url: "/v1/customer/push/subscribe", headers: auth(c.token), payload: { endpoint, keys: KEYS } });
      expect(r.statusCode).toBe(400);
    }
    const ok = await app.inject({ method: "POST", url: "/v1/customer/push/subscribe", headers: auth(c.token), payload: { endpoint: FCM(), keys: KEYS } });
    expect(ok.statusCode).toBe(200);
  });

  it("campaña: push a suscriptos, email solo a quien aceptó, baja en un toque y tope semanal", async () => {
    const A = await onboard();
    const withEmail = await customer(A);
    const withPush = await customer(A);
    const nothing = await customer(A);
    await app.inject({ method: "PUT", url: "/v1/customer/notifications/email", headers: auth(withEmail.token), payload: { enabled: true } });
    const endpoint = FCM();
    await app.inject({ method: "POST", url: "/v1/customer/push/subscribe", headers: auth(withPush.token), payload: { endpoint, keys: KEYS } });

    const info = (await app.inject({ url: "/v1/admin/campaigns", headers: auth(A.token) })).json();
    expect(info.audience.ALL).toEqual({ customers: 2, email: 1, push: 1 });
    expect(info.nextAllowedAt).toBeNull();

    const before = devOutbox().length;
    pushed.length = 0;
    const res = await send(A, { title: "Volvé", body: "Esta semana 20% off", segment: "ALL" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(expect.objectContaining({ pushSent: 1, emailSent: 1 }));
    expect(pushed).toEqual([expect.objectContaining({ endpoint })]);
    const mails = devOutbox().slice(before);
    expect(mails.map((m) => m.to)).toEqual([withEmail.email]);
    expect(mails.some((m) => m.to === nothing.email)).toBe(false);
    expect(mails[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    // Tope: 1 por semana por bar
    const again = await send(A, { title: "Otra", body: "x", segment: "ALL" });
    expect(again.statusCode).toBe(429);
    expect(again.json().error).toBe("CAMPAIGN_WEEKLY_LIMIT");

    // Baja en un toque desde el cliente de correo (POST con formulario, token en la URL)
    const oneClick = mails[0]!.headers!["List-Unsubscribe"]!.slice(1, -1);
    const url = new URL(oneClick);
    const unsub = await app.inject({
      method: "POST",
      url: `${url.pathname}${url.search}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "List-Unsubscribe=One-Click",
    });
    expect(unsub.statusCode).toBe(200);
    const n = (await app.inject({ url: "/v1/customer/notifications", headers: auth(withEmail.token) })).json();
    expect(n.emailOptIn).toBe(false);

    const forged = await app.inject({ method: "POST", url: "/v1/customer/unsubscribe", payload: { t: withEmail.token } });
    expect(forged.statusCode).toBe(400); // un token de sesión no sirve como link de baja
  });

  it("el mismo celular recibe avisos de dos bares y se da de baja de uno solo", async () => {
    const A = await onboard();
    const B = await onboard();
    const ca = await customer(A);
    const cb = await customer(B);
    const endpoint = FCM(); // un navegador tiene un solo endpoint para todo el sitio
    for (const c of [ca, cb]) {
      const r = await app.inject({ method: "POST", url: "/v1/customer/push/subscribe", headers: auth(c.token), payload: { endpoint, keys: KEYS } });
      expect(r.statusCode).toBe(200);
    }
    const mine = async (c: { token: string }) =>
      (await app.inject({ url: `/v1/customer/notifications?endpoint=${encodeURIComponent(endpoint)}`, headers: auth(c.token) })).json().thisDevice;
    expect(await mine(ca)).toBe(true);
    expect(await mine(cb)).toBe(true);

    await app.inject({ method: "POST", url: "/v1/customer/push/unsubscribe", payload: { endpoint, tenantId: A.tenantId } });
    expect(await mine(ca)).toBe(false);
    expect(await mine(cb)).toBe(true);
  });

  it("dos envíos simultáneos: solo sale uno", async () => {
    const A = await onboard();
    const results = await Promise.all([send(A, { title: "a", body: "a", segment: "ALL" }), send(A, { title: "b", body: "b", segment: "ALL" })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 429]);
  });

  it("segmento 'no vienen hace 30 días' y suscripciones vencidas se borran", async () => {
    const A = await onboard();
    const recent = await customer(A);
    const old = await customer(A);
    for (const c of [recent, old]) {
      await app.inject({ method: "POST", url: "/v1/customer/push/subscribe", headers: auth(c.token), payload: { endpoint: FCM(), keys: KEYS } });
    }
    await prisma.customer.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 40 * 86400_000) } });

    const info = (await app.inject({ url: "/v1/admin/campaigns", headers: auth(A.token) })).json();
    expect(info.audience.INACTIVE_30.customers).toBe(1);

    pushResult = "gone";
    const res = await send(A, { title: "Te extrañamos", body: "Vení", segment: "INACTIVE_30" });
    pushResult = "sent";
    expect(res.json().pushSent).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { customerId: old.id } })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { customerId: recent.id } })).toBe(1);
  });
});
