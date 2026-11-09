// Avisos automáticos con personas: el dueño prende "Te extrañamos" y "Gracias por venir",
// y el motor decide a quién escribirle sin repetir, sin molestar y solo con consentimiento.
import { randomUUID } from "node:crypto";
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { localHour, runAutomations } from "../src/modules/automations/runner.js";

let app: FastifyInstance;
let owner = "";
let tenantId = "";
let venueId = "";
let tableId = "";
const DAY = 24 * 3600_000;
const now = new Date();
const people: Record<"ana" | "beto" | "caro" | "dani", string> = { ana: "", beto: "", caro: "", dani: "" };

async function customer(name: string, consent: boolean) {
  const c = await prisma.customer.create({
    data: { tenantId, email: `${name}-${randomUUID()}@test.com`, name, privacyAcceptedAt: now, marketingOptInAt: consent ? now : null },
  });
  return c.id;
}

/** Una visita cerrada en el pasado, con un pedido confirmado del cliente */
async function visit(customerId: string, closedAgoMs: number) {
  const at = new Date(now.getTime() - closedAgoMs);
  const s = await prisma.tableSession.create({ data: { tenantId, venueId, tableId, status: "CLOSED", joinPin: "1234", openedAt: at, closedAt: at } });
  await prisma.order.create({ data: { tenantId, venueId, sessionId: s.id, customerId, idempotencyKey: randomUUID(), status: "APPROVED", totalCents: 100000, createdAt: at } });
}

const deliveriesOf = (customerId: string) => prisma.automationDelivery.findMany({ where: { customerId }, include: { rule: { select: { kind: true } } } });

const putRule = (kind: string, payload: object) =>
  app.inject({ method: "PUT", url: `/v1/admin/automations/${kind}`, headers: { authorization: `Bearer ${owner}` }, payload });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const venue = await prisma.venue.findFirstOrThrow({ where: { tenant: { slug: "bar-demo" } } });
  tenantId = venue.tenantId;
  venueId = venue.id;
  tableId = (await prisma.diningTable.findFirstOrThrow({ where: { venueId, label: "6" } })).id;
  owner = (await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email: "dueno@bardemo.test", password: "demo1234" } })).json().token;

  people.ana = await customer("Ana", true); // no viene hace 35 días
  people.beto = await customer("Beto", false); // no viene hace 35 días, pero no aceptó avisos
  people.caro = await customer("Caro", true); // no viene hace 100 días: ya no tiene sentido escribirle
  people.dani = await customer("Dani", true); // vino ayer
  await visit(people.ana, 35 * DAY);
  await visit(people.beto, 35 * DAY);
  await visit(people.caro, 100 * DAY);
  await visit(people.dani, 20 * 3600_000);
});

afterAll(async () => {
  await prisma.automationRule.deleteMany({ where: { tenantId } });
  await app.close();
});

describe("avisos automáticos", () => {
  it("el dueño los ve apagados con un mensaje sugerido y los prende", async () => {
    const list = (await app.inject({ url: "/v1/admin/automations", headers: { authorization: `Bearer ${owner}` } })).json();
    expect(list.map((r: { kind: string; enabled: boolean }) => [r.kind, r.enabled])).toEqual([["WINBACK", false], ["THANK_YOU", false]]);
    expect((await putRule("WINBACK", { enabled: true, days: 30, title: "Te extrañamos", body: "Volvé esta semana: postre de regalo." })).statusCode).toBe(200);
    expect((await putRule("THANK_YOU", { enabled: true, title: "Gracias por venir", body: "¿Nos dejás tu opinión?" })).statusCode).toBe(200);
    expect((await putRule("WINBACK", { enabled: true, days: 3, title: "x", body: "y" })).statusCode).toBe(400); // mínimo 14 días
  });

  it("a Ana (35 días sin venir) le llega 'Te extrañamos'; a Beto no (sin permiso) y a Caro tampoco (hace demasiado)", async () => {
    await runAutomations(now, { ignoreQuietHours: true });
    expect((await deliveriesOf(people.ana)).map((d) => d.rule.kind)).toEqual(["WINBACK"]);
    expect(await deliveriesOf(people.beto)).toEqual([]);
    expect(await deliveriesOf(people.caro)).toEqual([]);
    const [ana] = await deliveriesOf(people.ana);
    expect(ana?.emailSent).toBe(true);
  });

  it("a Dani, que vino ayer, le llega 'Gracias por venir'", async () => {
    expect((await deliveriesOf(people.dani)).map((d) => d.rule.kind)).toEqual(["THANK_YOU"]);
  });

  it("si el motor corre otra vez (o dos veces a la vez) nadie recibe un aviso repetido", async () => {
    await Promise.all([runAutomations(now, { ignoreQuietHours: true }), runAutomations(now, { ignoreQuietHours: true })]);
    expect(await deliveriesOf(people.ana)).toHaveLength(1);
    expect(await deliveriesOf(people.dani)).toHaveLength(1);
  });

  it("como máximo 1 aviso por semana: Ana vino ayer también, pero ya recibió uno", async () => {
    await visit(people.ana, 20 * 3600_000);
    await runAutomations(now, { ignoreQuietHours: true });
    expect(await deliveriesOf(people.ana)).toHaveLength(1);
  });

  it("el aviso cuenta como 'funcionó' cuando el cliente vuelve a pedir", async () => {
    const later = new Date(now.getTime() + DAY);
    const s = await prisma.tableSession.create({ data: { tenantId, venueId, tableId, status: "CLOSED", joinPin: "1234", openedAt: later, closedAt: later } });
    await prisma.order.create({ data: { tenantId, venueId, sessionId: s.id, customerId: people.dani, idempotencyKey: randomUUID(), status: "APPROVED", totalCents: 1, createdAt: later } });
    await runAutomations(new Date(later.getTime() + 3600_000), { ignoreQuietHours: true });
    const [d] = await deliveriesOf(people.dani);
    expect(d?.returnedAt).not.toBeNull();
  });

  it("de noche no sale nada (fuera de 10 a 21, hora del local)", async () => {
    const tz = "America/Argentina/Buenos_Aires";
    const at3am = new Date(now);
    while (localHour(tz, at3am) !== 3) at3am.setTime(at3am.getTime() + 3600_000);
    const other = await customer("Eli", true);
    await visit(other, 35 * DAY + (at3am.getTime() - now.getTime()));
    expect((await runAutomations(at3am)).sent).toBe(0);
    expect(await deliveriesOf(other)).toEqual([]);
  });

  it("la ruta del cron no existe sin CRON_SECRET configurado", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/internal/automations/run" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/internal/automations/run", headers: { authorization: "Bearer cualquiera" } })).statusCode).toBe(404);
  });
});
