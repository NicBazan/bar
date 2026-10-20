// Crea (o actualiza) un SUPER_ADMIN de la plataforma. Para producción, en vez del seed:
//   pnpm --filter @bar/db create-superadmin admin@tudominio.com "contraseña-larga-y-única"
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "../src/client/index.js";

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Uso: create-superadmin <email> <contraseña de 12+ caracteres>");
  process.exit(1);
}

const prisma = new PrismaClient();
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;

const platform =
  (await prisma.tenant.findFirst({ where: { isPlatform: true } })) ??
  (await prisma.tenant.create({ data: { name: "Plataforma", slug: "plataforma", isPlatform: true } }));

const existing = await prisma.staffUser.findUnique({ where: { email: email.toLowerCase() } });
if (existing && existing.tenantId !== platform.id) {
  console.error("Ese email pertenece a un bar: usá otro para el super admin.");
  process.exit(1);
}
await prisma.staffUser.upsert({
  where: { email: email.toLowerCase() },
  create: { tenantId: platform.id, email: email.toLowerCase(), name: "Super Admin", role: "SUPER_ADMIN", passwordHash },
  update: { role: "SUPER_ADMIN", active: true, passwordHash },
});
console.log(`✔ Super admin listo: ${email.toLowerCase()}`);
await prisma.$disconnect();
