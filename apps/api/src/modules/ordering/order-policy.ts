import type { Tx } from "../../shared/db/index.js";
import { HttpError } from "../../shared/errors.js";

/**
 * Reglas de negocio que frenan pedidos exagerados o repetidos sin querer.
 *
 * Patrón: Strategy + cadena de reglas. Cada regla es un objeto chico con una sola responsabilidad;
 * `assertOrderAllowed` las recorre en orden y la primera que no se cumple corta con un error claro.
 * Agregar una regla nueva = sumar un objeto a `ORDER_RULES`, sin tocar el caso de uso (abierto/cerrado).
 *
 * Las reglas leen la base DENTRO de la transacción del pedido, con la sesión bloqueada (FOR UPDATE):
 * dos celulares de la misma mesa que piden a la vez quedan en fila y el segundo ve el pedido del primero.
 */

/** Unidades máximas en un solo pedido (ej.: 40 empanadas es un pedido grande pero real; 600 no) */
export const MAX_UNITS_PER_ORDER = 40;
/** Pedidos esperando confirmación del mozo a la vez, por mesa */
export const MAX_PENDING_ORDERS = 3;
/** Unidades que una mesa puede pedir en una hora sin que intervenga el mozo */
export const MAX_UNITS_PER_HOUR = 120;
/** Un pedido idéntico dentro de esta ventana se considera repetido sin querer */
export const DUPLICATE_WINDOW_MS = 3 * 60 * 1000;

/** Lo mínimo de cada ítem que las reglas necesitan (ya validado y con precio del servidor) */
export type PolicyItem = { dishId: string; variantName?: string | null; modifiers: Array<{ name: string }>; quantity: number };

export type OrderContext = {
  tx: Tx;
  sessionId: string;
  items: PolicyItem[];
  confirmDuplicate: boolean;
  now: Date;
};

export type OrderRule = { name: string; check(ctx: OrderContext): Promise<void> | void };

const LIVE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "COMPLETED"] as const;

const unitsOf = (items: Array<{ quantity: number }>) => items.reduce((s, i) => s + i.quantity, 0);

/** Huella del contenido: mismo plato, opción, extras y cantidad, sin importar el orden de las líneas */
export function orderFingerprint(items: PolicyItem[]): string {
  return items
    .map((i) => [i.dishId, i.variantName ?? "", i.modifiers.map((m) => m.name).sort().join("+"), i.quantity].join("|"))
    .sort()
    .join("\n");
}

const orderSize: OrderRule = {
  name: "tamaño del pedido",
  check({ items }) {
    if (unitsOf(items) > MAX_UNITS_PER_ORDER) {
      throw new HttpError(
        422,
        "ORDER_TOO_LARGE",
        `Un pedido puede tener hasta ${MAX_UNITS_PER_ORDER} unidades. Para algo más grande, llamá al mozo.`,
      );
    }
  },
};

const pendingOrders: OrderRule = {
  name: "pedidos sin confirmar",
  async check({ tx, sessionId }) {
    const pending = await tx.order.count({ where: { sessionId, status: "PENDING_APPROVAL" } });
    if (pending >= MAX_PENDING_ORDERS) {
      throw new HttpError(
        429,
        "TOO_MANY_PENDING_ORDERS",
        `La mesa ya tiene ${pending} pedidos esperando al mozo. Esperá a que los confirme para pedir más.`,
      );
    }
  },
};

const hourlyVolume: OrderRule = {
  name: "volumen por hora",
  async check({ tx, sessionId, items, now }) {
    const since = new Date(now.getTime() - 60 * 60 * 1000);
    const recent = await tx.orderItem.aggregate({
      _sum: { quantity: true },
      where: { order: { sessionId, createdAt: { gte: since }, status: { in: [...LIVE_STATUSES] } } },
    });
    if ((recent._sum.quantity ?? 0) + unitsOf(items) > MAX_UNITS_PER_HOUR) {
      throw new HttpError(
        429,
        "SESSION_ORDER_LIMIT",
        "La mesa llegó al máximo de pedidos por hora desde la carta. Pedile al mozo lo que falta.",
      );
    }
  },
};

const duplicate: OrderRule = {
  name: "pedido repetido",
  async check({ tx, sessionId, items, confirmDuplicate, now }) {
    if (confirmDuplicate) return;
    const recent = await tx.order.findMany({
      where: {
        sessionId,
        createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) },
        status: { in: [...LIVE_STATUSES] },
      },
      select: { createdAt: true, items: { select: { dishId: true, variantName: true, modifiers: true, quantity: true } } },
      orderBy: { createdAt: "desc" },
    });
    const mine = orderFingerprint(items);
    const twin = recent.find((o) => orderFingerprint(o.items.map(toPolicyItem)) === mine);
    if (twin) {
      const minutes = Math.round((now.getTime() - twin.createdAt.getTime()) / 60000);
      const when = minutes < 1 ? "hace unos segundos" : `hace ${minutes} min`;
      throw new HttpError(409, "DUPLICATE_ORDER", `Alguien de la mesa pidió exactamente lo mismo ${when}. Si querés otro igual, confirmalo.`);
    }
  },
};

/** Orden: primero lo que no necesita la base, después lo más barato */
export const ORDER_RULES: OrderRule[] = [orderSize, pendingOrders, hourlyVolume, duplicate];

export async function assertOrderAllowed(ctx: OrderContext, rules: OrderRule[] = ORDER_RULES): Promise<void> {
  for (const rule of rules) await rule.check(ctx);
}

function toPolicyItem(i: { dishId: string; variantName: string | null; modifiers: unknown; quantity: number }): PolicyItem {
  const modifiers = Array.isArray(i.modifiers) ? (i.modifiers as Array<{ name: string }>) : [];
  return { dishId: i.dishId, variantName: i.variantName, modifiers, quantity: i.quantity };
}
