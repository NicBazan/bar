import { Prisma, prisma } from "../../shared/db/index.js";
import { HttpError } from "../../shared/errors.js";

const DEFAULT_FREE_LIMIT = 50;
const CYCLE_DAYS = 30;

/**
 * Verifica si el Tenant tiene permitido abrir una nueva sesión de mesa bajo su plan actual.
 *
 * Reglas de Freemium:
 * - Plan FREE: límite de 50 mesas mensuales. Si se supera, lanza 402 Payment Required.
 * - Plan PRO: sin límite de mesas.
 * - Plan CANCELED: bloqueado (402 Payment Required).
 * - Ciclo vencido: reinicia automáticamente el contador para el nuevo período de 30 días.
 */
export async function assertTenantCanOpenSession(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  let sub = await tx.subscription.findUnique({
    where: { tenantId },
  });

  const now = new Date();

  // Si el tenant no tiene suscripción aún, se inicializa en plan FREE
  if (!sub) {
    const periodEnd = new Date(now.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);
    sub = await tx.subscription.create({
      data: {
        tenantId,
        plan: "FREE",
        currentPeriodEnd: periodEnd,
        tableSessionsThisMonth: 0,
        tableSessionLimit: DEFAULT_FREE_LIMIT,
      },
    });
  }

  // Si venció el ciclo de facturación, reinicia el contador mensual
  if (now > sub.currentPeriodEnd) {
    const nextPeriodEnd = new Date(now.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000);
    sub = await tx.subscription.update({
      where: { tenantId },
      data: {
        tableSessionsThisMonth: 0,
        currentPeriodEnd: nextPeriodEnd,
      },
    });
  }

  if (sub.plan === "CANCELED") {
    throw new HttpError(
      402,
      "SUBSCRIPTION_CANCELED",
      "La suscripción de este establecimiento se encuentra inactiva o cancelada.",
    );
  }

  if (sub.plan === "FREE" && sub.tableSessionsThisMonth >= sub.tableSessionLimit) {
    throw new HttpError(
      402,
      "PLAN_LIMIT_REACHED",
      "Este local ha alcanzado el límite mensual de mesas de su plan gratuito. Servicio momentáneamente no disponible.",
    );
  }

  return sub;
}

/**
 * Incrementa el uso mensual de mesas del Tenant cuando se confirma la apertura de una sesión.
 */
export async function incrementSessionUsage(
  tx: Prisma.TransactionClient,
  tenantId: string,
) {
  return tx.subscription.update({
    where: { tenantId },
    data: {
      tableSessionsThisMonth: { increment: 1 },
    },
  });
}
