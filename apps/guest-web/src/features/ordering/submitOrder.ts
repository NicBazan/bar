import { ApiError, api } from "@/lib/api";
import { load, remove, save, uuid } from "@/lib/storage";

/**
 * Envío del carrito a la API, separado del componente (que solo maneja la pantalla).
 * - Idempotencia: si se corta la red y el comensal reintenta el MISMO pedido, se reusa la key
 *   y la API devuelve el pedido ya creado en vez de duplicarlo en cocina.
 * - `confirmDuplicate`: el comensal aceptó repetir un pedido idéntico al de hace unos minutos.
 */

type CartLine = { dishId: string; variantId?: string; modifierIds: string[]; quantity: number; note?: string };

export function buildOrderPayload(items: CartLine[], note: string, confirmDuplicate: boolean) {
  return {
    items: items.map(({ dishId, variantId, modifierIds, quantity, note: lineNote }) => ({ dishId, variantId, modifierIds, quantity, note: lineNote })),
    note: note.trim() || undefined,
    ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
  };
}

const pendingKeyOf = (tag?: string) => `bar.pendingOrder.${tag ?? "sin-mesa"}`;

function idempotencyKeyFor(tag: string | undefined, payload: unknown): string {
  const serialized = JSON.stringify(payload);
  const pending = load<{ key: string; body: string } | null>(pendingKeyOf(tag), null);
  const key = pending?.body === serialized ? pending.key : uuid();
  save(pendingKeyOf(tag), { key, body: serialized });
  return key;
}

export async function submitOrder(tag: string | undefined, payload: ReturnType<typeof buildOrderPayload>) {
  // Token de respaldo si la cookie no viaja (navegadores que bloquean cookies de terceros)
  const token = tag ? load<string | null>(`bar.token.${tag}`, null) : null;
  await api("/orders", { method: "POST", body: payload, token, headers: { "Idempotency-Key": idempotencyKeyFor(tag, payload) } });
  remove(pendingKeyOf(tag));
}

export const isDuplicateOrder = (err: unknown): err is ApiError => err instanceof ApiError && err.code === "DUPLICATE_ORDER";

/** Mensaje para el comensal. Los de reglas de negocio (tamaño, pendientes, por hora) ya vienen claros de la API */
export function orderErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "No se pudo conectar. Revisá la señal y probá de nuevo: el pedido no se duplica.";
  if (err.status === 401) return "La sesión de la mesa venció. Escaneá el QR de nuevo.";
  if (err.status === 402) return "El local no tiene el pedido desde la mesa disponible ahora. Pedile al mozo.";
  return err.message || "No se pudo registrar el pedido.";
}
