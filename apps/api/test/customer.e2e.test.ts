// "Mi cuenta" del cliente: código por email, vínculo con la mesa, historial, "pedir lo mismo",
// exportar y borrar. Usa el bar demo (mesa B1) y un bar temporal para el aislamiento.
import { randomUUID } from "node:crypto";
import { prisma, purgeTenant } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { devOutbox } from "../src/shared/email/index.js";

let app: FastifyInstance;
let tagCode: string;
let venueId: string;
let mozo: string;
const created: string[] = [];

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Último código enviado a ese email por el adaptador de consola */
function lastCode(email: string): string {
  const mail = [...devOutbox()].reverse().find((m) => m.to === email);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`No hay código para ${email}`);
  return code;
}

async function requestCode(email: string, venue = venueId) {
  return app.inject({ method: "POST", url: "/v1/customer/auth/request-code", payload: { venueId: venue, email } });
}

async function verify(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/customer/auth/verify", payload: { venueId, ...payload } });
}

async function dishId(name: string) {
  const menu = (await app.inject({ url: `/v1/venues/${venueId}/menu` })).json();
  const dish = menu.categories.flatMap((c: { dishes: Array<{ id: string; name: string }> }) => c.dishes).find((d: { name: string }) => d.name === name);
  return dish.id as string;
}

async function order(guest: string, dish: string) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/orders",
    headers: { ...auth(guest), "idempotency-key": randomUUID() },
    payload: { items: [{ dishId: dish, quantity: 2 }] },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  expect((await app.inject({ method: "POST", url: `/v1/staff/orders/${id}/approve`, headers: auth(mozo) })).statusCode).toBe(200);
  return id;
}

/** Sienta un celular en la mesa B1 (sesión nueva) y el mozo la abre */
async function sitDown() {
  const tag = await prisma.tableTag.findUniqueOrThrow({ where: { code: tagCode } });
  await prisma.tableSession.updateMany({ where: { tableId: tag.tableId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  const join = await app.inject({ method: "POST", url: `/v1/tags/${tagCode}/session`, payload: { deviceKey: `dev-${randomUUID()}` } });
  const { token, session } = join.json();
  await app.inject({ method: "POST", url: `/v1/staff/sessions/${session.id}/open`, headers: auth(mozo) });
  return { guest: token as string, sessionId: session.id as string };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const tag = await prisma.tableTag.findFirstOrThrow({
    where: { table: { label: "B1", venue: { tenant: { slug: "bar-demo" } } } },
    include: { table: true },
  });
  tagCode = tag.code;
  venueId = tag.table.venueId;
  const login = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email: "mozo@bardemo.test", password: "demo1234" } });
  mozo = login.json().token;
});

afterAll(async () => {
  // No dejar mesas abiertas ni clientes de prueba en el bar demo
  const tag = await prisma.tableTag.findUniqueOrThrow({ where: { code: tagCode } });
  await prisma.order.updateMany({ where: { session: { tableId: tag.tableId }, status: "PENDING_APPROVAL" }, data: { status: "CANCELLED" } });
  await prisma.tableSession.updateMany({ where: { tableId: tag.tableId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  await prisma.customer.deleteMany({ where: { email: { endsWith: "@test.local" } } });
  for (const id of created) await purgeTenant(prisma, id);
  await app.close();
  await prisma.$disconnect();
});

describe("Mi cuenta: ingreso con código", () => {
  it("de pedir anónimo a guardar la visita en la cuenta", async () => {
    const email = `cliente-${randomUUID()}@test.local`;
    const { guest, sessionId } = await sitDown();
    const papas = await dishId("Papas bravas");
    const before = await order(guest, papas); // pide sin cuenta: nadie está obligado a registrarse

    expect((await requestCode(email.toUpperCase())).json().ok).toBe(true);
    const code = lastCode(email); // normalizado a minúsculas

    // Cuenta nueva: hace falta aceptar la política de privacidad
    const noConsent = await verify({ email, code });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().error).toBe("PRIVACY_REQUIRED");

    const wrong = await verify({ email, code: code === "000000" ? "111111" : "000000", acceptPrivacy: true });
    expect(wrong.json().error).toBe("CODE_INVALID");
    expect(wrong.json().message).toContain("4 intento");

    const ok = await verify({ email, code, name: "Ana", acceptPrivacy: true, guestToken: guest });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.isNew).toBe(true);
    expect(body.linkedVisit).toBe(true);
    const customer = body.token as string;

    // El código no se puede volver a usar
    expect((await verify({ email, code, acceptPrivacy: true })).json().error).toBe("CODE_INVALID");

    // El pedido anterior quedó vinculado y los siguientes de este celular también
    expect((await prisma.order.findUniqueOrThrow({ where: { id: before } })).customerId).toBe(body.customer.id);
    const after = await order(guest, papas);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: after } })).customerId).toBe(body.customer.id);

    const me = (await app.inject({ url: "/v1/customer/me", headers: auth(customer) })).json();
    expect(me.name).toBe("Ana");
    expect(me.stats.visits).toBe(1);
    expect(me.stats.spentCents).toBeGreaterThan(0);

    const history = (await app.inject({ url: "/v1/customer/me/history", headers: auth(customer) })).json();
    expect(history).toHaveLength(1);
    expect(history[0].sessionId).toBe(sessionId);
    expect(history[0].orders).toHaveLength(2);
    expect(history[0].tableLabel).toBe("B1");

    // Pedir lo mismo: ids actuales de la carta
    const re = (await app.inject({ url: `/v1/customer/me/orders/${after}/reorder`, headers: auth(customer) })).json();
    expect(re.items).toEqual([expect.objectContaining({ available: true, dishId: papas, quantity: 2 })]);

    // Un token de cliente no sirve como token de mesa, ni al revés
    expect((await app.inject({ url: "/v1/session", headers: auth(customer) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/v1/customer/me", headers: auth(guest) })).statusCode).toBe(403);

    // Segundo ingreso: no pide consentimiento de nuevo
    await prisma.customerLoginCode.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await requestCode(email);
    const again = await verify({ email, code: lastCode(email) });
    expect(again.statusCode).toBe(200);
    expect(again.json().isNew).toBe(false);
  });

  it("el código vence y se bloquea tras 5 intentos", async () => {
    const email = `vence-${randomUUID()}@test.local`;
    await requestCode(email);
    const code = lastCode(email);
    await prisma.customerLoginCode.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verify({ email, code, acceptPrivacy: true })).json().error).toBe("CODE_INVALID");

    await prisma.customerLoginCode.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await requestCode(email);
    const fresh = lastCode(email);
    const bad = fresh === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) await verify({ email, code: bad, acceptPrivacy: true });
    const locked = await verify({ email, code: fresh, acceptPrivacy: true });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe("CODE_LOCKED");
  });

  it("pedir códigos seguidos no manda un email por cada pedido", async () => {
    const email = `spam-${randomUUID()}@test.local`;
    for (let i = 0; i < 3; i++) expect((await requestCode(email)).json().ok).toBe(true);
    expect(devOutbox().filter((m) => m.to === email)).toHaveLength(1);
  });
});

describe("Mi cuenta: aislamiento y derechos del titular", () => {
  it("una cuenta por bar: el mismo email en otro bar es otra cuenta y no ve nada del primero", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/v1/onboarding/register",
      payload: { ownerName: "Dueño", email: `owner-${randomUUID()}@test.local`, password: "clave-segura-123", barName: "Bar Cuentas" },
    });
    created.push(reg.json().tenant.id);
    const otherVenue = reg.json().venue.id as string;

    const email = `doble-${randomUUID()}@test.local`;
    const { guest } = await sitDown();
    await order(guest, await dishId("Papas bravas"));
    await requestCode(email);
    const a = (await verify({ email, code: lastCode(email), acceptPrivacy: true, guestToken: guest })).json();

    await prisma.customerLoginCode.updateMany({ where: { email }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await requestCode(email, otherVenue);
    // El token de mesa del bar demo no se vincula a una cuenta de otro bar
    const b = await app.inject({
      method: "POST",
      url: "/v1/customer/auth/verify",
      payload: { venueId: otherVenue, email, code: lastCode(email), acceptPrivacy: true, guestToken: guest },
    });
    expect(b.json().isNew).toBe(true);
    expect(b.json().linkedVisit).toBe(false);
    expect(b.json().customer.id).not.toBe(a.customer.id);

    const hb = (await app.inject({ url: "/v1/customer/me/history", headers: auth(b.json().token) })).json();
    expect(hb).toHaveLength(0);
    const orderA = (await app.inject({ url: "/v1/customer/me/history", headers: auth(a.token) })).json()[0].orders[0].id;
    expect((await app.inject({ url: `/v1/customer/me/orders/${orderA}/reorder`, headers: auth(b.json().token) })).statusCode).toBe(404);
    const link = await app.inject({ method: "POST", url: "/v1/customer/link", headers: auth(b.json().token), payload: { guestToken: guest } });
    expect(link.json().linked).toBe(false);
  });

  it("exportar y borrar la cuenta (los pedidos quedan anónimos)", async () => {
    const email = `borrar-${randomUUID()}@test.local`;
    const { guest } = await sitDown();
    const id = await order(guest, await dishId("Papas bravas"));
    await requestCode(email);
    const token = (await verify({ email, code: lastCode(email), acceptPrivacy: true, guestToken: guest })).json().token;

    const exp = await app.inject({ url: "/v1/customer/me/export", headers: auth(token) });
    expect(exp.headers["content-disposition"]).toContain("attachment");
    expect(exp.json().email).toBe(email);
    expect(exp.json().orders).toHaveLength(1);

    expect((await app.inject({ method: "DELETE", url: "/v1/customer/me", headers: auth(token) })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/customer/me", headers: auth(token) })).statusCode).toBe(401);
    expect(await prisma.customer.count({ where: { email } })).toBe(0);
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(o.customerId).toBeNull();
  });
});
