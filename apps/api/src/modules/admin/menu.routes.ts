import type { FastifyInstance } from "fastify";
import { prisma, type Tx } from "../../shared/db/index.js";
import { HttpError, conflict, notFound } from "../../shared/errors.js";
import { type AdminContext, bumpMenuVersion, requireAdmin } from "./context.js";
import { deleteMediaByUrl, saveMedia } from "./media.js";
import {
  Availability,
  CategoryCreate,
  CategoryUpdate,
  DishCreate,
  DishUpdate,
  IdParams,
  MediaKindParam,
  MediaUrlBody,
  ModifierGroupsPut,
  StationCreate,
  VariantsPut,
} from "./schemas.js";

/** El plato debe ser del tenant Y de la carta de esta sucursal */
async function ownDish(tx: Tx | typeof prisma, ctx: AdminContext, id: string) {
  const dish = await tx.dish.findFirst({
    where: { id, tenantId: ctx.tenantId, category: { menuId: ctx.menuId } },
    include: { assets: true },
  });
  if (!dish) throw notFound("Plato");
  return dish;
}

async function ownCategory(tx: Tx | typeof prisma, ctx: AdminContext, id: string) {
  const cat = await tx.category.findFirst({ where: { id, tenantId: ctx.tenantId, menuId: ctx.menuId } });
  if (!cat) throw notFound("Categoría");
  return cat;
}

async function assertStation(ctx: AdminContext, key: string | null | undefined) {
  if (!key) return;
  const st = await prisma.kitchenStation.findFirst({ where: { venueId: ctx.venueId, key } });
  if (!st) throw conflict("STATION_NOT_FOUND", `No existe la estación "${key}"`);
}

export async function adminMenuRoutes(app: FastifyInstance) {
  // ───── Carta completa para editar (incluye platos archivados y ocultos) ─────
  app.get("/admin/menu", async (req) => {
    const ctx = await requireAdmin(req);
    const [vm, stations] = await Promise.all([
      prisma.venueMenu.findUniqueOrThrow({
        where: { id: ctx.venueMenuId },
        include: {
          overrides: true,
          menu: {
            include: {
              categories: {
                orderBy: { position: "asc" },
                include: {
                  dishes: {
                    orderBy: [{ active: "desc" }, { position: "asc" }, { name: "asc" }],
                    include: {
                      variants: { orderBy: { position: "asc" } },
                      modifierGroups: { include: { modifiers: true } },
                      assets: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.kitchenStation.findMany({ where: { venueId: ctx.venueId }, orderBy: { name: "asc" } }),
    ]);
    const overrides = new Map(vm.overrides.map((o) => [o.dishId, o]));
    return {
      version: vm.version,
      stations: stations.map((s) => ({ key: s.key, name: s.name })),
      categories: vm.menu.categories.map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position,
        stationKey: c.stationKey,
        dishes: c.dishes.map((d) => {
          const o = overrides.get(d.id);
          return {
            id: d.id,
            categoryId: d.categoryId,
            name: d.name,
            description: d.description,
            priceCents: d.priceCents,
            localPriceCents: o?.priceCents ?? null,
            available: o?.available ?? true,
            hidden: o?.hidden ?? false,
            active: d.active,
            position: d.position,
            allergens: d.allergens,
            tags: d.tags,
            stationKey: d.stationKey,
            variants: d.variants.map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents })),
            modifierGroups: d.modifierGroups.map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceCents: m.priceCents })),
            })),
            assets: Object.fromEntries(d.assets.map((a) => [a.kind, { url: a.url, bytes: a.bytes }])),
          };
        }),
      })),
    };
  });

  // ───── Categorías ─────
  app.post("/admin/categories", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = CategoryCreate.parse(req.body);
    await assertStation(ctx, body.stationKey);
    const last = await prisma.category.aggregate({ where: { menuId: ctx.menuId }, _max: { position: true } });
    const cat = await prisma.$transaction(async (tx) => {
      const c = await tx.category.create({
        data: {
          tenantId: ctx.tenantId,
          menuId: ctx.menuId,
          name: body.name,
          stationKey: body.stationKey ?? null,
          position: (last._max.position ?? -1) + 1,
        },
      });
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return c;
    });
    return reply.status(201).send(cat);
  });

  app.patch("/admin/categories/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const body = CategoryUpdate.parse(req.body);
    await ownCategory(prisma, ctx, id);
    await assertStation(ctx, body.stationKey);
    return prisma.$transaction(async (tx) => {
      const c = await tx.category.update({ where: { id }, data: body });
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return c;
    });
  });

  app.delete("/admin/categories/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    await ownCategory(prisma, ctx, id);
    const count = await prisma.dish.count({ where: { categoryId: id } });
    if (count > 0) throw conflict("CATEGORY_NOT_EMPTY", "Mové o archivá los platos antes de borrar la categoría");
    await prisma.$transaction(async (tx) => {
      await tx.category.delete({ where: { id } });
      await bumpMenuVersion(tx, ctx.venueMenuId);
    });
    return { ok: true };
  });

  // ───── Platos ─────
  app.post("/admin/dishes", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = DishCreate.parse(req.body);
    await ownCategory(prisma, ctx, body.categoryId);
    await assertStation(ctx, body.stationKey);
    const last = await prisma.dish.aggregate({ where: { categoryId: body.categoryId }, _max: { position: true } });
    const dish = await prisma.$transaction(async (tx) => {
      const d = await tx.dish.create({
        data: {
          tenantId: ctx.tenantId,
          categoryId: body.categoryId,
          name: body.name,
          description: body.description ?? null,
          priceCents: body.priceCents,
          allergens: body.allergens,
          tags: body.tags,
          stationKey: body.stationKey ?? null,
          position: (last._max.position ?? -1) + 1,
        },
      });
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return d;
    });
    return reply.status(201).send(dish);
  });

  app.patch("/admin/dishes/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const body = DishUpdate.parse(req.body);
    const current = await ownDish(prisma, ctx, id);
    if (body.categoryId) await ownCategory(prisma, ctx, body.categoryId);
    await assertStation(ctx, body.stationKey);
    return prisma.$transaction(async (tx) => {
      const d = await tx.dish.update({ where: { id }, data: body });
      if (body.priceCents !== undefined && body.priceCents !== current.priceCents) {
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.staff.sub,
            action: "dish.price_changed",
            entity: "Dish",
            entityId: id,
            data: { from: current.priceCents, to: body.priceCents },
          },
        });
      }
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return d;
    });
  });

  // Archivar (no se borra: los pedidos viejos lo referencian)
  app.delete("/admin/dishes/:id", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    await ownDish(prisma, ctx, id);
    await prisma.$transaction(async (tx) => {
      await tx.dish.update({ where: { id }, data: { active: false } });
      await bumpMenuVersion(tx, ctx.venueMenuId);
    });
    return { ok: true };
  });

  // Agotado / oculto / precio local en ESTA sucursal
  app.put("/admin/dishes/:id/availability", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const body = Availability.parse(req.body);
    await ownDish(prisma, ctx, id);
    return prisma.$transaction(async (tx) => {
      const o = await tx.dishOverride.upsert({
        where: { venueMenuId_dishId: { venueMenuId: ctx.venueMenuId, dishId: id } },
        create: {
          tenantId: ctx.tenantId,
          venueMenuId: ctx.venueMenuId,
          dishId: id,
          available: body.available ?? true,
          hidden: body.hidden ?? false,
          priceCents: body.priceCents ?? null,
        },
        update: body,
      });
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return o;
    });
  });

  // Reemplaza todas las variantes (tamaños). Los pedidos guardan snapshot: no se rompen.
  app.put("/admin/dishes/:id/variants", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const variants = VariantsPut.parse(req.body);
    await ownDish(prisma, ctx, id);
    return prisma.$transaction(async (tx) => {
      await tx.dishVariant.deleteMany({ where: { dishId: id } });
      if (variants.length > 0) {
        await tx.dishVariant.createMany({
          data: variants.map((v, i) => ({ tenantId: ctx.tenantId, dishId: id, name: v.name, priceCents: v.priceCents, position: i })),
        });
      }
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return tx.dishVariant.findMany({ where: { dishId: id }, orderBy: { position: "asc" } });
    });
  });

  // Reemplaza los grupos de opciones (punto de cocción, extras…)
  app.put("/admin/dishes/:id/modifier-groups", async (req) => {
    const ctx = await requireAdmin(req);
    const { id } = IdParams.parse(req.params);
    const groups = ModifierGroupsPut.parse(req.body);
    await ownDish(prisma, ctx, id);
    return prisma.$transaction(async (tx) => {
      await tx.modifierGroup.deleteMany({ where: { dishId: id } }); // cascade a los modificadores
      for (const g of groups) {
        await tx.modifierGroup.create({
          data: {
            tenantId: ctx.tenantId,
            dishId: id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: Math.min(g.maxSelect, g.modifiers.length),
            modifiers: {
              create: g.modifiers.map((m) => ({ tenantId: ctx.tenantId, name: m.name, priceCents: m.priceCents })),
            },
          },
        });
      }
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return tx.modifierGroup.findMany({ where: { dishId: id }, include: { modifiers: true } });
    });
  });

  // ───── Foto y modelos 3D ─────
  async function setAsset(ctx: AdminContext, dishId: string, kind: "PHOTO" | "GLB_LOD0" | "USDZ", url: string, bytes?: number) {
    const dish = await ownDish(prisma, ctx, dishId);
    const prev = dish.assets.find((a) => a.kind === kind);
    const asset = await prisma.$transaction(async (tx) => {
      const a = await tx.dishAsset.upsert({
        where: { dishId_kind: { dishId, kind } },
        create: { tenantId: ctx.tenantId, dishId, kind, url, bytes: bytes ?? null },
        update: { url, bytes: bytes ?? null },
      });
      await bumpMenuVersion(tx, ctx.venueMenuId);
      return a;
    });
    if (prev && prev.url !== url) await deleteMediaByUrl(ctx.tenantId, prev.url);
    return asset;
  }

  app.post("/admin/dishes/:id/media/:kind", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const { id, kind } = MediaKindParam.parse(req.params);
    await ownDish(prisma, ctx, id); // antes de leer el archivo: no se aceptan subidas a platos ajenos
    const file = await req.file();
    if (!file) throw new HttpError(400, "FILE_REQUIRED", "Falta el archivo");
    const buf = await file.toBuffer(); // corta en el límite de @fastify/multipart (413)
    const saved = await saveMedia(ctx.tenantId, kind, buf);
    return reply.status(201).send(await setAsset(ctx, id, kind, saved.url, saved.bytes));
  });

  app.put("/admin/dishes/:id/media/:kind", async (req) => {
    const ctx = await requireAdmin(req);
    const { id, kind } = MediaKindParam.parse(req.params);
    const { url } = MediaUrlBody.parse(req.body);
    return setAsset(ctx, id, kind, url);
  });

  app.delete("/admin/dishes/:id/media/:kind", async (req) => {
    const ctx = await requireAdmin(req);
    const { id, kind } = MediaKindParam.parse(req.params);
    const dish = await ownDish(prisma, ctx, id);
    const prev = dish.assets.find((a) => a.kind === kind);
    if (prev) {
      await prisma.$transaction(async (tx) => {
        await tx.dishAsset.delete({ where: { id: prev.id } });
        await bumpMenuVersion(tx, ctx.venueMenuId);
      });
      await deleteMediaByUrl(ctx.tenantId, prev.url);
    }
    return { ok: true };
  });

  // ───── Estaciones de cocina (para el KDS) ─────
  app.post("/admin/stations", async (req, reply) => {
    const ctx = await requireAdmin(req);
    const body = StationCreate.parse(req.body);
    const exists = await prisma.kitchenStation.findFirst({ where: { venueId: ctx.venueId, key: body.key } });
    if (exists) throw conflict("STATION_EXISTS", "Ya existe una estación con esa clave");
    const st = await prisma.kitchenStation.create({ data: { tenantId: ctx.tenantId, venueId: ctx.venueId, ...body } });
    return reply.status(201).send(st);
  });
}
