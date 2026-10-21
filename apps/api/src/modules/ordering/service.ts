import type { CreateOrderBody } from "@bar/shared-types";
import type { GuestClaims } from "../../shared/auth/tokens.js";
import { Prisma, prisma } from "../../shared/db/index.js";
import { HttpError, conflict } from "../../shared/errors.js";
import { channels, emit } from "../../shared/outbox/outbox.js";

/**
 * Crea un pedido desde la mesa. Idempotente por (sesión, Idempotency-Key):
 * si el celular reintenta por mala red, devuelve el mismo pedido.
 * Precios, nombres y estación se calculan en el servidor y quedan como snapshot.
 */
export async function createOrder(guest: GuestClaims, idempotencyKey: string, body: CreateOrderBody) {
  const existing = await findByKey(guest.sid, idempotencyKey);
  if (existing) return { order: existing, replayed: true };

  const session = await prisma.tableSession.findFirst({
    where: { id: guest.sid, tenantId: guest.tid },
    include: { table: { select: { label: true } } },
  });
  if (!session) throw new HttpError(404, "NOT_FOUND");
  if (session.status !== "OPEN") throw conflict("SESSION_NOT_OPEN", "El mozo todavía no abrió la mesa");

  const dishIds = [...new Set(body.items.map((i) => i.dishId))];
  const [dishes, venueMenu, stations, device] = await Promise.all([
    prisma.dish.findMany({
      where: {
        id: { in: dishIds },
        tenantId: guest.tid,
        active: true,
        category: { menu: { venueMenus: { some: { venueId: guest.vid, active: true } } } },
      },
      include: { category: true, variants: true, modifierGroups: { include: { modifiers: true } } },
    }),
    prisma.venueMenu.findFirst({ where: { venueId: guest.vid, active: true }, include: { overrides: true } }),
    prisma.kitchenStation.findMany({ where: { venueId: guest.vid } }),
    // Si el cliente se identificó desde este celular ("Mi cuenta"), el pedido queda en su historial
    prisma.guestDevice.findUnique({ where: { id: guest.did }, select: { customerId: true } }),
  ]);
  const dishMap = new Map(dishes.map((d) => [d.id, d]));
  const overrides = new Map((venueMenu?.overrides ?? []).map((o) => [o.dishId, o]));
  const stationByKey = new Map(stations.map((s) => [s.key, s.id]));

  const items = body.items.map((input) => {
    const dish = dishMap.get(input.dishId);
    const override = overrides.get(input.dishId);
    if (!dish || override?.hidden) throw conflict("DISH_NOT_FOUND", `Plato ${input.dishId} no existe en esta carta`);
    if (override && !override.available) throw conflict("DISH_UNAVAILABLE", `${dish.name} está agotado`);

    let unitPrice = override?.priceCents ?? dish.priceCents;
    let variantName: string | undefined;
    if (dish.variants.length > 0) {
      const variant = dish.variants.find((v) => v.id === input.variantId);
      if (!variant) throw conflict("VARIANT_REQUIRED", `Elegí una opción para ${dish.name}`);
      unitPrice = variant.priceCents;
      variantName = variant.name;
    } else if (input.variantId) {
      throw conflict("VARIANT_INVALID");
    }

    const chosen: Array<{ name: string; priceCents: number }> = [];
    const selected = new Set(input.modifierIds);
    for (const group of dish.modifierGroups) {
      const picked = group.modifiers.filter((m) => selected.has(m.id));
      if (picked.length < group.minSelect || picked.length > group.maxSelect) {
        throw conflict(
          "MODIFIERS_INVALID",
          `"${group.name}" de ${dish.name}: elegí entre ${group.minSelect} y ${group.maxSelect}`,
        );
      }
      for (const m of picked) {
        chosen.push({ name: m.name, priceCents: m.priceCents });
        selected.delete(m.id);
      }
    }
    if (selected.size > 0) throw conflict("MODIFIERS_INVALID", "Modificador que no corresponde al plato");

    const stationKey = dish.stationKey ?? dish.category.stationKey;
    return {
      tenantId: guest.tid,
      dishId: dish.id,
      stationId: stationKey ? (stationByKey.get(stationKey) ?? null) : null,
      nameSnapshot: dish.name,
      variantName,
      modifiers: chosen,
      unitPriceCents: unitPrice + chosen.reduce((s, m) => s + m.priceCents, 0),
      quantity: input.quantity,
      note: input.note,
    };
  });

  const totalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  try {
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId: guest.tid,
          venueId: guest.vid,
          sessionId: guest.sid,
          deviceId: guest.did,
          customerId: device?.customerId ?? null,
          idempotencyKey,
          note: body.note,
          totalCents,
          items: { create: items },
        },
        include: { items: true },
      });
      await emit(tx, {
        tenantId: guest.tid,
        venueId: guest.vid,
        type: "order.submitted",
        channels: [channels.staff(guest.vid), channels.session(guest.sid)],
        payload: { orderId: created.id, tableLabel: session.table.label, totalCents, itemCount: items.length },
      });
      return created;
    });
    return { order, replayed: false };
  } catch (e) {
    // Dos reintentos simultáneos con la misma key: gana uno, el otro devuelve el mismo pedido
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await findByKey(guest.sid, idempotencyKey);
      if (again) return { order: again, replayed: true };
    }
    throw e;
  }
}

function findByKey(sessionId: string, idempotencyKey: string) {
  return prisma.order.findUnique({
    where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } },
    include: { items: true },
  });
}
