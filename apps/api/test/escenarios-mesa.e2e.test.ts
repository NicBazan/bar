// Escenarios con personas: una mesa de amigos un viernes a la noche, el mozo, el dueño y la caja.
// Cada paso es lo que haría una persona real con el celular o el panel, incluidos los errores
// sin querer (dos amigos que mandan lo mismo a la vez) y los abusos (el que pide 60 cosas).
import { randomUUID } from "node:crypto";
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MAX_PENDING_ORDERS, MAX_UNITS_PER_ORDER } from "../src/modules/ordering/order-policy.js";
import { RECEIPT_LEGEND, type Receipt } from "../src/modules/table-session/receipt.js";

let app: FastifyInstance;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const dishes: Record<"papas" | "provoleta" | "flan" | "ipa", string> = { papas: "", provoleta: "", flan: "", ipa: "" };
let pinta = "";
let mozo = "";
let duenio = "";
let caja = "";

type Item = { dishId: string; quantity: number; variantId?: string };

async function login(email: string) {
  const res = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email, password: "demo1234" } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

async function tableTag(label: string) {
  const tag = await prisma.tableTag.findFirstOrThrow({ where: { table: { label, venue: { tenant: { slug: "bar-demo" } } } } });
  await prisma.tableSession.updateMany({ where: { tableId: tag.tableId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  return tag.code;
}

/** Una persona escanea el QR con su celular (sin PIN = la primera; con PIN = se suma) */
const scan = (code: string, phone: string, pin?: string) =>
  app.inject({ method: "POST", url: `/v1/tags/${code}/session`, payload: { deviceKey: phone, ...(pin ? { pin } : {}) } });

const order = (guest: string, items: Item[], extra: { confirmDuplicate?: boolean } = {}) =>
  app.inject({ method: "POST", url: "/v1/orders", headers: { ...auth(guest), "idempotency-key": randomUUID() }, payload: { items, ...extra } });

const staffPost = (token: string, url: string, payload?: object) =>
  app.inject({ method: "POST", url, headers: auth(token), ...(payload ? { payload } : {}) });

/** Abre una mesa nueva con un comensal y el mozo; devuelve el token del comensal y la sesión */
async function seatTable(label: string, phone: string) {
  const res = await scan(await tableTag(label), phone);
  expect(res.statusCode, res.body).toBe(200);
  const session = res.json().session as { id: string; pin: string };
  expect((await staffPost(mozo, `/v1/staff/sessions/${session.id}/open`)).statusCode).toBe(200);
  return { guest: res.json().token as string, session };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "bar-demo" } });
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, plan: "PRO", currentPeriodEnd: new Date(Date.now() + 365 * 864e5) },
    update: { plan: "PRO" },
  });
  const byName = async (name: string) => (await prisma.dish.findFirstOrThrow({ where: { tenantId: tenant.id, name } })).id;
  dishes.papas = await byName("Papas bravas");
  dishes.provoleta = await byName("Provoleta");
  dishes.flan = await byName("Flan casero");
  dishes.ipa = await byName("Cerveza tirada IPA");
  pinta = (await prisma.dishVariant.findFirstOrThrow({ where: { dishId: dishes.ipa, name: "Pinta" } })).id;
  [mozo, duenio, caja] = await Promise.all([login("mozo@bardemo.test"), login("dueno@bardemo.test"), login("caja@bardemo.test")]);
});

afterAll(async () => {
  await app.close();
});

describe("Viernes a la noche en la Mesa 1: Lucía, Martín y Tomás", () => {
  let lucia = "";
  let martin = "";
  let tomas = "";
  let sessionId = "";
  const ronda: Item[] = [
    { dishId: "", quantity: 2, variantId: "" },
    { dishId: "", quantity: 1 },
  ];
  const orderIds: Record<string, string> = {};

  it("Lucía escanea el QR, el mozo abre la mesa y sus amigos se suman con el PIN", async () => {
    ronda[0] = { dishId: dishes.ipa, quantity: 2, variantId: pinta };
    ronda[1] = { dishId: dishes.papas, quantity: 1 };
    const seated = await seatTable("1", "celular-lucia");
    lucia = seated.guest;
    sessionId = seated.session.id;

    const code = await prisma.tableTag.findFirstOrThrow({ where: { table: { label: "1", venue: { tenant: { slug: "bar-demo" } } } } });
    const wrongPin = seated.session.pin === "0000" ? "1111" : "0000";
    expect((await scan(code.code, "celular-martin", wrongPin)).statusCode).toBe(403); // Martín se equivoca una vez
    const m = await scan(code.code, "celular-martin", seated.session.pin);
    const t = await scan(code.code, "celular-tomas", seated.session.pin);
    expect([m.statusCode, t.statusCode]).toEqual([200, 200]);
    martin = m.json().token;
    tomas = t.json().token;
  });

  it("Lucía y Martín mandan la misma ronda al mismo tiempo: entra una sola y al otro se le pregunta", async () => {
    const [a, b] = await Promise.all([order(lucia, ronda), order(martin, ronda)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);
    const rejected = a.statusCode === 409 ? a : b;
    expect(rejected.json().error).toBe("DUPLICATE_ORDER");
    expect(rejected.json().message).toMatch(/exactamente lo mismo/);
    orderIds.ronda1 = (a.statusCode === 201 ? a : b).json().id;
  });

  it("Martín confirma que quieren otra ronda igual y entra", async () => {
    const res = await order(martin, ronda, { confirmDuplicate: true });
    expect(res.statusCode).toBe(201);
    orderIds.ronda2 = res.json().id;
  });

  it("Tomás exagera: 100 de algo no pasa la validación y 60 unidades superan el tope por pedido", async () => {
    expect((await order(tomas, [{ dishId: dishes.papas, quantity: 100 }])).statusCode).toBe(400);
    const sesenta = [dishes.papas, dishes.provoleta, dishes.flan].map((dishId) => ({ dishId, quantity: 20 }));
    const res = await order(tomas, sesenta);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("ORDER_TOO_LARGE");
    expect(res.json().message).toContain(String(MAX_UNITS_PER_ORDER));
  });

  it(`con ${MAX_PENDING_ORDERS} pedidos esperando al mozo, la mesa tiene que esperar antes de mandar otro`, async () => {
    const flan = await order(tomas, [{ dishId: dishes.flan, quantity: 1 }]);
    expect(flan.statusCode).toBe(201);
    orderIds.flan = flan.json().id;
    const otra = await order(tomas, [{ dishId: dishes.provoleta, quantity: 1 }]);
    expect(otra.statusCode).toBe(429);
    expect(otra.json().error).toBe("TOO_MANY_PENDING_ORDERS");
  });

  it("el mozo y el dueño aprueban la misma ronda a la vez: a cocina va una sola vez", async () => {
    const [a, b] = await Promise.all([
      staffPost(mozo, `/v1/staff/orders/${orderIds.ronda1}/approve`),
      staffPost(duenio, `/v1/staff/orders/${orderIds.ronda1}/approve`),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const events = await prisma.outboxEvent.count({ where: { type: "order.approved", payload: { path: ["orderId"], equals: orderIds.ronda1 } } });
    expect(events).toBeGreaterThan(0);
    expect(await prisma.orderItem.count({ where: { orderId: orderIds.ronda1, status: "FIRED" } })).toBe(2);
  });

  it("el mozo aprueba la segunda ronda y rechaza el flan porque se terminó; ahora Tomás puede pedir", async () => {
    expect((await staffPost(mozo, `/v1/staff/orders/${orderIds.ronda2}/approve`)).statusCode).toBe(200);
    expect((await staffPost(mozo, `/v1/staff/orders/${orderIds.flan}/reject`, { reason: "Se terminó el flan" })).statusCode).toBe(200);
    expect((await order(tomas, [{ dishId: dishes.provoleta, quantity: 1 }])).statusCode).toBe(201); // queda sin confirmar
  });

  it("Lucía pide la cuenta y entiende qué se cobra y qué no", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/service-calls", headers: auth(lucia), payload: { type: "BILL" } })).statusCode).toBeLessThan(300);
    const r = (await app.inject({ url: "/v1/session/receipt", headers: auth(lucia) })).json() as Receipt;

    expect(r.kind).toBe("PROVISIONAL");
    expect(r.title).toBe("Cuenta provisoria");
    expect(r.number).toBeNull();
    expect(r.table).toBe("1");
    expect(r.venue.name).toBe("Bar Demo - Palermo");
    // Dos rondas iguales se leen como una línea: 4 pintas a $4.500 y 2 papas a $6.500
    expect(r.lines).toEqual([
      { quantity: 4, description: "Cerveza tirada IPA (Pinta)", unitCents: 450000, subtotalCents: 1800000 },
      { quantity: 2, description: "Papas bravas", unitCents: 650000, subtotalCents: 1300000 },
    ]);
    expect(r.totalCents).toBe(3100000);
    expect(r.units).toBe(6);
    expect(r.notBilled).toEqual([
      { quantity: 1, description: "Flan casero", reason: "Rechazado: Se terminó el flan" },
      { quantity: 1, description: "Provoleta", reason: "Sin confirmar por el mozo" },
    ]);
    expect(r.legend).toBe(RECEIPT_LEGEND);
  });

  it("el mozo cierra la mesa: el comprobante se numera, lo sin confirmar se anula y la caja lo ve igual", async () => {
    const res = await staffPost(mozo, `/v1/staff/sessions/${sessionId}/close`);
    expect(res.statusCode).toBe(200);
    const closed = res.json().receipt as Receipt;
    expect(closed.kind).toBe("FINAL");
    expect(closed.number).toBeGreaterThan(0);
    expect(closed.title).toBe(`Comprobante N.º ${String(closed.number).padStart(6, "0")}`);
    expect(closed.totalCents).toBe(3100000);
    expect(closed.notBilled.find((l) => l.description === "Provoleta")?.reason).toBe("Mesa cerrada sin confirmar");

    const enCaja = await app.inject({ url: `/v1/staff/sessions/${sessionId}/receipt`, headers: auth(caja) });
    expect(enCaja.json()).toEqual(closed);
    expect((await staffPost(mozo, `/v1/staff/sessions/${sessionId}/close`)).statusCode).toBe(409); // nadie la cierra dos veces
  });

  it("un mes después el comprobante dice lo mismo, aunque el local haya cambiado nombres y precios", async () => {
    const before = (await app.inject({ url: "/v1/session/receipt", headers: auth(lucia) })).json() as Receipt;
    await prisma.dish.update({ where: { id: dishes.papas }, data: { name: "Papas bravas XL", priceCents: 990000 } });
    try {
      const after = (await app.inject({ url: "/v1/session/receipt", headers: auth(lucia) })).json() as Receipt;
      expect(after).toEqual(before);
      expect(after.lines[1]?.description).toBe("Papas bravas");
    } finally {
      await prisma.dish.update({ where: { id: dishes.papas }, data: { name: "Papas bravas", priceCents: 650000 } });
    }
  });
});

describe("Hora pico: varias mesas cierran a la vez", () => {
  it("dos mesas cerradas al mismo tiempo reciben números distintos y seguidos", async () => {
    const m2 = await seatTable("2", "celular-ana");
    const m3 = await seatTable("3", "celular-bruno");
    const [a, b] = await Promise.all([
      staffPost(mozo, `/v1/staff/sessions/${m2.session.id}/close`),
      staffPost(duenio, `/v1/staff/sessions/${m3.session.id}/close`),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const numbers = [a.json().receipt.number, b.json().receipt.number].sort((x, y) => x - y);
    expect(numbers[1] - numbers[0]).toBe(1);
  });

  it("REGRESIÓN: un pedido que quedó pendiente en una mesa ya cerrada no se puede aprobar", async () => {
    // Datos viejos: mesas cerradas antes de que el cierre anulara lo pendiente (lo encontró la prueba en el navegador)
    const m3 = await seatTable("3", "celular-diego");
    const res = await order(m3.guest, [{ dishId: dishes.flan, quantity: 1 }]);
    expect(res.statusCode).toBe(201);
    await prisma.tableSession.update({ where: { id: m3.session.id }, data: { status: "CLOSED", closedAt: new Date() } });
    const approve = await staffPost(mozo, `/v1/staff/orders/${res.json().id}/approve`);
    expect(approve.statusCode).toBe(409);
    expect(approve.json().error).toBe("SESSION_CLOSED");
    expect(await prisma.orderItem.count({ where: { orderId: res.json().id, status: "FIRED" } })).toBe(0);
  });

  it("si el mozo y el dueño cierran la misma mesa a la vez, se cierra una sola vez con un solo número", async () => {
    const m2 = await seatTable("2", "celular-carla");
    const [a, b] = await Promise.all([
      staffPost(mozo, `/v1/staff/sessions/${m2.session.id}/close`),
      staffPost(duenio, `/v1/staff/sessions/${m2.session.id}/close`),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const s = await prisma.tableSession.findUniqueOrThrow({ where: { id: m2.session.id } });
    expect(s.receiptNumber).not.toBeNull();
  });
});
