import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { STAFF_COOKIE } from "../../shared/auth/guards.js";
import { hashPassword } from "../../shared/auth/password.js";
import { signToken } from "../../shared/auth/tokens.js";
import { prisma } from "../../shared/db/index.js";
import { generateTagCode } from "../../shared/codes.js";
import { conflict } from "../../shared/errors.js";

export const RegisterOnboardingBody = z.object({
  ownerName: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
  email: z.string().trim().email("Formato de correo inválido").toLowerCase(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100),
  barName: z.string().trim().min(2, "El nombre del bar debe tener al menos 2 caracteres").max(100),
});

export type RegisterOnboardingBody = z.infer<typeof RegisterOnboardingBody>;


function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "bar"
  );
}

/**
 * POST /v1/onboarding/register
 * Registra un nuevo bar/tenant en modo autoservicio (Shopify para bares) con plan FREE,
 * creando tenant, sucursal base, usuario dueño, carta vacía y 10 mesas iniciales con tags QR.
 */
export async function registerOnboardingHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = RegisterOnboardingBody.parse(req.body);
  const result = await provisionTenant(body);
  return sendProvisioned(reply, result);
}

/**
 * Alta completa de un bar: tenant + suscripción + sucursal + dueño + carta vacía + 10 mesas con QR.
 * La usan el registro self-service y el super admin.
 */
export async function provisionTenant(
  body: RegisterOnboardingBody,
  opts: { plan?: "FREE" | "PRO"; tableSessionLimit?: number } = {},
) {

  // 1. Validar que el email no esté registrado
  const existingUser = await prisma.staffUser.findUnique({
    where: { email: body.email },
  });

  if (existingUser) {
    throw conflict("EMAIL_ALREADY_REGISTERED", "El correo ya se encuentra registrado");
  }

  // Generar slug único para el tenant
  const baseSlug = slugify(body.barName);
  const randomSuffix = randomBytes(3).toString("hex");
  const tenantSlug = `${baseSlug}-${randomSuffix}`;

  // 2. Transacción de aprovisionamiento integral
  const result = await prisma.$transaction(async (tx) => {
    // a) Crear Tenant con Suscripción FREE por 30 días
    const tenant = await tx.tenant.create({
      data: {
        name: body.barName,
        slug: tenantSlug,
        subscription: {
          create: {
            plan: opts.plan ?? "FREE",
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            tableSessionsThisMonth: 0,
            tableSessionLimit: opts.tableSessionLimit ?? 50,
          },
        },
      },
      include: {
        subscription: true,
      },
    });

    // b) Crear Sucursal Principal (Venue)
    const venue = await tx.venue.create({
      data: {
        tenantId: tenant.id,
        name: `${body.barName} - Principal`,
        slug: "principal",
        timezone: "America/Argentina/Buenos_Aires",
        currency: "ARS",
      },
    });

    // c) Crear Usuario Dueño (StaffUser)
    const owner = await tx.staffUser.create({
      data: {
        tenantId: tenant.id,
        venueId: venue.id,
        name: body.ownerName,
        email: body.email,
        passwordHash: hashPassword(body.password),
        role: "OWNER",
        active: true,
      },
    });

    // d) Crear Menú base vacío y asignarlo a la sucursal
    const menu = await tx.menu.create({
      data: {
        tenantId: tenant.id,
        name: "Carta Principal",
      },
    });

    await tx.venueMenu.create({
      data: {
        tenantId: tenant.id,
        venueId: venue.id,
        menuId: menu.id,
        active: true,
        version: 1,
      },
    });

    // e) Crear Salón Principal y 10 Mesas con TableTags únicos
    const area = await tx.area.create({
      data: {
        tenantId: tenant.id,
        venueId: venue.id,
        name: "Salón Principal",
        position: 0,
      },
    });

    const createdTables = [];

    for (let i = 1; i <= 10; i++) {
      const table = await tx.diningTable.create({
        data: {
          tenantId: tenant.id,
          venueId: venue.id,
          areaId: area.id,
          label: `Mesa ${i}`,
          seats: 4,
          active: true,
        },
      });

      const tagCode = generateTagCode(10);

      const tag = await tx.tableTag.create({
        data: {
          code: tagCode,
          tenantId: tenant.id,
          tableId: table.id,
          type: "QR",
          active: true,
          sunCounter: 0,
        },
      });

      createdTables.push({
        tableId: table.id,
        label: table.label,
        tagCode: tag.code,
        qrUrl: `/t/${tag.code}`,
      });
    }

    return {
      tenant,
      venue,
      owner,
      menu,
      tables: createdTables,
    };
  });
  return result;
}

type Provisioned = Awaited<ReturnType<typeof provisionTenant>>;

async function sendProvisioned(reply: FastifyReply, result: Provisioned) {
  // 3. Generar token JWT de staff y enviar cookie HttpOnly para inicio de sesión inmediato
  const token = await signToken({
    typ: "staff",
    sub: result.owner.id,
    tid: result.tenant.id,
    vid: result.venue.id,
    role: result.owner.role,
  });

  reply.setCookie(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    path: "/",
    maxAge: 12 * 60 * 60,
  });

  reply.status(201);
  return {
    token,
    user: {
      id: result.owner.id,
      name: result.owner.name,
      email: result.owner.email,
      role: result.owner.role,
    },
    tenant: {
      id: result.tenant.id,
      name: result.tenant.name,
      slug: result.tenant.slug,
    },
    venue: {
      id: result.venue.id,
      name: result.venue.name,
    },
    subscription: {
      plan: result.tenant.subscription?.plan ?? "FREE",
      tableSessionLimit: result.tenant.subscription?.tableSessionLimit ?? 50,
      currentPeriodEnd: result.tenant.subscription?.currentPeriodEnd,
    },
    tables: result.tables,
  };
}
