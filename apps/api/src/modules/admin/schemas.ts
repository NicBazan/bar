import { z } from "zod";

// Montos en centavos: hasta $ 10.000.000 por ítem
const Money = z.number().int().min(0).max(1_000_000_000);
const Label = z.string().trim().min(1).max(80);
const Words = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(12)
  .transform((xs) => [...new Set(xs)]);
const StationKey = z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,30}$/);

// URL de un recurso: HTTPS externo o un archivo propio. Nunca javascript:, data:, http:, etc.
export const AssetUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (u) => /^https:\/\/[^\s"'<>]+$/i.test(u) || /^\/(models|v1\/media)\/[A-Za-z0-9/_.-]+$/.test(u),
    "La URL debe empezar con https:// o ser un archivo subido",
  );

export const IdParams = z.object({ id: z.uuid() });

export const CategoryCreate = z.object({ name: Label, stationKey: StationKey.nullish() });
export const CategoryUpdate = z.object({
  name: Label.optional(),
  stationKey: StationKey.nullish(),
  position: z.number().int().min(0).max(1000).optional(),
});

export const DishCreate = z.object({
  categoryId: z.uuid(),
  name: Label,
  description: z.string().trim().max(500).nullish(),
  priceCents: Money,
  allergens: Words.default([]),
  tags: Words.default([]),
  stationKey: StationKey.nullish(),
});
// Sin .partial() de DishCreate: en Zod 4 los .default() se aplican aunque el campo sea opcional,
// y un PATCH sin "allergens" los borraría.
export const DishUpdate = z.object({
  categoryId: z.uuid().optional(),
  name: Label.optional(),
  description: z.string().trim().max(500).nullish(),
  priceCents: Money.optional(),
  allergens: Words.optional(),
  tags: Words.optional(),
  stationKey: StationKey.nullish(),
  active: z.boolean().optional(),
  position: z.number().int().min(-1000).max(1000).optional(),
});

export const Availability = z.object({
  available: z.boolean().optional(),
  hidden: z.boolean().optional(),
  // Precio propio de esta sucursal; null = usar el precio base del plato
  priceCents: Money.nullable().optional(),
});

export const VariantsPut = z
  .array(z.object({ name: Label, priceCents: Money }))
  .max(10)
  .refine((vs) => new Set(vs.map((v) => v.name.toLowerCase())).size === vs.length, "Hay variantes repetidas");

export const ModifierGroupsPut = z
  .array(
    z
      .object({
        name: Label,
        minSelect: z.number().int().min(0).max(10),
        maxSelect: z.number().int().min(1).max(10),
        modifiers: z.array(z.object({ name: Label, priceCents: Money })).min(1).max(15),
      })
      .refine((g) => g.minSelect <= g.maxSelect, "El mínimo no puede superar al máximo")
      .refine((g) => g.minSelect <= g.modifiers.length, "El mínimo supera la cantidad de opciones"),
  )
  .max(6);

export const MediaKindParam = z.object({ id: z.uuid(), kind: z.enum(["PHOTO", "GLB_LOD0", "USDZ"]) });
export const MediaUrlBody = z.object({ url: AssetUrl });

export const TableCreate = z.object({
  label: z.string().trim().min(1).max(20),
  seats: z.number().int().min(1).max(40).default(4),
  areaId: z.uuid().nullish(),
});
export const TableUpdate = z.object({
  label: z.string().trim().min(1).max(20).optional(),
  seats: z.number().int().min(1).max(40).optional(),
  areaId: z.uuid().nullish(),
  active: z.boolean().optional(),
});
export const NfcPut = z.object({
  // UID de 7 bytes del NTAG 424 DNA (14 hex) o null para desvincular
  uid: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{14}$/, "El UID tiene 14 caracteres hexadecimales")
    .transform((s) => s.toUpperCase())
    .nullable(),
});
export const AreaCreate = z.object({ name: z.string().trim().min(1).max(40) });

export const StationCreate = z.object({ key: StationKey, name: z.string().trim().min(1).max(40) });

const AssignableRole = z.enum(["MANAGER", "WAITER", "KITCHEN", "CASHIER"]);
export const StaffCreate = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.email().trim().toLowerCase().max(120),
  password: z.string().min(8).max(100),
  role: AssignableRole,
});
export const StaffUpdate = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: AssignableRole.optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
});

export const VenueUpdate = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  layoutMode: z.enum(["classic", "reels", "list"]).optional(),
  wifiSsid: z.string().trim().max(32).nullish(),
  wifiPassword: z.string().max(63).nullish(),
  googleReviewUrl: z
    .string()
    .trim()
    .max(300)
    .refine((u) => /^https:\/\/[^\s"'<>]+$/i.test(u), "Debe ser un link https://")
    .nullish(),
  address: z.string().trim().max(160).nullish(),
  instagramUrl: z
    .string()
    .trim()
    .max(200)
    .refine((u) => /^https:\/\/(www\.)?instagram\.com\/[^\s"'<>]+$/i.test(u), "Debe ser un link de instagram.com")
    .nullish(),
});
