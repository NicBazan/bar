// Matriz de permisos (L-025 de la base de conocimiento).
// 1. Toda ruta de la API tiene que estar clasificada acá: una ruta nueva sin clasificar hace fallar el test.
// 2. Sin credenciales, toda ruta no pública responde 401.
// 3. Cada rol, comensal o cliente que NO tiene acceso a una ruta recibe 401 o 403, nunca datos.
// Los casos permitidos ya los cubren los tests e2e de cada módulo; acá se prueba el lado del "no".
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

type Access =
  | "public" // sin credenciales
  | "guest" // token de comensal (mesa)
  | "guest-or-staff" // /state: comensal o cualquier staff
  | "customer" // token de "Mi cuenta"
  | "staff" // cualquier rol del local
  | "floor" // OWNER, MANAGER, WAITER
  | "redeem" // salón + CASHIER
  | "admin" // OWNER, MANAGER
  | "superadmin"; // SUPER_ADMIN del tenant de la plataforma

const MATRIX: Record<string, Access> = {
  "GET /health": "public",
  "GET /v1/venues/:venueId/menu": "public",
  "GET /v1/venues/:venueId/promos": "public",
  "GET /v1/media/:tenantId/:file": "public",
  "GET /v1/tags/:code": "public",
  "POST /v1/tags/:code/session": "public",
  "POST /v1/onboarding/register": "public",
  "POST /v1/staff/login": "public",
  "POST /v1/staff/logout": "public",
  "POST /v1/customer/auth/request-code": "public",
  "POST /v1/customer/auth/verify": "public",
  "POST /v1/customer/push/unsubscribe": "public", // por endpoint + bar: el endpoint es el secreto
  "POST /v1/customer/unsubscribe": "public", // token firmado del email
  // Cron: sin secreto configurado responde 404; con secreto, solo con el header correcto (test en avisos-automaticos)
  "GET /v1/internal/automations/run": "public",
  "POST /v1/internal/automations/run": "public",

  "GET /v1/session": "guest",
  "GET /v1/session/receipt": "guest",
  "GET /v1/customer/me/visits/:id/receipt": "customer",
  "GET /v1/staff/sessions/:id/receipt": "redeem", // salón + caja
  "POST /v1/orders": "guest",
  "POST /v1/service-calls": "guest",
  "GET /v1/state": "guest-or-staff",

  "POST /v1/customer/link": "customer",
  "GET /v1/customer/me": "customer",
  "PATCH /v1/customer/me": "customer",
  "DELETE /v1/customer/me": "customer",
  "GET /v1/customer/me/history": "customer",
  "GET /v1/customer/me/orders/:id/reorder": "customer",
  "GET /v1/customer/me/export": "customer",
  "GET /v1/customer/me/loyalty": "customer",
  "GET /v1/customer/promos": "customer",
  "GET /v1/customer/notifications": "customer",
  "PUT /v1/customer/notifications/email": "customer",
  "POST /v1/customer/push/subscribe": "customer",

  "GET /v1/staff/orders": "staff",
  "POST /v1/staff/logout-all": "staff",
  "GET /v1/staff/service-calls": "staff",
  "GET /v1/staff/kitchen/items": "staff",
  "PATCH /v1/staff/order-items/:id/status": "staff", // el rol se valida por estado destino
  "GET /v1/staff/sessions": "staff",
  "POST /v1/staff/orders/:id/approve": "floor",
  "POST /v1/staff/orders/:id/reject": "floor",
  "POST /v1/staff/service-calls/:id/:action": "floor",
  "POST /v1/staff/sessions/:id/:action": "floor",
  "GET /v1/staff/sessions/:id/customers": "redeem",
  "POST /v1/staff/loyalty/redeem": "redeem",

  "GET /v1/admin/overview": "admin",
  "GET /v1/admin/menu": "admin",
  "POST /v1/admin/categories": "admin",
  "PATCH /v1/admin/categories/:id": "admin",
  "DELETE /v1/admin/categories/:id": "admin",
  "POST /v1/admin/dishes": "admin",
  "PATCH /v1/admin/dishes/:id": "admin",
  "DELETE /v1/admin/dishes/:id": "admin",
  "PUT /v1/admin/dishes/:id/availability": "admin",
  "PUT /v1/admin/dishes/:id/variants": "admin",
  "PUT /v1/admin/dishes/:id/modifier-groups": "admin",
  "POST /v1/admin/dishes/:id/media/:kind": "admin",
  "PUT /v1/admin/dishes/:id/media/:kind": "admin",
  "DELETE /v1/admin/dishes/:id/media/:kind": "admin",
  "POST /v1/admin/stations": "admin",
  "GET /v1/admin/tables": "admin",
  "POST /v1/admin/tables": "admin",
  "PATCH /v1/admin/tables/:id": "admin",
  "POST /v1/admin/tables/:id/regenerate-qr": "admin",
  "POST /v1/admin/tables/:id/move-qr": "admin",
  "PUT /v1/admin/tables/:id/nfc": "admin",
  "POST /v1/admin/areas": "admin",
  "GET /v1/admin/staff": "admin",
  "POST /v1/admin/staff": "admin",
  "PATCH /v1/admin/staff/:id": "admin",
  "GET /v1/admin/venue": "admin",
  "PATCH /v1/admin/venue": "admin",
  "POST /v1/admin/venue/logo": "admin",
  "DELETE /v1/admin/venue/logo": "admin",
  "GET /v1/admin/loyalty": "admin",
  "PUT /v1/admin/loyalty": "admin",
  "GET /v1/admin/promotions": "admin",
  "POST /v1/admin/promotions": "admin",
  "PATCH /v1/admin/promotions/:id": "admin",
  "DELETE /v1/admin/promotions/:id": "admin",
  "GET /v1/admin/campaigns": "admin",
  "GET /v1/admin/automations": "admin",
  "PUT /v1/admin/automations/:kind": "admin",
  "POST /v1/superadmin/automations/run": "superadmin",
  "POST /v1/admin/campaigns": "admin",

  "GET /v1/superadmin/stats": "superadmin",
  "GET /v1/superadmin/tenants": "superadmin",
  "GET /v1/superadmin/tenants/:id": "superadmin",
  "POST /v1/superadmin/tenants": "superadmin",
  "PATCH /v1/superadmin/tenants/:id/subscription": "superadmin",
  "POST /v1/superadmin/tenants/:id/:action": "superadmin",
  "POST /v1/superadmin/staff/:id/reset-password": "superadmin",
  "GET /v1/superadmin/audit": "superadmin",
};

type Caller = "OWNER" | "WAITER" | "KITCHEN" | "CASHIER" | "SUPER_ADMIN" | "GUEST";

/** Quién puede pasar la guardia de cada tipo de ruta (los que no estén, tienen que ser rechazados) */
const ALLOWED: Record<Exclude<Access, "public" | "customer">, Caller[]> = {
  guest: ["GUEST"],
  "guest-or-staff": ["GUEST", "OWNER", "WAITER", "KITCHEN", "CASHIER", "SUPER_ADMIN"],
  staff: ["OWNER", "WAITER", "KITCHEN", "CASHIER", "SUPER_ADMIN"],
  floor: ["OWNER", "WAITER"],
  redeem: ["OWNER", "WAITER", "CASHIER"],
  admin: ["OWNER"],
  superadmin: ["SUPER_ADMIN"],
};

const STAFF_EMAILS: Record<Exclude<Caller, "GUEST">, string> = {
  OWNER: "dueno@bardemo.test",
  WAITER: "mozo@bardemo.test",
  KITCHEN: "cocina@bardemo.test",
  CASHIER: "caja@bardemo.test",
  SUPER_ADMIN: "superadmin@bar.test",
};

const DUMMY_ID = "00000000-0000-4000-8000-000000000000";
const toUrl = (pattern: string) => pattern.replace(/:action/g, "close").replace(/:kind/g, "photo").replace(/:[A-Za-z]+/g, DUMMY_ID);

let app: FastifyInstance;
const routes: string[] = [];
const tokens = {} as Record<Caller, string>;

async function call(route: string, token?: string) {
  const [method, pattern] = route.split(" ") as [string, string];
  return app.inject({
    method: method as "GET",
    url: toUrl(pattern),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(method === "GET" || method === "DELETE" ? {} : { payload: {} }),
  });
}

beforeAll(async () => {
  app = await buildApp({ logger: false, onRoute: (r) => routes.push(`${r.method} ${r.url}`) });
  await app.ready();

  for (const [caller, email] of Object.entries(STAFF_EMAILS)) {
    const password = caller === "SUPER_ADMIN" ? "superadmin1234" : "demo1234";
    const res = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email, password } });
    expect(res.statusCode, `login ${email}`).toBe(200);
    tokens[caller as Caller] = res.json().token;
  }

  // Comensal: se sienta en una mesa libre
  const tag = await prisma.tableTag.findFirstOrThrow({ where: { table: { label: "4", venue: { tenant: { slug: "bar-demo" } } } } });
  await prisma.tableSession.updateMany({ where: { tableId: tag.tableId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  const join = await app.inject({ method: "POST", url: `/v1/tags/${tag.code}/session`, payload: { deviceKey: "matriz-permisos" } });
  expect(join.statusCode).toBeLessThan(300);
  tokens.GUEST = join.json().token;
  expect(tokens.GUEST).toBeTruthy();
});

afterAll(async () => {
  await app.close();
});

describe("matriz de permisos", () => {
  it("toda ruta de la API está clasificada (y la tabla no tiene rutas viejas)", () => {
    const real = routes.filter((r) => !r.startsWith("HEAD ") && !r.startsWith("OPTIONS "));
    const sinClasificar = real.filter((r) => !(r in MATRIX));
    const viejas = Object.keys(MATRIX).filter((r) => !real.includes(r));
    expect(sinClasificar, "rutas nuevas: agregalas a MATRIX con su nivel de acceso").toEqual([]);
    expect(viejas, "rutas que ya no existen: sacalas de MATRIX").toEqual([]);
  });

  it("sin credenciales, toda ruta no pública responde 401", async () => {
    const fallas: string[] = [];
    for (const [route, access] of Object.entries(MATRIX)) {
      if (access === "public") continue;
      const res = await call(route);
      if (res.statusCode !== 401) fallas.push(`${route} → ${res.statusCode}`);
    }
    expect(fallas).toEqual([]);
  });

  it("cada rol o comensal sin permiso es rechazado (401/403)", async () => {
    const fallas: string[] = [];
    const callers = Object.keys(tokens) as Caller[];
    for (const [route, access] of Object.entries(MATRIX)) {
      if (access === "public") continue;
      const allowed = access === "customer" ? [] : ALLOWED[access];
      for (const caller of callers) {
        if (allowed.includes(caller)) continue;
        const res = await call(route, tokens[caller]);
        if (res.statusCode !== 401 && res.statusCode !== 403) fallas.push(`${caller} ${route} → ${res.statusCode}`);
      }
    }
    expect(fallas).toEqual([]);
  });
});
