// "Mi cuenta" del cliente: una cuenta por bar, así que el token se guarda por local (venueId).
import { ApiError, api, type FetchOptions } from "./api";
import { load, remove, save } from "./storage";

const key = (venueId: string) => `bar.customer.${venueId}`;

export const getCustomerToken = (venueId: string) => load<string | null>(key(venueId), null);
export const setCustomerToken = (venueId: string, token: string) => save(key(venueId), token);
export const clearCustomerToken = (venueId: string) => remove(key(venueId));

/** Llamada autenticada como cliente; si la cuenta ya no existe, olvida el token */
export async function customerApi<T>(venueId: string, path: string, opts: FetchOptions = {}): Promise<T> {
  try {
    return await api<T>(path, { ...opts, token: getCustomerToken(venueId) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) clearCustomerToken(venueId);
    throw e;
  }
}

export type Me = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  stats: { visits: number; spentCents: number; lastVisitAt: string | null };
};

export type Visit = {
  sessionId: string;
  venue: { id: string; name: string; currency: string };
  tableLabel: string;
  date: string;
  totalCents: number;
  orders: Array<{
    id: string;
    status: string;
    totalCents: number;
    createdAt: string;
    items: Array<{ nameSnapshot: string; variantName: string | null; quantity: number; unitPriceCents: number; status: string }>;
  }>;
};

export type ReorderItem =
  | { available: false; name: string }
  | {
      available: true;
      dishId: string;
      name: string;
      variantId?: string;
      variantName?: string;
      modifierIds: string[];
      modifierNames: string[];
      note?: string;
      quantity: number;
      priceCents: number;
    };

/**
 * Si el cliente ya tiene cuenta en este bar, la visita actual (token de mesa) queda en su historial.
 * Se hace una vez por mesa y celular.
 */
export async function linkVisitIfLoggedIn(venueId: string, tag: string) {
  const guestToken = load<string | null>(`bar.token.${tag}`, null);
  if (!guestToken || !getCustomerToken(venueId)) return;
  const flag = `bar.linked.${guestToken.slice(-24)}`;
  if (load<boolean>(flag, false)) return;
  try {
    const res = await customerApi<{ linked: boolean }>(venueId, "/customer/link", { method: "POST", body: { guestToken } });
    if (res.linked) save(flag, true);
  } catch {
    /* sin conexión: se reintenta en la próxima carga */
  }
}

export type LoyaltyReward = { id: string; name: string; cost: number; canRedeem: boolean };

export type Loyalty =
  | { active: false }
  | {
      active: true;
      mode: "STAMPS" | "POINTS";
      centsPerPoint: number;
      balance: number;
      earnedThisMonth: number;
      rewards: LoyaltyReward[];
      next: (LoyaltyReward & { remaining: number }) | null;
      events: Array<{ kind: "EARN" | "REDEEM"; amount: number; sessionId: string | null; rewardName: string | null; createdAt: string }>;
    };

export const unitLabel = (mode: "STAMPS" | "POINTS", n: number) =>
  mode === "STAMPS" ? (n === 1 ? "sello" : "sellos") : n === 1 ? "punto" : "puntos";

export type Promo = { id: string; title: string; body: string; startsAt: string | null; endsAt: string | null };
