// Regresiones de la revisión del commit 3141814: PIN del dispositivo que vuelve, NFC SUN y CORS.
import { randomUUID } from "node:crypto";
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// Mensaje SUN de ejemplo (NXP, clave de fábrica): uid 041E3C8A2D6B80, contador 6
const NFC = { uid: "041E3C8A2D6B80", ctr: "000006", cmac: "4B00064004B0B3D3" };

let app: FastifyInstance;
let nfcTag: { code: string; tableId: string };
let otherTag: { code: string; tableId: string };

async function freeTable(tableId: string) {
  await prisma.tableSession.updateMany({
    where: { tableId, status: { not: "CLOSED" } },
    data: { status: "CLOSED", closedAt: new Date() },
  });
}

async function tagOf(label: string) {
  return prisma.tableTag.findFirstOrThrow({
    where: { table: { label, venue: { tenant: { slug: "bar-demo" } } } },
  });
}

const join = (code: string, deviceKey: string, extra: { pin?: string; query?: string } = {}) =>
  app.inject({
    method: "POST",
    url: `/v1/tags/${code}/session${extra.query ?? ""}`,
    payload: { deviceKey, ...(extra.pin ? { pin: extra.pin } : {}) },
  });

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "bar-demo" } });
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: { tenantId: tenant.id, plan: "PRO", currentPeriodEnd: new Date(Date.now() + 365 * 864e5) },
    update: { plan: "PRO" },
  });
  nfcTag = await tagOf("6");
  otherTag = await tagOf("5");
  await prisma.tableTag.updateMany({ where: { nfcUid: NFC.uid }, data: { nfcUid: null } });
  await prisma.tableTag.update({ where: { code: nfcTag.code }, data: { nfcUid: NFC.uid, type: "NFC_SUN" } });
});

beforeEach(async () => {
  await prisma.tableTag.update({ where: { code: nfcTag.code }, data: { sunCounter: 0 } });
  await freeTable(nfcTag.tableId);
  await freeTable(otherTag.tableId);
});

afterAll(async () => {
  await freeTable(nfcTag.tableId);
  await freeTable(otherTag.tableId);
  await prisma.tableTag.update({ where: { code: nfcTag.code }, data: { nfcUid: null, type: "QR", sunCounter: 0 } });
  await app.close();
  await prisma.$disconnect();
});

describe("PIN", () => {
  it("el dispositivo que abrió la mesa vuelve a entrar sin PIN; uno nuevo lo necesita", async () => {
    const device = `dev-${randomUUID()}`;
    const first = await join(otherTag.code, device);
    expect(first.statusCode).toBe(200);

    // Recarga / token vencido: el mismo celular no debe quedar bloqueado
    const again = await join(otherTag.code, device);
    expect(again.statusCode).toBe(200);
    expect(again.json().session.id).toBe(first.json().session.id);

    const stranger = await join(otherTag.code, `dev-${randomUUID()}`);
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().error).toBe("PIN_REQUIRED");
  });
});

describe("Cuota del plan", () => {
  it("escanear el QR no consume cuota; abrir la mesa sí", async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: "bar-demo" } });
    const used = async () =>
      (await prisma.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).tableSessionsThisMonth;
    const before = await used();

    const scan = await join(otherTag.code, `dev-${randomUUID()}`);
    expect(scan.json().session.status).toBe("PENDING");
    expect(await used()).toBe(before);

    const login = await app.inject({
      method: "POST",
      url: "/v1/staff/login",
      payload: { email: "mozo@bardemo.test", password: "demo1234" },
    });
    const open = await app.inject({
      method: "POST",
      url: `/v1/staff/sessions/${scan.json().session.id}/open`,
      headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(open.statusCode).toBe(200);
    expect(await used()).toBe(before + 1);
  });
});

describe("NFC SUN", () => {
  const q = `?uid=${NFC.uid}&ctr=${NFC.ctr}&cmac=${NFC.cmac}`;

  it("un toque válido abre la mesa directo, con presencia física", async () => {
    const res = await join(nfcTag.code, `dev-${randomUUID()}`, { query: q });
    expect(res.statusCode).toBe(200);
    expect(res.json().physicalPresence).toBe(true);
    expect(res.json().session.status).toBe("OPEN");
  });

  it("reusar la misma URL (replay) se rechaza, aunque lleguen dos a la vez", async () => {
    const [a, b] = await Promise.all([
      join(nfcTag.code, `dev-${randomUUID()}`, { query: q }),
      join(nfcTag.code, `dev-${randomUUID()}`, { query: q }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 403]);
    const rejected = a.statusCode === 403 ? a : b;
    expect(rejected.json().error).toBe("REPLAY_ATTACK_DETECTED");

    const later = await join(nfcTag.code, `dev-${randomUUID()}`, { query: q });
    expect(later.json().error).toBe("REPLAY_ATTACK_DETECTED");
  });

  it("una firma válida de otro chip no abre esta mesa", async () => {
    const res = await join(otherTag.code, `dev-${randomUUID()}`, { query: q });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INVALID_NFC_SIGNATURE");
  });

  it("CMAC alterado se rechaza", async () => {
    const bad = `?uid=${NFC.uid}&ctr=${NFC.ctr}&cmac=4B00064004B0B3D4`;
    const res = await join(nfcTag.code, `dev-${randomUUID()}`, { query: bad });
    expect(res.json().error).toBe("INVALID_NFC_SIGNATURE");
  });
});

describe("CORS", () => {
  const preflight = (origin: string) =>
    app.inject({
      method: "OPTIONS",
      url: "/v1/orders",
      headers: { origin, "access-control-request-method": "POST" },
    });

  it("acepta los front configurados y la red local en desarrollo", async () => {
    expect((await preflight("http://localhost:3000")).headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect((await preflight("http://192.168.100.25:3000")).headers["access-control-allow-origin"]).toBe("http://192.168.100.25:3000");
  });

  it("no refleja orígenes desconocidos (no se puede usar la sesión desde otro sitio)", async () => {
    expect((await preflight("https://sitio-malicioso.com")).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await preflight("http://192.168.1.10:8080")).headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Rate limit sin depender de la IP", () => {
  it("cambiar X-Forwarded-For no da más intentos de login contra la misma cuenta", async () => {
    const email = `nadie-${randomUUID()}@test.local`;
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/staff/login",
        headers: { "x-forwarded-for": `10.0.0.${i}` },
        payload: { email, password: "incorrecta" },
      });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("la API ignora X-Forwarded-For si no hay TRUST_PROXY", async () => {
    const probe = await buildApp({ logger: false });
    probe.get("/__ip", async (req) => ({ ip: req.ip }));
    const res = await probe.inject({ url: "/__ip", headers: { "x-forwarded-for": "6.6.6.6" } });
    expect(res.json().ip).not.toBe("6.6.6.6");
    await probe.close();
  });
});
