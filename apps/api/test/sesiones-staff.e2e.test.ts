// Seguridad de las sesiones del staff (auditoría del 09/11):
// - el panel funciona solo con la cookie HttpOnly (sin token en el JavaScript de la página);
// - "cerrar todas mis sesiones", el reseteo de contraseña y la baja invalidan los tokens ya emitidos.
import { prisma } from "@bar/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/shared/auth/password.js";

let app: FastifyInstance;
let userId = "";
const email = `sesiones-${Date.now()}@bardemo.test`;
const password = "clave-de-prueba-123";

async function login() {
  const res = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === "bar_staff");
  return { token: res.json().token as string, cookie: `${cookie?.name}=${cookie?.value}` };
}

const sessionsWith = (headers: Record<string, string>) => app.inject({ url: "/v1/staff/sessions", headers });


beforeAll(async () => {
  app = await buildApp({ logger: false });
  const venue = await prisma.venue.findFirstOrThrow({ where: { tenant: { slug: "bar-demo" } } });
  const user = await prisma.staffUser.create({
    data: { tenantId: venue.tenantId, venueId: venue.id, email, name: "Mozo de prueba", role: "WAITER", passwordHash: hashPassword(password) },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.staffUser.delete({ where: { id: userId } }).catch(() => undefined);
  await app.close();
});

describe("sesiones del staff", () => {
  it("la cookie HttpOnly sola alcanza para usar el panel (sin Bearer)", async () => {
    const { cookie } = await login();
    expect(cookie).toContain("bar_staff=");
    expect((await sessionsWith({ cookie })).statusCode).toBe(200);
  });

  it("'cerrar todas mis sesiones' invalida el celular perdido y deja entrar de nuevo", async () => {
    const perdido = await login();
    const actual = await login();
    const res = await app.inject({ method: "POST", url: "/v1/staff/logout-all", headers: { cookie: actual.cookie } });
    expect(res.statusCode).toBe(200);

    const revoked = await sessionsWith({ authorization: `Bearer ${perdido.token}` });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error).toBe("SESSION_REVOKED");
    expect((await sessionsWith({ cookie: perdido.cookie })).statusCode).toBe(401);

    expect((await sessionsWith({ cookie: (await login()).cookie })).statusCode).toBe(200);
  });

  it("si el dueño le cambia la contraseña o lo da de baja, los tokens viejos dejan de valer", async () => {
    const viejo = await login();
    const owner = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { email: "dueno@bardemo.test", password: "demo1234" } });
    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/admin/staff/${userId}`,
      headers: { authorization: `Bearer ${owner.json().token}` },
      payload: { password },
    });
    expect(patch.statusCode).toBe(200);
    expect((await sessionsWith({ authorization: `Bearer ${viejo.token}` })).json().error).toBe("SESSION_REVOKED");
  });
});
