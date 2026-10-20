// Panel del dueño (/v1/admin) y de la plataforma (/v1/superadmin): permisos, aislamiento entre bares,
// subida de archivos y efectos en la carta pública. Crea dos bares temporales y los borra al final.
import { randomUUID } from "node:crypto";
import { prisma, purgeTenant } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const created: string[] = [];

type Bar = { token: string; tenantId: string; venueId: string; tableCodes: string[] };
let A: Bar;
let B: Bar;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function onboard(name: string): Promise<Bar> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/onboarding/register",
    payload: { ownerName: "Dueño Test", email: `owner-${randomUUID()}@test.local`, password: "clave-segura-123", barName: name },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json();
  created.push(body.tenant.id);
  return {
    token: body.token,
    tenantId: body.tenant.id,
    venueId: body.venue.id,
    tableCodes: body.tables.map((t: { tagCode: string }) => t.tagCode),
  };
}

async function login(email: string, password: string) {
  const res = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email, password } });
  return res;
}

/** multipart/form-data a mano (app.inject no lo arma) */
function multipart(token: string, filename: string, content: Buffer) {
  const boundary = `----bar${randomUUID()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { ...auth(token), "content-type": `multipart/form-data; boundary=${boundary}` } };
}

// PNG real de 1x1 px
const PNG_1PX = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);
// GLB mínimo válido: cabecera glTF v2 cuyo largo declarado coincide con el real
const GLB_MIN = Buffer.concat([Buffer.from("glTF"), Buffer.from([2, 0, 0, 0, 12, 0, 0, 0])]);

beforeAll(async () => {
  app = await buildApp({ logger: false });
  A = await onboard("Bar Test A");
  B = await onboard("Bar Test B");
});

afterAll(async () => {
  for (const id of created) await purgeTenant(prisma, id);
  await app.close();
  await prisma.$disconnect();
});

describe("admin: permisos", () => {
  it("el mozo no entra al admin; el dueño sí", async () => {
    const mozo = await login("mozo@bardemo.test", "demo1234");
    expect((await app.inject({ url: "/v1/admin/overview", headers: auth(mozo.json().token) })).statusCode).toBe(403);
    const ov = await app.inject({ url: "/v1/admin/overview", headers: auth(A.token) });
    expect(ov.statusCode).toBe(200);
    expect(ov.json().counts.tables).toBe(10);
    expect(ov.json().plan.plan).toBe("FREE");
  });

  it("sin token: 401", async () => {
    expect((await app.inject({ url: "/v1/admin/menu" })).statusCode).toBe(401);
  });
});

describe("admin: carta", () => {
  let categoryId: string;
  let dishId: string;

  it("crea categoría y plato, con variantes y opciones, y se ve en la carta pública", async () => {
    const cat = await app.inject({ method: "POST", url: "/v1/admin/categories", headers: auth(A.token), payload: { name: "Tragos" } });
    expect(cat.statusCode).toBe(201);
    categoryId = cat.json().id;

    const dish = await app.inject({
      method: "POST",
      url: "/v1/admin/dishes",
      headers: auth(A.token),
      payload: { categoryId, name: "Negroni", description: "Gin, Campari, vermut", priceCents: 650000, allergens: ["alcohol"], tags: ["clásico"] },
    });
    expect(dish.statusCode).toBe(201);
    dishId = dish.json().id;

    const v = await app.inject({
      method: "PUT",
      url: `/v1/admin/dishes/${dishId}/variants`,
      headers: auth(A.token),
      payload: [
        { name: "Simple", priceCents: 650000 },
        { name: "Doble", priceCents: 950000 },
      ],
    });
    expect(v.statusCode).toBe(200);

    const m = await app.inject({
      method: "PUT",
      url: `/v1/admin/dishes/${dishId}/modifier-groups`,
      headers: auth(A.token),
      payload: [{ name: "Hielo", minSelect: 1, maxSelect: 1, modifiers: [{ name: "Con hielo", priceCents: 0 }, { name: "Sin hielo", priceCents: 0 }] }],
    });
    expect(m.statusCode).toBe(200);

    const pub = await app.inject({ url: `/v1/venues/${A.venueId}/menu` });
    const negroni = pub.json().categories[0].dishes[0];
    expect(negroni.name).toBe("Negroni");
    expect(negroni.variants).toHaveLength(2);
    expect(negroni.modifierGroups[0].modifiers).toHaveLength(2);
  });

  it("un PATCH parcial no borra los alérgenos (regresión Zod 4 .default en .partial)", async () => {
    const res = await app.inject({ method: "PATCH", url: `/v1/admin/dishes/${dishId}`, headers: auth(A.token), payload: { priceCents: 700000 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().allergens).toEqual(["alcohol"]);
    expect(res.json().priceCents).toBe(700000);
  });

  it("agotado y oculto se reflejan en la carta pública", async () => {
    await app.inject({ method: "PUT", url: `/v1/admin/dishes/${dishId}/availability`, headers: auth(A.token), payload: { available: false } });
    let pub = await app.inject({ url: `/v1/venues/${A.venueId}/menu` });
    expect(pub.json().categories[0].dishes[0].available).toBe(false);

    await app.inject({ method: "PUT", url: `/v1/admin/dishes/${dishId}/availability`, headers: auth(A.token), payload: { hidden: true } });
    pub = await app.inject({ url: `/v1/venues/${A.venueId}/menu` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().categories).toHaveLength(0); // la única categoría queda vacía y no se muestra

    // El admin lo sigue viendo para poder des-ocultarlo
    const adm = await app.inject({ url: "/v1/admin/menu", headers: auth(A.token) });
    expect(adm.json().categories[0].dishes[0].hidden).toBe(true);
    await app.inject({ method: "PUT", url: `/v1/admin/dishes/${dishId}/availability`, headers: auth(A.token), payload: { hidden: false, available: true } });
  });

  it("no se puede borrar una categoría con platos", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/admin/categories/${categoryId}`, headers: auth(A.token) });
    expect(res.statusCode).toBe(409);
  });

  it("aislamiento: el bar B no puede ver ni tocar los platos del bar A", async () => {
    const patch = await app.inject({ method: "PATCH", url: `/v1/admin/dishes/${dishId}`, headers: auth(B.token), payload: { priceCents: 1 } });
    expect(patch.statusCode).toBe(404);
    const avail = await app.inject({ method: "PUT", url: `/v1/admin/dishes/${dishId}/availability`, headers: auth(B.token), payload: { available: false } });
    expect(avail.statusCode).toBe(404);
    const dish = await app.inject({
      method: "POST",
      url: "/v1/admin/dishes",
      headers: auth(B.token),
      payload: { categoryId, name: "Intruso", priceCents: 1 },
    });
    expect(dish.statusCode).toBe(404); // la categoría de A no existe para B
    const menuB = await app.inject({ url: "/v1/admin/menu", headers: auth(B.token) });
    expect(menuB.json().categories).toHaveLength(0);
  });

  it("valida URLs de recursos: nada de javascript: ni http:", async () => {
    for (const url of ["javascript:alert(1)", "http://inseguro.com/x.glb", "data:text/html,hola"]) {
      const res = await app.inject({ method: "PUT", url: `/v1/admin/dishes/${dishId}/media/PHOTO`, headers: auth(A.token), payload: { url } });
      expect(res.statusCode).toBe(400);
    }
    const ok = await app.inject({
      method: "PUT",
      url: `/v1/admin/dishes/${dishId}/media/GLB_LOD0`,
      headers: auth(A.token),
      payload: { url: "/models/avocado.glb" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("sube una foto real y la sirve con headers seguros; rechaza archivos disfrazados", async () => {
    const up = await app.inject({ method: "POST", url: `/v1/admin/dishes/${dishId}/media/PHOTO`, ...multipart(A.token, "foto.png", PNG_1PX) });
    expect(up.statusCode).toBe(201);
    const url: string = up.json().url;
    expect(url).toMatch(/^\/v1\/media\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);

    const file = await app.inject({ url });
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(file.headers["content-security-policy"])).toContain("default-src 'none'");

    // HTML con extensión .jpg: se rechaza por contenido
    const evil = await app.inject({
      method: "POST",
      url: `/v1/admin/dishes/${dishId}/media/PHOTO`,
      ...multipart(A.token, "foto.jpg", Buffer.from("<html><script>alert(1)</script></html>")),
    });
    expect(evil.statusCode).toBe(415);

    // Un GLB no es una foto, y una foto no es un GLB
    const wrongKind = await app.inject({ method: "POST", url: `/v1/admin/dishes/${dishId}/media/GLB_LOD0`, ...multipart(A.token, "x.glb", PNG_1PX) });
    expect(wrongKind.statusCode).toBe(415);
    const glb = await app.inject({ method: "POST", url: `/v1/admin/dishes/${dishId}/media/GLB_LOD0`, ...multipart(A.token, "x.glb", GLB_MIN) });
    expect(glb.statusCode).toBe(201);

    // Path traversal: el nombre de archivo lo valida una regex estricta
    expect((await app.inject({ url: `/v1/media/${A.tenantId}/..%2F..%2Fpackage.json` })).statusCode).toBe(400);
  });
});

describe("admin: mesas y QR", () => {
  it("crea una mesa con QR y regenerar el QR invalida el anterior", async () => {
    const t = await app.inject({ method: "POST", url: "/v1/admin/tables", headers: auth(A.token), payload: { label: "Terraza 1", seats: 2 } });
    expect(t.statusCode).toBe(201);
    const list = await app.inject({ url: "/v1/admin/tables", headers: auth(A.token) });
    const mesa = list.json().tables.find((x: { label: string }) => x.label === "Terraza 1");
    const oldCode = mesa.qr.code;
    expect((await app.inject({ url: `/v1/tags/${oldCode}` })).statusCode).toBe(200);

    const regen = await app.inject({ method: "POST", url: `/v1/admin/tables/${mesa.id}/regenerate-qr`, headers: auth(A.token) });
    expect(regen.statusCode).toBe(200);
    expect((await app.inject({ url: `/v1/tags/${oldCode}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/v1/tags/${regen.json().code}` })).statusCode).toBe(200);

    const dup = await app.inject({ method: "POST", url: "/v1/admin/tables", headers: auth(A.token), payload: { label: "Terraza 1" } });
    expect(dup.statusCode).toBe(409);
  });

  it("un chip NFC no se puede vincular a dos mesas", async () => {
    const list = (await app.inject({ url: "/v1/admin/tables", headers: auth(A.token) })).json().tables;
    const uid = `04${randomUUID().replace(/-/g, "").slice(0, 12)}`.toUpperCase();
    const first = await app.inject({ method: "PUT", url: `/v1/admin/tables/${list[0].id}/nfc`, headers: auth(A.token), payload: { uid } });
    expect(first.statusCode).toBe(200);
    expect(first.json().nfc.urlTemplate).toContain("?uid={UID}&ctr={CTR}&cmac={CMAC}");
    const tablesB = (await app.inject({ url: "/v1/admin/tables", headers: auth(B.token) })).json().tables;
    const second = await app.inject({ method: "PUT", url: `/v1/admin/tables/${tablesB[0].id}/nfc`, headers: auth(B.token), payload: { uid } });
    expect(second.statusCode).toBe(409);
  });
});

describe("admin: equipo", () => {
  it("el dueño crea un mozo; al desactivarlo pierde el acceso al instante", async () => {
    const email = `mozo-${randomUUID()}@test.local`;
    const create = await app.inject({
      method: "POST",
      url: "/v1/admin/staff",
      headers: auth(A.token),
      payload: { name: "Mozo Nuevo", email, password: "clave-mozo-123", role: "WAITER" },
    });
    expect(create.statusCode).toBe(201);
    const mozo = await login(email, "clave-mozo-123");
    expect(mozo.statusCode).toBe(200);
    const mozoToken = mozo.json().token;
    expect((await app.inject({ url: "/v1/staff/sessions", headers: auth(mozoToken) })).statusCode).toBe(200);

    const off = await app.inject({ method: "PATCH", url: `/v1/admin/staff/${create.json().id}`, headers: auth(A.token), payload: { active: false } });
    expect(off.statusCode).toBe(200);
    const after = await app.inject({ url: "/v1/staff/sessions", headers: auth(mozoToken) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error).toBe("STAFF_INACTIVE");
  });

  it("un encargado no puede crear encargados ni editar al dueño; nadie se cambia su propio rol", async () => {
    const email = `encargado-${randomUUID()}@test.local`;
    const mgr = await app.inject({
      method: "POST",
      url: "/v1/admin/staff",
      headers: auth(A.token),
      payload: { name: "Encargado", email, password: "clave-encargado-1", role: "MANAGER" },
    });
    expect(mgr.statusCode).toBe(201);
    const mgrToken = (await login(email, "clave-encargado-1")).json().token;

    const otherMgr = await app.inject({
      method: "POST",
      url: "/v1/admin/staff",
      headers: auth(mgrToken),
      payload: { name: "Otro", email: `otro-${randomUUID()}@test.local`, password: "clave-otro-1234", role: "MANAGER" },
    });
    expect(otherMgr.statusCode).toBe(403);

    const staff = (await app.inject({ url: "/v1/admin/staff", headers: auth(mgrToken) })).json();
    const owner = staff.find((s: { role: string }) => s.role === "OWNER");
    const editOwner = await app.inject({ method: "PATCH", url: `/v1/admin/staff/${owner.id}`, headers: auth(mgrToken), payload: { active: false } });
    expect(editOwner.statusCode).toBe(403);

    const self = await app.inject({ method: "PATCH", url: `/v1/admin/staff/${mgr.json().id}`, headers: auth(mgrToken), payload: { role: "WAITER" } });
    expect(self.statusCode).toBe(403);
  });

  it("no expone hashes de contraseñas", async () => {
    const res = await app.inject({ url: "/v1/admin/staff", headers: auth(A.token) });
    expect(res.body).not.toContain("passwordHash");
    expect(res.body).not.toContain("scrypt$");
  });
});

describe("admin: datos del local y hub en mesa", () => {
  it("el Wi-Fi solo se entrega a mesas abiertas", async () => {
    const upd = await app.inject({
      method: "PATCH",
      url: "/v1/admin/venue",
      headers: auth(A.token),
      payload: { wifiSsid: "BarA-Invitados", wifiPassword: "secreta123", googleReviewUrl: "https://example.com/resenas" },
    });
    expect(upd.statusCode).toBe(200);
    const bad = await app.inject({ method: "PATCH", url: "/v1/admin/venue", headers: auth(A.token), payload: { googleReviewUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);

    const join = await app.inject({ method: "POST", url: `/v1/tags/${A.tableCodes[1]}/session`, payload: { deviceKey: `dev-${randomUUID()}` } });
    const guest = join.json().token;
    let s = (await app.inject({ url: "/v1/session", headers: auth(guest) })).json();
    expect(s.status).toBe("PENDING");
    expect(s.hub.wifi).toBeNull(); // quien solo escaneó el QR no recibe la clave
    expect(s.hub.googleReviewUrl).toBe("https://example.com/resenas");

    await app.inject({ method: "POST", url: `/v1/staff/sessions/${s.id}/open`, headers: auth(A.token) });
    s = (await app.inject({ url: "/v1/session", headers: auth(guest) })).json();
    expect(s.hub.wifi).toEqual({ ssid: "BarA-Invitados", password: "secreta123" });
  });

  it("PIN: tras 8 intentos fallidos se bloquea; el mozo genera uno nuevo y desbloquea", async () => {
    const code = A.tableCodes[2];
    const opener = await app.inject({ method: "POST", url: `/v1/tags/${code}/session`, payload: { deviceKey: `dev-${randomUUID()}` } });
    const { id: sessionId, pin } = opener.json().session;
    const wrong = pin === "0000" ? "1111" : "0000";
    let last = 0;
    for (let i = 0; i < 8; i++) {
      last = (await app.inject({ method: "POST", url: `/v1/tags/${code}/session`, payload: { deviceKey: `dev-${randomUUID()}`, pin: wrong } })).statusCode;
    }
    expect(last).toBe(423);
    // Bloqueado incluso con el PIN correcto
    const correct = await app.inject({ method: "POST", url: `/v1/tags/${code}/session`, payload: { deviceKey: `dev-${randomUUID()}`, pin } });
    expect(correct.statusCode).toBe(423);

    const np = await app.inject({ method: "POST", url: `/v1/staff/sessions/${sessionId}/new-pin`, headers: auth(A.token) });
    expect(np.statusCode).toBe(200);
    const ok = await app.inject({ method: "POST", url: `/v1/tags/${code}/session`, payload: { deviceKey: `dev-${randomUUID()}`, pin: np.json().joinPin } });
    expect(ok.statusCode).toBe(200);
  });
});

describe("super admin", () => {
  let superToken: string;

  beforeAll(async () => {
    const res = await login("superadmin@bar.test", "superadmin1234");
    expect(res.statusCode).toBe(200);
    superToken = res.json().token;
  });

  it("solo el super admin entra; un dueño recibe 403", async () => {
    expect((await app.inject({ url: "/v1/superadmin/stats", headers: auth(A.token) })).statusCode).toBe(403);
    expect((await app.inject({ url: "/v1/superadmin/tenants", headers: auth(A.token) })).statusCode).toBe(403);
    const stats = await app.inject({ url: "/v1/superadmin/stats", headers: auth(superToken) });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().tenants).toBeGreaterThanOrEqual(3);
  });

  it("lista los bares (sin la plataforma) y busca por nombre", async () => {
    const all = (await app.inject({ url: "/v1/superadmin/tenants", headers: auth(superToken) })).json();
    expect(all.some((t: { slug: string }) => t.slug === "plataforma")).toBe(false);
    const found = (await app.inject({ url: "/v1/superadmin/tenants?q=Bar%20Test%20B", headers: auth(superToken) })).json();
    expect(found.map((t: { id: string }) => t.id)).toContain(B.tenantId);
  });

  it("cambia el plan y la cuota de un bar", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/superadmin/tenants/${B.tenantId}/subscription`,
      headers: auth(superToken),
      payload: { plan: "PRO", tableSessionLimit: 500, resetUsage: true, extendDays: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toBe("PRO");
    const detail = (await app.inject({ url: `/v1/superadmin/tenants/${B.tenantId}`, headers: auth(superToken) })).json();
    expect(detail.audit[0].action).toBe("superadmin.subscription_changed");
  });

  it("suspender un bar corta al staff y a la carta; reactivarlo lo devuelve", async () => {
    const sus = await app.inject({ method: "POST", url: `/v1/superadmin/tenants/${B.tenantId}/suspend`, headers: auth(superToken), payload: { reason: "Prueba" } });
    expect(sus.statusCode).toBe(200);
    const staff = await app.inject({ url: "/v1/admin/overview", headers: auth(B.token) });
    expect(staff.statusCode).toBe(403);
    expect(staff.json().error).toBe("TENANT_SUSPENDED");
    const guest = await app.inject({ method: "POST", url: `/v1/tags/${B.tableCodes[0]}/session`, payload: { deviceKey: `dev-${randomUUID()}` } });
    expect(guest.statusCode).toBe(402);

    await app.inject({ method: "POST", url: `/v1/superadmin/tenants/${B.tenantId}/unsuspend`, headers: auth(superToken), payload: {} });
    expect((await app.inject({ url: "/v1/admin/overview", headers: auth(B.token) })).statusCode).toBe(200);
  });

  it("da de alta un bar para un cliente y resetea la contraseña de un dueño", async () => {
    const email = `cliente-${randomUUID()}@test.local`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/superadmin/tenants",
      headers: auth(superToken),
      payload: { ownerName: "Cliente", email, password: "clave-cliente-1", barName: "Bar Cliente", plan: "PRO", tableSessionLimit: 1000 },
    });
    expect(res.statusCode).toBe(201);
    created.push(res.json().tenant.id);

    const detail = (await app.inject({ url: `/v1/superadmin/tenants/${res.json().tenant.id}`, headers: auth(superToken) })).json();
    const owner = detail.staffUsers.find((u: { role: string }) => u.role === "OWNER");
    const reset = await app.inject({ method: "POST", url: `/v1/superadmin/staff/${owner.id}/reset-password`, headers: auth(superToken) });
    expect(reset.statusCode).toBe(200);
    expect((await login(email, "clave-cliente-1")).statusCode).toBe(401);
    expect((await login(email, reset.json().temporaryPassword)).statusCode).toBe(200);
  });
});
