// Flujo completo sobre la base de desarrollo (requiere `pnpm infra:up` + `pnpm db:seed`).
// Escanear QR → mozo abre la mesa → pedido → aprobación → KDS → servido → llamados → cierre.
import { randomUUID } from "node:crypto";
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
let tagCode: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function login(email: string) {
  const res = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email, password: "demo1234" } });
  expect(res.statusCode).toBe(200);
  return res.json().token as string;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  const tag = await prisma.tableTag.findFirstOrThrow({
    where: { table: { label: "B2", venue: { tenant: { slug: "bar-demo" } } } },
  });
  tagCode = tag.code;
  // Deja la mesa libre por si quedó una sesión de una corrida anterior
  await prisma.tableSession.updateMany({
    where: { tableId: tag.tableId, status: { not: "CLOSED" } },
    data: { status: "CLOSED", closedAt: new Date() },
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("flujo de mesa", () => {
  it("de escanear el QR a servir el plato", async () => {
    // 1. Resolver tag y leer la carta pública
    const tagRes = await app.inject({ url: `/v1/tags/${tagCode}` });
    expect(tagRes.statusCode).toBe(200);
    const venueId = tagRes.json().venue.id as string;

    const menuRes = await app.inject({ url: `/v1/venues/${venueId}/menu` });
    expect(menuRes.statusCode).toBe(200);
    const dishes = menuRes.json().categories.flatMap((c: { dishes: unknown[] }) => c.dishes) as Array<{
      id: string;
      name: string;
      priceCents: number;
      variants: Array<{ id: string; name: string; priceCents: number }>;
      modifierGroups: Array<{ modifiers: Array<{ id: string; name: string }> }>;
    }>;
    const bife = dishes.find((d) => d.name === "Bife de chorizo")!;
    const birra = dishes.find((d) => d.name === "Cerveza tirada IPA")!;
    const papas = dishes.find((d) => d.name === "Papas bravas")!;

    // 2. Primer celular: crea la sesión en PENDING y recibe el PIN
    const deviceA = `dev-a-${randomUUID()}`;
    const joinA = await app.inject({ method: "POST", url: `/v1/tags/${tagCode}/session`, payload: { deviceKey: deviceA } });
    expect(joinA.statusCode).toBe(200);
    const { token: guestA, session } = joinA.json();
    expect(session.status).toBe("PENDING");
    expect(session.pin).toMatch(/^\d{4}$/);

    // 3. Sin la mesa abierta no se puede pedir
    const early = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...auth(guestA), "idempotency-key": randomUUID() },
      payload: { items: [{ dishId: papas.id, quantity: 1 }] },
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe("SESSION_NOT_OPEN");

    // 4. El mozo abre la mesa
    const mozo = await login("mozo@bardemo.test");
    const pending = await app.inject({ url: "/v1/staff/sessions", headers: auth(mozo) });
    expect(pending.json().some((s: { id: string }) => s.id === session.id)).toBe(true);
    const open = await app.inject({ method: "POST", url: `/v1/staff/sessions/${session.id}/open`, headers: auth(mozo) });
    expect(open.statusCode).toBe(200);

    // 5. Segundo celular: sin PIN no entra, con PIN sí
    const deviceB = `dev-b-${randomUUID()}`;
    const noPin = await app.inject({ method: "POST", url: `/v1/tags/${tagCode}/session`, payload: { deviceKey: deviceB } });
    expect(noPin.statusCode).toBe(403);
    const withPin = await app.inject({
      method: "POST",
      url: `/v1/tags/${tagCode}/session`,
      payload: { deviceKey: deviceB, pin: session.pin },
    });
    expect(withPin.statusCode).toBe(200);
    expect(withPin.json().session.id).toBe(session.id);

    // 6. Validaciones del pedido: falta la variante y el punto de cocción
    const bad = await app.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { ...auth(guestA), "idempotency-key": randomUUID() },
      payload: { items: [{ dishId: birra.id, quantity: 1 }] },
    });
    expect(bad.json().error).toBe("VARIANT_REQUIRED");

    // 7. Pedido válido + reintento con la misma key (idempotencia)
    const key = randomUUID();
    const jugoso = bife.modifierGroups[0]!.modifiers.find((m) => m.name === "Jugoso")!;
    const pinta = birra.variants.find((v) => v.name === "Pinta")!;
    const payload = {
      items: [
        { dishId: bife.id, quantity: 1, modifierIds: [jugoso.id] },
        { dishId: birra.id, variantId: pinta.id, quantity: 2 },
      ],
    };
    const order = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...auth(guestA), "idempotency-key": key }, payload });
    expect(order.statusCode).toBe(201);
    const orderBody = order.json();
    expect(orderBody.totalCents).toBe(bife.priceCents + pinta.priceCents * 2);
    expect(orderBody.status).toBe("PENDING_APPROVAL");

    const replay = await app.inject({ method: "POST", url: "/v1/orders", headers: { ...auth(guestA), "idempotency-key": key }, payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(orderBody.id);

    // 8. El mozo aprueba → los ítems van a cocina
    const approve = await app.inject({ method: "POST", url: `/v1/staff/orders/${orderBody.id}/approve`, headers: auth(mozo) });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().items.every((i: { status: string }) => i.status === "FIRED")).toBe(true);

    // 9. Cocina: el mozo no puede marcar "en preparación"; cocina sí
    const cocina = await login("cocina@bardemo.test");
    const kds = await app.inject({ url: "/v1/staff/kitchen/items?station=parrilla", headers: auth(cocina) });
    const bifeItem = kds.json().find((i: { orderId: string }) => i.orderId === orderBody.id);
    expect(bifeItem.nameSnapshot).toBe("Bife de chorizo");

    const wrongRole = await app.inject({
      method: "PATCH",
      url: `/v1/staff/order-items/${bifeItem.id}/status`,
      headers: auth(mozo),
      payload: { status: "IN_PROGRESS" },
    });
    expect(wrongRole.statusCode).toBe(403);

    for (const item of orderBody.items as Array<{ id: string }>) {
      for (const status of ["IN_PROGRESS", "READY"]) {
        const r = await app.inject({
          method: "PATCH",
          url: `/v1/staff/order-items/${item.id}/status`,
          headers: auth(cocina),
          payload: { status },
        });
        expect(r.statusCode).toBe(200);
      }
      const served = await app.inject({
        method: "PATCH",
        url: `/v1/staff/order-items/${item.id}/status`,
        headers: auth(mozo),
        payload: { status: "SERVED" },
      });
      expect(served.statusCode).toBe(200);
    }

    // 10. El comensal ve todo por catch-up de eventos
    const state = await app.inject({ url: "/v1/state?since=0", headers: auth(guestA) });
    const types = state.json().events.map((e: { type: string }) => e.type);
    expect(types).toContain("session.opened");
    expect(types).toContain("order.approved");
    expect(types.filter((t: string) => t === "item.status_changed").length).toBe(6);

    const sessionState = await app.inject({ url: "/v1/session", headers: auth(guestA) });
    expect(sessionState.json().orders[0].status).toBe("COMPLETED");

    // 11. Llamar al mozo dos veces → el segundo se deduplica
    const call1 = await app.inject({ method: "POST", url: "/v1/service-calls", headers: auth(guestA), payload: { type: "WAITER" } });
    expect(call1.statusCode).toBe(201);
    const call2 = await app.inject({ method: "POST", url: "/v1/service-calls", headers: auth(withPin.json().token), payload: { type: "WAITER" } });
    expect(call2.statusCode).toBe(200);
    expect(call2.json().deduplicated).toBe(true);

    // Resuelto → cooldown
    await app.inject({ method: "POST", url: `/v1/staff/service-calls/${call1.json().call.id}/resolve`, headers: auth(mozo) });
    const call3 = await app.inject({ method: "POST", url: "/v1/service-calls", headers: auth(guestA), payload: { type: "WAITER" } });
    expect(call3.statusCode).toBe(429);

    // 12. Cerrar la mesa: el token del comensal ya no sirve para la sesión
    const close = await app.inject({ method: "POST", url: `/v1/staff/sessions/${session.id}/close`, headers: auth(mozo) });
    expect(close.statusCode).toBe(200);
    const after = await app.inject({ url: "/v1/session", headers: auth(guestA) });
    expect(after.statusCode).toBe(410);
  });

  it("aislamiento: el staff no ve pedidos de otro tenant", async () => {
    const mozo = await login("mozo@bardemo.test");
    const res = await app.inject({ method: "POST", url: `/v1/staff/orders/${randomUUID()}/approve`, headers: auth(mozo) });
    expect(res.statusCode).toBe(404);
  });

  it("rechaza tokens inválidos y tags inexistentes", async () => {
    expect((await app.inject({ url: "/v1/session", headers: auth("basura") })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/tags/NOEXISTE123" })).statusCode).toBe(404);
  });
});
