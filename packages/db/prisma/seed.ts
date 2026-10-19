// Seed de desarrollo: un bar demo con salón, tags QR, carta y staff.
// Uso: pnpm db:seed  (borra y recrea los datos del tenant "bar-demo")
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient, StaffRole } from "@prisma/client";

const prisma = new PrismaClient();

// Contraseña SOLO para desarrollo local, igual para todo el staff demo.
const DEV_PASSWORD = "demo1234";

function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function tagCode(len = 10): string {
  return Array.from(randomBytes(len), (b) => BASE62[b % 62]).join("");
}

const CARTA: Array<{
  name: string;
  station: string;
  dishes: Array<{ name: string; description: string; price: number; allergens?: string[]; tags?: string[] }>;
}> = [
  {
    name: "Para compartir",
    station: "frios",
    dishes: [
      { name: "Papas bravas", description: "Papas crocantes con salsa brava y alioli.", price: 650000, tags: ["vegetariano"] },
      { name: "Provoleta", description: "Provolone a la parrilla con orégano y tomates confitados.", price: 780000, allergens: ["lactosa"] },
      { name: "Tabla de fiambres", description: "Jamón crudo, salame, quesos y pan de campo.", price: 1450000, allergens: ["gluten", "lactosa"] },
    ],
  },
  {
    name: "Principales",
    station: "parrilla",
    dishes: [
      { name: "Bife de chorizo", description: "400 g a la parrilla con papas rústicas.", price: 1890000, tags: ["sin_tacc"] },
      { name: "Hamburguesa de la casa", description: "Doble medallón, cheddar, panceta y pan brioche.", price: 1350000, allergens: ["gluten", "lactosa"] },
      { name: "Risotto de hongos", description: "Arroz carnaroli, hongos de pino y parmesano.", price: 1280000, allergens: ["lactosa"], tags: ["vegetariano"] },
    ],
  },
  {
    name: "Postres",
    station: "frios",
    dishes: [
      { name: "Flan casero", description: "Con dulce de leche y crema.", price: 520000, allergens: ["lactosa", "huevo"] },
      { name: "Volcán de chocolate", description: "Centro fundido y helado de vainilla.", price: 690000, allergens: ["gluten", "lactosa", "huevo"] },
    ],
  },
  {
    name: "Bebidas",
    station: "barra",
    dishes: [
      { name: "Cerveza tirada IPA", description: "Pinta de 500 ml.", price: 450000, allergens: ["gluten"] },
      { name: "Fernet con coca", description: "El clásico.", price: 520000 },
      { name: "Limonada", description: "Con menta y jengibre.", price: 380000, tags: ["vegano"] },
    ],
  },
];

async function main() {
  // Limpieza idempotente del tenant demo (orden inverso a las FKs)
  const old = await prisma.tenant.findUnique({ where: { slug: "bar-demo" } });
  if (old) {
    const t = { tenantId: old.id };
    await prisma.$transaction([
      prisma.outboxEvent.deleteMany({ where: t }),
      prisma.auditLog.deleteMany({ where: t }),
      prisma.orderItem.deleteMany({ where: t }),
      prisma.order.deleteMany({ where: t }),
      prisma.serviceCall.deleteMany({ where: t }),
      prisma.guestDevice.deleteMany({ where: t }),
      prisma.tableSession.deleteMany({ where: t }),
      prisma.tableTag.deleteMany({ where: t }),
      prisma.diningTable.deleteMany({ where: t }),
      prisma.area.deleteMany({ where: t }),
      prisma.dishOverride.deleteMany({ where: t }),
      prisma.dishAsset.deleteMany({ where: t }),
      prisma.modifier.deleteMany({ where: t }),
      prisma.modifierGroup.deleteMany({ where: t }),
      prisma.dishVariant.deleteMany({ where: t }),
      prisma.dish.deleteMany({ where: t }),
      prisma.category.deleteMany({ where: t }),
      prisma.venueMenu.deleteMany({ where: t }),
      prisma.menu.deleteMany({ where: t }),
      prisma.kitchenStation.deleteMany({ where: t }),
      prisma.staffUser.deleteMany({ where: t }),
      prisma.venue.deleteMany({ where: t }),
      prisma.tenant.delete({ where: { id: old.id } }),
    ]);
  }

  const tenant = await prisma.tenant.create({ data: { name: "Bar Demo", slug: "bar-demo" } });
  const tenantId = tenant.id;

  const venue = await prisma.venue.create({
    data: { tenantId, name: "Bar Demo - Palermo", slug: "palermo", layout: { mode: "classic" } },
  });
  const venueId = venue.id;

  // Estaciones de cocina
  const stations = new Map<string, string>();
  for (const [key, name] of [["parrilla", "Parrilla"], ["frios", "Fríos y postres"], ["barra", "Barra"]] as const) {
    const s = await prisma.kitchenStation.create({ data: { tenantId, venueId, key, name } });
    stations.set(key, s.id);
  }

  // Staff (uno por rol)
  const passwordHash = hashPassword(DEV_PASSWORD);
  const staff: Array<[string, string, StaffRole]> = [
    ["dueno@bardemo.test", "Dueño Demo", StaffRole.OWNER],
    ["mozo@bardemo.test", "Mozo Demo", StaffRole.WAITER],
    ["cocina@bardemo.test", "Cocina Demo", StaffRole.KITCHEN],
    ["caja@bardemo.test", "Caja Demo", StaffRole.CASHIER],
  ];
  for (const [email, name, role] of staff) {
    await prisma.staffUser.create({ data: { tenantId, venueId, email, name, role, passwordHash } });
  }

  // Salón: 2 áreas, 8 mesas, un tag QR por mesa
  const tags: Array<{ table: string; code: string }> = [];
  const areas = [
    { name: "Salón", tables: ["1", "2", "3", "4", "5", "6"] },
    { name: "Barra", tables: ["B1", "B2"] },
  ];
  for (const [i, a] of areas.entries()) {
    const area = await prisma.area.create({ data: { tenantId, venueId, name: a.name, position: i } });
    for (const label of a.tables) {
      const table = await prisma.diningTable.create({
        data: { tenantId, venueId, areaId: area.id, label, seats: label.startsWith("B") ? 2 : 4 },
      });
      const code = tagCode();
      await prisma.tableTag.create({ data: { code, tenantId, tableId: table.id, type: "QR" } });
      tags.push({ table: label, code });
    }
  }

  // Carta
  const menu = await prisma.menu.create({ data: { tenantId, name: "Carta principal" } });
  await prisma.venueMenu.create({ data: { tenantId, venueId, menuId: menu.id } });

  for (const [ci, cat] of CARTA.entries()) {
    const category = await prisma.category.create({
      data: { tenantId, menuId: menu.id, name: cat.name, position: ci, stationKey: cat.station },
    });
    for (const [di, d] of cat.dishes.entries()) {
      const dish = await prisma.dish.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: d.name,
          description: d.description,
          priceCents: d.price,
          position: di,
          allergens: d.allergens ?? [],
          tags: d.tags ?? [],
        },
      });
      if (d.name === "Bife de chorizo") {
        const g = await prisma.modifierGroup.create({
          data: { tenantId, dishId: dish.id, name: "Punto de cocción", minSelect: 1, maxSelect: 1 },
        });
        await prisma.modifier.createMany({
          data: ["Jugoso", "A punto", "Cocido"].map((name) => ({ tenantId, groupId: g.id, name })),
        });
      }
      if (d.name === "Hamburguesa de la casa") {
        const g = await prisma.modifierGroup.create({
          data: { tenantId, dishId: dish.id, name: "Extras", minSelect: 0, maxSelect: 3 },
        });
        await prisma.modifier.createMany({
          data: [
            { tenantId, groupId: g.id, name: "Huevo frito", priceCents: 90000 },
            { tenantId, groupId: g.id, name: "Doble cheddar", priceCents: 120000 },
          ],
        });
      }
      if (d.name === "Cerveza tirada IPA") {
        await prisma.dishVariant.createMany({
          data: [
            { tenantId, dishId: dish.id, name: "Media pinta", priceCents: 300000, position: 0 },
            { tenantId, dishId: dish.id, name: "Pinta", priceCents: 450000, position: 1 },
          ],
        });
      }
    }
  }

  console.log(`✔ Tenant "${tenant.name}" / ${venue.name}`);
  console.log(`✔ Staff: ${staff.map((s) => s[0]).join(", ")} (contraseña dev en prisma/seed.ts)`);
  console.log("✔ Tags de mesa (URL /t/{code}):");
  for (const t of tags) console.log(`   Mesa ${t.table.padEnd(3)} → /t/${t.code}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
