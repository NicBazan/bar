import { timingSafeEqual } from "node:crypto";
import type { AutomationKind } from "@bar/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { requireSuperAdmin } from "../../shared/auth/guards.js";
import { prisma } from "../../shared/db/index.js";
import { notFound } from "../../shared/errors.js";
import { audit, requireAdmin } from "../admin/context.js";
import { RETURN_WINDOW_DAYS, runAutomations } from "./runner.js";
import { STRATEGIES } from "./strategies.js";

const Kind = z.enum(["WINBACK", "THANK_YOU"]);
// Una sola línea: el título va al asunto del email
const RuleBody = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(14).max(180).optional(),
  title: z.string().trim().min(1).max(80).regex(/^[^\r\n]*$/, "El título va en una sola línea"),
  body: z.string().trim().min(1).max(300),
});

/**
 * El secreto del cron se compara en tiempo constante; sin secreto configurado la ruta no existe.
 * Acepta `X-Cron-Secret` o `Authorization: Bearer <secreto>` (el formato que usa Vercel Cron).
 */
function assertCronSecret(req: FastifyRequest) {
  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  const given = Buffer.from(String(req.headers["x-cron-secret"] ?? bearer));
  const expected = Buffer.from(config.cronSecret);
  if (!config.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound();
}

export async function automationRoutes(app: FastifyInstance) {
  // Reglas del bar con sus valores por defecto y resultados de los últimos 30 días
  app.get("/admin/automations", async (req) => {
    const ctx = await requireAdmin(req);
    const rules = await prisma.automationRule.findMany({ where: { tenantId: ctx.tenantId } });
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    return Promise.all(
      (Object.keys(STRATEGIES) as AutomationKind[]).map(async (kind) => {
        const rule = rules.find((r) => r.kind === kind);
        const where = { tenantId: ctx.tenantId, rule: { kind }, createdAt: { gte: since } };
        const [sent, returned] = await Promise.all([
          prisma.automationDelivery.count({ where }),
          prisma.automationDelivery.count({ where: { ...where, returnedAt: { not: null } } }),
        ]);
        const d = STRATEGIES[kind].defaults;
        return {
          kind,
          label: STRATEGIES[kind].label,
          enabled: rule?.enabled ?? false,
          days: rule?.days ?? d.days,
          title: rule?.title ?? d.title,
          body: rule?.body ?? d.body,
          last30d: { sent, returned, returnWindowDays: RETURN_WINDOW_DAYS },
        };
      }),
    );
  });

  app.put("/admin/automations/:kind", async (req) => {
    const ctx = await requireAdmin(req);
    const { kind } = z.object({ kind: Kind }).parse(req.params);
    const body = RuleBody.parse(req.body);
    const data = { ...body, days: body.days ?? STRATEGIES[kind].defaults.days };
    return prisma.$transaction(async (tx) => {
      const rule = await tx.automationRule.upsert({
        where: { tenantId_kind: { tenantId: ctx.tenantId, kind } },
        create: { tenantId: ctx.tenantId, kind, ...data },
        update: data,
      });
      await audit(tx, ctx, "automation.updated", "AutomationRule", rule.id, { kind, enabled: body.enabled });
      return rule;
    });
  });

  // Plataforma: correr el motor ahora (respeta el horario, salvo force=1 para pruebas)
  app.post("/superadmin/automations/run", async (req) => {
    await requireSuperAdmin(req);
    const { force } = z.object({ force: z.enum(["0", "1"]).optional() }).parse(req.query);
    return runAutomations(new Date(), { ignoreQuietHours: force === "1" });
  });

  // Disparo externo: Vercel Cron llama con GET; un cron propio puede usar POST
  const runFromCron = async (req: FastifyRequest) => {
    assertCronSecret(req);
    return runAutomations();
  };
  app.get("/internal/automations/run", runFromCron);
  app.post("/internal/automations/run", runFromCron);
}

