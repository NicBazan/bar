// Cliente HTTP del staff. Token Bearer guardado en localStorage del dispositivo del local.
// Por defecto "" → llama a /v1/* en el mismo dominio y next.config.ts lo reenvía a la API
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "bar.staff.token";
const USER_KEY = "bar.staff.user";

export type StaffRole = "SUPER_ADMIN" | "OWNER" | "MANAGER" | "WAITER" | "KITCHEN" | "CASHIER";
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

export async function api<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  // Con FormData el navegador pone el Content-Type multipart con su boundary
  if (opts.body !== undefined && !opts.form) headers["content-type"] = "application/json";
  const token = getAuth()?.token;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}/v1${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
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
  pinFailures: number;
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

/** Sube un archivo (foto o modelo 3D) a un endpoint multipart del admin */
export function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return api<T>(path, { method: "POST", form });
}

// ───── Admin ─────

export type AdminDish = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  localPriceCents: number | null;
  available: boolean;
  hidden: boolean;
  active: boolean;
  position: number;
  allergens: string[];
  tags: string[];
  stationKey: string | null;
  variants: Array<{ id: string; name: string; priceCents: number }>;
  modifierGroups: Array<{
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    modifiers: Array<{ id: string; name: string; priceCents: number }>;
  }>;
  assets: Partial<Record<"PHOTO" | "GLB_LOD0" | "USDZ", { url: string; bytes: number | null }>>;
};

export type AdminMenu = {
  version: number;
  stations: Array<{ key: string; name: string }>;
  categories: Array<{ id: string; name: string; position: number; stationKey: string | null; dishes: AdminDish[] }>;
};

export type AdminTable = {
  id: string;
  label: string;
  seats: number;
  areaId: string | null;
  active: boolean;
  status: "FREE" | "PENDING" | "OPEN" | "BILL_REQUESTED";
  qr: { code: string; url: string } | null;
  nfc: { code: string; uid: string | null; urlTemplate: string } | null;
};

export type AdminTables = { guestBaseUrl: string; areas: Array<{ id: string; name: string }>; tables: AdminTable[] };

export type AdminOverview = {
  venue: { id: string; name: string; currency: string };
  role: StaffRole;
  guestBaseUrl: string;
  plan: { plan: "FREE" | "PRO" | "CANCELED"; used: number; limit: number; periodEnd: string } | null;
  last24h: { orders: number; salesCents: number };
  activeSessions: number;
  counts: { dishes: number; tables: number; staff: number };
  topDishes7d: Array<{ name: string; quantity: number }>;
};

export type AdminStaff = { id: string; name: string; email: string; role: StaffRole; active: boolean; createdAt: string };

export type AdminVenue = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  layoutMode: "classic" | "reels" | "list";
  wifiSsid: string | null;
  wifiPassword: string | null;
  googleReviewUrl: string | null;
};

// ───── Super admin ─────

export type SaTenant = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  owner: { name: string; email: string } | null;
  counts: { venues: number; staff: number };
  subscription: { plan: "FREE" | "PRO" | "CANCELED"; used: number; limit: number; periodEnd: string } | null;
  last30d: { sessions: number; orders: number; salesCents: number };
};

export type SaStats = {
  tenants: number;
  suspended: number;
  plans: Partial<Record<"FREE" | "PRO" | "CANCELED", number>>;
  sessions: { last24h: number; last30d: number };
  orders30d: { count: number; gmvCents: number };
};

export type SaAudit = {
  id: number;
  tenantId: string;
  tenantName: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  data: unknown;
  createdAt: string;
};

/** "$ 1.234" a partir de un input de texto ("1234,50" o "1.234") → centavos */
export function parseMoney(input: string): number | null {
  // Formato argentino: el punto separa miles y la coma los decimales ("1.234,50")
  const clean = input.trim().replace(/[\s$]/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  SUPER_ADMIN: "Super admin",
  OWNER: "Dueño",
  MANAGER: "Encargado",
  WAITER: "Mozo",
  KITCHEN: "Cocina",
  CASHIER: "Caja",
};
