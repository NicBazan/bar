// Cliente HTTP del comensal para Server Components y Client Components.
// - Navegador: "/v1" relativo; next.config.ts lo reenvía a la API (mismo dominio, sin CORS).
// - Servidor de Next (Server Components): directo a la API por API_INTERNAL_URL.
// NEXT_PUBLIC_API_URL sigue disponible para forzar una API externa desde el navegador.
const withV1 = (url: string) => (url.endsWith("/v1") ? url : `${url.replace(/\/+$/, "")}/v1`);
export const API_URL =
  typeof window === "undefined"
    ? withV1(process.env.API_INTERNAL_URL ?? "http://localhost:4000")
    : process.env.NEXT_PUBLIC_API_URL
      ? withV1(process.env.NEXT_PUBLIC_API_URL)
      : "/v1";

export class ApiError extends Error {
  public status: number;
  public code: string;
  public requiresPin: boolean;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requiresPin =
      code === "PIN_REQUIRED" ||
      code === "PIN_INVALID" ||
      (status === 401 && code !== "UNAUTHENTICATED") ||
      status === 403;
  }
}

export type FetchOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  cache?: RequestCache;
};

/**
 * Función fetch universal (Cliente y Servidor).
 * En el cliente envía automáticamente cookies HttpOnly (credentials: 'include').
 */
export async function api<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_URL}${normalizedPath}`;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...opts.headers,
  };

  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (opts.token) {
    headers["Authorization"] = `Bearer ${opts.token}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "include", // Envía automáticamente la cookie bar_guest en el navegador
    cache: opts.cache ?? "no-store",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errorCode = data.error ?? data.code ?? `HTTP_${res.status}`;
    const errorMessage = data.message ?? errorCode;
    throw new ApiError(res.status, errorCode, errorMessage);
  }

  return data as T;
}

// ───── Modelos de Datos de la API ─────

export type TagInfo = {
  venue: { id: string; name: string; layout?: unknown };
  table: { id: string; label: string };
};

export type JoinSessionResponse = {
  token: string;
  physicalPresence?: boolean;
  session: {
    id: string;
    status: "PENDING" | "OPEN" | "BILL_REQUESTED" | "CLOSED";
    pin: string;
    venueId: string;
    table: { id: string; label: string };
  };
};

export type Modifier = { id: string; name: string; priceCents: number };
export type ModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
};
export type Variant = { id: string; name: string; priceCents: number };

export type Dish = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  available: boolean;
  allergens: string[];
  tags: string[];
  variants: Variant[];
  modifierGroups: ModifierGroup[];
  assets: Partial<Record<"PHOTO" | "POSTER" | "GLB_LOD0" | "GLB_LOD1" | "USDZ", string>>;
};

export type Menu = {
  venue: { id: string; name: string; currency: string; layout: unknown };
  version: number;
  categories: Array<{ id: string; name: string; dishes: Dish[] }>;
};

export type OrderItem = {
  id: string;
  nameSnapshot: string;
  variantName: string | null;
  modifiers: Array<{ name: string; priceCents: number }>;
  unitPriceCents: number;
  quantity: number;
  status: string;
};

export type Order = {
  id: string;
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  totalCents: number;
  rejectReason: string | null;
  createdAt: string;
  items: OrderItem[];
};

export type SessionState = {
  id: string;
  status: "PENDING" | "OPEN" | "BILL_REQUESTED" | "CLOSED";
  pin: string;
  table: { label: string };
  orders: Order[];
  serviceCalls: Array<{ id: string; type: "WAITER" | "BILL"; status: string }>;
  lastSeq: number;
  // Hub en mesa: Wi-Fi (solo mesas abiertas) y link de reseñas
  hub?: { wifi: { ssid: string; password: string } | null; googleReviewUrl: string | null };
};

export type StateEvents = {
  lastSeq: number;
  events: Array<{ venueSeq: number; type: string; payload: Record<string, unknown> }>;
};
