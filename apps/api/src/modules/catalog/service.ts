import { prisma } from "../../shared/db/index.js";
import { notFound } from "../../shared/errors.js";

/**
 * Carta "compilada" de una sucursal: menú activo + overrides locales (precio, agotado, oculto).
 * Es la misma estructura que se cachea en CDN y que recibe el Chef IA.
 */
export type VenueMenuCompiled = {
  venue: {
    id: string;
    name: string;
    currency: string;
    layout: unknown;
    logoUrl: string | null;
    address: string | null;
    instagramUrl: string | null;
  };
  version: number;
  categories: Array<{
    id: string;
    name: string;
    dishes: Array<{
      id: string;
      name: string;
      description: string | null;
      priceCents: number;
      available: boolean;
      allergens: string[];
      tags: string[];
      variants: Array<{ id: string; name: string; priceCents: number }>;
      modifierGroups: Array<{
        id: string;
        name: string;
        minSelect: number;
        maxSelect: number;
        modifiers: Array<{ id: string; name: string; priceCents: number }>;
      }>;
      assets: Record<string, string>;
    }>;
  }>;
};

export async function getVenueMenu(venueId: string): Promise<VenueMenuCompiled> {
  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true, name: true, currency: true, layout: true, logoUrl: true, address: true, instagramUrl: true },
  });
  if (!venue) throw notFound("Local");

  const venueMenu = await prisma.venueMenu.findFirst({
    where: { venueId, active: true },
    include: {
      overrides: true,
      menu: {
        include: {
          categories: {
            orderBy: { position: "asc" },
            include: {
              dishes: {
                where: { active: true },
                orderBy: { position: "asc" },
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
  });
  if (!venueMenu) throw notFound("Carta");

  const overrides = new Map(venueMenu.overrides.map((o) => [o.dishId, o]));

  const categories = venueMenu.menu.categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      dishes: c.dishes
        .filter((d) => !overrides.get(d.id)?.hidden)
        .map((d) => {
          const o = overrides.get(d.id);
          return {
            id: d.id,
            name: d.name,
            description: d.description,
            priceCents: o?.priceCents ?? d.priceCents,
            available: o?.available ?? true,
            allergens: d.allergens,
            tags: d.tags,
            variants: d.variants.map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents })),
            modifierGroups: d.modifierGroups.map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceCents: m.priceCents })),
            })),
            assets: Object.fromEntries(d.assets.map((a) => [a.kind, a.url])),
          };
        }),
    }))
    .filter((c) => c.dishes.length > 0);

  return { venue, version: venueMenu.version, categories };
}
