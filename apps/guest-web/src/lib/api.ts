// Cliente HTTP del comensal. El token de mesa va como Bearer (sirve igual en PWA y App Clip).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${API_URL}/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "HTTP_ERROR", data.message);
  return data as T;
}

// ───── Tipos de respuesta (espejo de la API) ─────

export type Modifier = { id: string; name: string; priceCents: number };
export type ModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; modifiers: Modifier[] };
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

export type TagInfo = { venue: { id: string; name: string }; table: { id: string; label: string } };

export type SessionStatus = "PENDING" | "OPEN" | "BILL_REQUESTED" | "CLOSED";

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
  status: SessionStatus;
  pin: string;
  table: { label: string };
  orders: Order[];
  serviceCalls: Array<{ id: string; type: "WAITER" | "BILL"; status: string }>;
  lastSeq: number;
};

export type StateEvents = {
  lastSeq: number;
  events: Array<{ venueSeq: number; type: string; payload: Record<string, unknown> }>;
};
