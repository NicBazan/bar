import type { OrderItemInput } from "@bar/shared-types";
import type { GuestClaims } from "../../shared/auth/tokens.js";
import { prisma } from "../../shared/db/index.js";
import { conflict } from "../../shared/errors.js";

/**
 * Precio de cada ítem del pedido, calculado SOLO en el servidor (el cliente nunca manda precios).
 *
 * GRASP Information Expert: `OrderCatalog` tiene los platos, ajustes del local y estaciones,
 * así que es quien sabe validar y valuar un ítem. Funciones puras sobre ese catálogo: fáciles de probar.
 */

type CatalogDish = Awaited<ReturnType<typeof loadDishes>>[number];
type Override = { dishId: string; hidden: boolean; available: boolean; priceCents: number | null };

export type OrderCatalog = {
  dishes: Map<string, CatalogDish>;
  overrides: Map<string, Override>;
  stationByKey: Map<string, string>;
};

export type PricedItem = {
  tenantId: string;
  dishId: string;
  stationId: string | null;
  nameSnapshot: string;
  variantName: string | undefined;
  modifiers: Array<{ name: string; priceCents: number }>;
  unitPriceCents: number;
  quantity: number;
  note: string | undefined;
};

function loadDishes(guest: GuestClaims, dishIds: string[]) {
  return prisma.dish.findMany({
    where: {
      id: { in: dishIds },
      tenantId: guest.tid,
      active: true,
      category: { menu: { venueMenus: { some: { venueId: guest.vid, active: true } } } },
    },
    include: { category: true, variants: true, modifierGroups: { include: { modifiers: true } } },
  });
}

/** Carga solo los platos del pedido, los ajustes de la sucursal y sus estaciones de cocina */
export async function loadOrderCatalog(guest: GuestClaims, items: OrderItemInput[]): Promise<OrderCatalog> {
  const dishIds = [...new Set(items.map((i) => i.dishId))];
  const [dishes, venueMenu, stations] = await Promise.all([
    loadDishes(guest, dishIds),
    prisma.venueMenu.findFirst({ where: { venueId: guest.vid, active: true }, include: { overrides: true } }),
    prisma.kitchenStation.findMany({ where: { venueId: guest.vid } }),
  ]);
  return {
    dishes: new Map(dishes.map((d) => [d.id, d])),
    overrides: new Map((venueMenu?.overrides ?? []).map((o) => [o.dishId, o])),
    stationByKey: new Map(stations.map((s) => [s.key, s.id])),
  };
}

export function priceItems(tenantId: string, inputs: OrderItemInput[], catalog: OrderCatalog): PricedItem[] {
  return inputs.map((input) => priceItem(tenantId, input, catalog));
}

export const orderTotal = (items: PricedItem[]) => items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

function priceItem(tenantId: string, input: OrderItemInput, catalog: OrderCatalog): PricedItem {
  const dish = availableDish(input.dishId, catalog);
  const override = catalog.overrides.get(dish.id);
  const base = chooseVariant(dish, input.variantId, override?.priceCents ?? dish.priceCents);
  const modifiers = chooseModifiers(dish, input.modifierIds);
  const stationKey = dish.stationKey ?? dish.category.stationKey;
  return {
    tenantId,
    dishId: dish.id,
    stationId: stationKey ? (catalog.stationByKey.get(stationKey) ?? null) : null,
    nameSnapshot: dish.name,
    variantName: base.variantName,
    modifiers,
    unitPriceCents: base.priceCents + modifiers.reduce((s, m) => s + m.priceCents, 0),
    quantity: input.quantity,
    note: input.note,
  };
}

function availableDish(dishId: string, catalog: OrderCatalog): CatalogDish {
  const dish = catalog.dishes.get(dishId);
  const override = catalog.overrides.get(dishId);
  if (!dish || override?.hidden) throw conflict("DISH_NOT_FOUND", `Plato ${dishId} no existe en esta carta`);
  if (override && !override.available) throw conflict("DISH_UNAVAILABLE", `${dish.name} está agotado`);
  return dish;
}

function chooseVariant(dish: CatalogDish, variantId: string | undefined, basePrice: number) {
  if (dish.variants.length === 0) {
    if (variantId) throw conflict("VARIANT_INVALID");
    return { priceCents: basePrice, variantName: undefined };
  }
  const variant = dish.variants.find((v) => v.id === variantId);
  if (!variant) throw conflict("VARIANT_REQUIRED", `Elegí una opción para ${dish.name}`);
  return { priceCents: variant.priceCents, variantName: variant.name };
}

function chooseModifiers(dish: CatalogDish, modifierIds: string[]) {
  const pending = new Set(modifierIds);
  const chosen: Array<{ name: string; priceCents: number }> = [];
  for (const group of dish.modifierGroups) {
    const picked = group.modifiers.filter((m) => pending.has(m.id));
    if (picked.length < group.minSelect || picked.length > group.maxSelect) {
      throw conflict("MODIFIERS_INVALID", `"${group.name}" de ${dish.name}: elegí entre ${group.minSelect} y ${group.maxSelect}`);
    }
    for (const m of picked) {
      chosen.push({ name: m.name, priceCents: m.priceCents });
      pending.delete(m.id);
    }
  }
  if (pending.size > 0) throw conflict("MODIFIERS_INVALID", "Modificador que no corresponde al plato");
  return chosen;
}
