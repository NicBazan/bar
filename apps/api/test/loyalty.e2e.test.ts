// Fidelización: el bar elige sellos o puntos, la visita suma al cerrar la mesa y el mozo canjea.
// Usa el bar demo (mesa 4); guarda y restaura la configuración del programa.
import { randomUUID } from "node:crypto";
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { devOutbox } from "../src/shared/email/index.js";

let app: FastifyInstance;
let tagCode: string;
let venueId: string;
let tenantId: string;
let mozo: string;
let owner: string;
let papas: string;
let saved: unknown;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function staffLogin(email: string) {
  const res = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email, password: "demo1234" } });
  return res.json().token as string;
}

async function sitDown() {
  const tag = await prisma.tableTag.findUniqueOrThrow({ where: { code: tagCode } });
  await prisma.tableSession.updateMany({ where: { tableId: tag.tableId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  const join = (await app.inject({ method: "POST", url: `/v1/tags/${tagCode}/session`, payload: { deviceKey: `dev-${randomUUID()}` } })).json();
  await app.inject({ method: "POST", url: `/v1/staff/sessions/${join.session.id}/open`, headers: auth(mozo) });
  return { guest: join.token as string, sessionId: join.session.id as string };
}

async function order(guest: string, quantity = 1) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/orders",
    headers: { ...auth(guest), "idempotency-key": randomUUID() },
    payload: { items: [{ dishId: papas, quantity }] },
  });
  const o = res.json();
  await app.inject({ method: "POST", url: `/v1/staff/orders/${o.id}/approve`, headers: auth(mozo) });
  return o as { id: string; totalCents: number };
}

const close = (sessionId: string) => app.inject({ method: "POST", url: `/v1/staff/sessions/${sessionId}/close`, headers: auth(mozo) });

async function newCustomer(guest: string) {
  const email = `fiel-${randomUUID()}@test.local`;
  await app.inject({ method: "POST", url: "/v1/customer/auth/request-code", payload: { venueId, email } });
  const code = [...devOutbox()].reverse().find((m) => m.to === email)!.text.match(/\b(\d{6})\b/)![1];
  const res = await app.inject({ method: "POST", url: "/v1/customer/auth/verify", payload: { venueId, email, code, acceptPrivacy: true, guestToken: guest } });
  return res.json() as { token: string; customer: { id: string } };
}

const card = async (token: string) => (await app.inject({ url: "/v1/customer/me/loyalty", headers: auth(token) })).json();

const setProgram = (body: Record<string, unknown>, token = owner) => app.inject({ method: "PUT", url: "/v1/admin/loyalty", headers: auth(token), payload: body });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const tag = await prisma.tableTag.findFirstOrThrow({
    where: { table: { label: "4", venue: { tenant: { slug: "bar-demo" } } } },
    include: { table: true },
  });
  tagCode = tag.code;
  venueId = tag.table.venueId;
  tenantId = tag.tenantId;
  mozo = await staffLogin("mozo@bardemo.test");
  owner = await staffLogin("dueno@bardemo.test");
  saved = (await app.inject({ url: "/v1/admin/loyalty", headers: auth(owner) })).json();
  const menu = (await app.inject({ url: `/v1/venues/${venueId}/menu` })).json();
  papas = menu.categories.flatMap((c: { dishes: Array<{ id: string; name: string }> }) => c.dishes).find((d: { name: string }) => d.name === "Papas bravas").id;
});

afterAll(async () => {
  // No dejar mesas abiertas ni clientes de prueba en el bar demo
  const tag = await prisma.tableTag.findUniqueOrThrow({ where: { code: tagCode } });
  await prisma.order.updateMany({ where: { session: { tableId: tag.tableId }, status: "PENDING_APPROVAL" }, data: { status: "CANCELLED" } });
  await prisma.tableSession.updateMany({ where: { tableId: tag.tableId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  await prisma.customer.deleteMany({ where: { email: { endsWith: "@test.local" } } });
  const s = saved as { active: boolean; mode: string; centsPerPoint: number; rewards: Array<{ name: string; cost: number; active: boolean }> };
  await prisma.loyaltyReward.deleteMany({ where: { tenantId } });
  await setProgram({ active: s.active, mode: s.mode, centsPerPoint: s.centsPerPoint, rewards: s.rewards.map(({ name, cost, active }) => ({ name, cost, active })) });
  await app.close();
  await prisma.$disconnect();
});

describe("fidelización", () => {
  it("solo el dueño configura, y un programa activo necesita un premio", async () => {
    expect((await setProgram({ active: true, mode: "STAMPS", centsPerPoint: 100000, rewards: [] }, mozo)).statusCode).toBe(403);
    const empty = await setProgram({ active: true, mode: "STAMPS", centsPerPoint: 100000, rewards: [] });
    expect(empty.json().error).toBe("REWARD_REQUIRED");
    const ok = await setProgram({ active: true, mode: "STAMPS", centsPerPoint: 100000, rewards: [{ name: "Café gratis", cost: 2, active: true }] });
    expect(ok.statusCode).toBe(200);
    const cfg = (await app.inject({ url: "/v1/admin/loyalty", headers: auth(owner) })).json();
    expect(cfg.rewards).toEqual([expect.objectContaining({ name: "Café gratis", cost: 2 })]);
  });

  it("sellos: un sello por visita al cerrar la mesa, canje desde el mozo sin saldo doble", async () => {
    // Visita 1
    const v1 = await sitDown();
    await order(v1.guest);
    const c = await newCustomer(v1.guest);
    expect((await card(c.token)).balance).toBe(0); // todavía no cerró
    await close(v1.sessionId);
    expect((await card(c.token)).balance).toBe(1);
    // Volver a vincular la misma visita no suma de nuevo
    await app.inject({ method: "POST", url: "/v1/customer/link", headers: auth(c.token), payload: { guestToken: v1.guest } });
    expect((await card(c.token)).balance).toBe(1);

    // Visita 2: el mozo ve al cliente pero no le alcanza
    const v2 = await sitDown();
    await app.inject({ method: "POST", url: "/v1/customer/link", headers: auth(c.token), payload: { guestToken: v2.guest } });
    await order(v2.guest);
    const list = (await app.inject({ url: `/v1/staff/sessions/${v2.sessionId}/customers`, headers: auth(mozo) })).json();
    expect(list).toHaveLength(1);
    expect(list[0].email).toMatch(/^f•••@test\.local$/);
    const reward = list[0].loyalty.rewards[0];
    expect(reward.canRedeem).toBe(false);
    const early = await app.inject({ method: "POST", url: "/v1/staff/loyalty/redeem", headers: auth(mozo), payload: { sessionId: v2.sessionId, customerId: c.customer.id, rewardId: reward.id } });
    expect(early.json().error).toBe("INSUFFICIENT_BALANCE");
    await close(v2.sessionId);
    expect((await card(c.token)).balance).toBe(2);

    // Visita 3: dos canjes simultáneos, solo uno pasa
    const v3 = await sitDown();
    await app.inject({ method: "POST", url: "/v1/customer/link", headers: auth(c.token), payload: { guestToken: v3.guest } });
    const redeem = () =>
      app.inject({ method: "POST", url: "/v1/staff/loyalty/redeem", headers: auth(mozo), payload: { sessionId: v3.sessionId, customerId: c.customer.id, rewardId: reward.id } });
    const results = await Promise.all([redeem(), redeem()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const after = await card(c.token);
    expect(after.balance).toBe(0);
    expect(after.events.some((e: { kind: string; rewardName: string }) => e.kind === "REDEEM" && e.rewardName === "Café gratis")).toBe(true);
    await close(v3.sessionId);
  });

  it("el mozo no puede canjear a un cliente que no está en esa mesa", async () => {
    const v1 = await sitDown();
    const c = await newCustomer(v1.guest);
    await close(v1.sessionId);
    const v2 = await sitDown();
    const reward = (await card(c.token)).rewards[0];
    const res = await app.inject({ method: "POST", url: "/v1/staff/loyalty/redeem", headers: auth(mozo), payload: { sessionId: v2.sessionId, customerId: c.customer.id, rewardId: reward.id } });
    expect(res.statusCode).toBe(404);
    await close(v2.sessionId);
  });

  it("puntos por gasto: 1 punto cada $X y los sellos viejos no cuentan", async () => {
    await setProgram({ active: true, mode: "POINTS", centsPerPoint: 100000, rewards: [{ name: "Postre", cost: 50, active: true }] });
    const v = await sitDown();
    const o = await order(v.guest, 3);
    const c = await newCustomer(v.guest);
    await close(v.sessionId);
    const lc = await card(c.token);
    expect(lc.mode).toBe("POINTS");
    expect(lc.balance).toBe(Math.floor(o.totalCents / 100000));
    expect(lc.next).toEqual(expect.objectContaining({ name: "Postre", remaining: 50 - lc.balance }));
  });

  it("con el programa apagado no suma ni muestra tarjeta", async () => {
    await setProgram({ active: false, mode: "STAMPS", centsPerPoint: 100000, rewards: [] });
    const v = await sitDown();
    await order(v.guest);
    const c = await newCustomer(v.guest);
    await close(v.sessionId);
    expect((await card(c.token)).active).toBe(false);
    expect(await prisma.loyaltyEvent.count({ where: { customerId: c.customer.id } })).toBe(0);
  });
});
