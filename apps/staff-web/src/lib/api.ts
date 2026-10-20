// Cliente HTTP del staff. Token Bearer guardado en localStorage del dispositivo del local.
// Por defecto "" → llama a /v1/* en el mismo dominio y next.config.ts lo reenvía a la API
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "bar.staff.token";
const USER_KEY = "bar.staff.user";

export type StaffRole = "OWNER" | "MANAGER" | "WAITER" | "KITCHEN" | "CASHIER";
export type StaffUser = { id: string; name: string; role: StaffRole; venueId: string | null };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function getAuth(): { token: string; user: StaffUser } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    return token && user ? { token, user: JSON.parse(user) as StaffUser } : null;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: StaffUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* noop */
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const token = getAuth()?.token;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/staff/login")) {
    clearAuth();
    window.location.href = "/login";
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? "HTTP_ERROR", data.message);
  return data as T;
}

// ───── Tipos (espejo de la API) ─────

export type TableSession = {
  id: string;
  status: "PENDING" | "OPEN" | "BILL_REQUESTED" | "CLOSED";
  joinPin: string;
  openedAt: string;
  table: { label: string };
  _count: { devices: number; orders: number };
};

export type OrderItem = {
  id: string;
  orderId: string;
  nameSnapshot: string;
  variantName: string | null;
  modifiers: Array<{ name: string; priceCents: number }>;
  unitPriceCents: number;
  quantity: number;
  note: string | null;
  status: string;
  updatedAt: string;
};

export type Order = {
  id: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  totalCents: number;
  note: string | null;
  createdAt: string;
  items: OrderItem[];
  session: { table: { label: string } };
};

export type ServiceCall = {
  id: string;
  type: "WAITER" | "BILL";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  createdAt: string;
  session: { table: { label: string } };
};

export type KitchenItem = OrderItem & {
  station: { key: string; name: string } | null;
  order: { id: string; createdAt: string; note: string | null; session: { table: { label: string } } };
};

export type StateEvents = { lastSeq: number; events: Array<{ venueSeq: number; type: string; payload: Record<string, unknown> }> };

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(cents / 100);
}

export function minutesSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
