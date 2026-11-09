import { config } from "../../config.js";
import { Prisma, prisma } from "../../shared/db/index.js";
import { deliverToCustomer } from "../../shared/notify/deliver.js";
import { type Candidate, type Rule, STRATEGIES } from "./strategies.js";

/**
 * Ejecutor de avisos automáticos. Idempotente: se puede correr cada 30 minutos (o dos veces a la vez)
 * sin mandar nada repetido, porque cada envío primero RESERVA su fila única (regla, cliente, motivo).
 *
 * Reglas comunes a todos los tipos:
 * - solo entre las 10 y las 21, hora del local;
 * - como máximo 1 aviso automático por cliente cada 7 días;
 * - solo a quien aceptó avisos de ese bar (lo filtra cada estrategia).
 */

export const QUIET_HOURS = { from: 10, to: 21 };
export const MIN_DAYS_BETWEEN = 7;
export const RETURN_WINDOW_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export type RunSummary = { rules: number; sent: number; skipped: number };

export function localHour(timeZone: string, now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
}

export async function runAutomations(now = new Date(), opts: { ignoreQuietHours?: boolean } = {}): Promise<RunSummary> {
  await markReturns(now);
  const rules = await prisma.automationRule.findMany({ where: { enabled: true, tenant: { suspendedAt: null } } });
  const summary: RunSummary = { rules: rules.length, sent: 0, skipped: 0 };
  for (const rule of rules) {
    const r = await runRule(rule, now, opts.ignoreQuietHours ?? false);
    summary.sent += r.sent;
    summary.skipped += r.skipped;
  }
  return summary;
}

async function runRule(rule: Rule, now: Date, ignoreQuietHours: boolean) {
  const venue = await prisma.venue.findFirst({ where: { tenantId: rule.tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, timezone: true, googleReviewUrl: true } });
  if (!venue) return { sent: 0, skipped: 0 };
  const hour = localHour(venue.timezone, now);
  if (!ignoreQuietHours && (hour < QUIET_HOURS.from || hour >= QUIET_HOURS.to)) return { sent: 0, skipped: 0 };

  const candidates = await STRATEGIES[rule.kind].findCandidates(rule, now);
  let sent = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (await notifyOnce(rule, c, venue, now)) sent++;
    else skipped++;
  }
  return { sent, skipped };
}

type VenueInfo = { id: string; name: string; googleReviewUrl: string | null };

/** Reserva el envío (UNIQUE) y respeta el tope de 1 aviso cada 7 días; devuelve si salió */
async function notifyOnce(rule: Rule, c: Candidate, venue: VenueInfo, now: Date): Promise<boolean> {
  const recent = await prisma.automationDelivery.count({ where: { customerId: c.customer.id, createdAt: { gt: new Date(now.getTime() - MIN_DAYS_BETWEEN * DAY) } } });
  if (recent > 0) return false;
  let deliveryId: string;
  try {
    const d = await prisma.automationDelivery.create({ data: { tenantId: rule.tenantId, ruleId: rule.id, customerId: c.customer.id, reasonKey: c.reasonKey } });
    deliveryId = d.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false; // ya avisado por este motivo
    throw e;
  }
  const result = await deliverToCustomer(c.customer, messageFor(rule, venue));
  await prisma.automationDelivery.update({ where: { id: deliveryId }, data: { pushSent: result.pushSent, emailSent: result.emailSent } });
  if (result.goneSubs.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: result.goneSubs } } });
  return true;
}

function messageFor(rule: Rule, venue: VenueInfo) {
  const review = rule.kind === "THANK_YOU" && venue.googleReviewUrl;
  return {
    tenantId: rule.tenantId,
    venueName: venue.name,
    title: rule.title,
    body: rule.body,
    url: review ? venue.googleReviewUrl! : `${config.publicGuestUrl}/v/${venue.id}/cuenta?tab=promos`,
    linkLabel: review ? "Dejar mi opinión" : "Ver mis beneficios",
  };
}

/** Atribución: un aviso "funcionó" si el cliente volvió a pedir dentro de los 14 días siguientes */
async function markReturns(now: Date) {
  const open = await prisma.automationDelivery.findMany({
    where: { returnedAt: null, createdAt: { gt: new Date(now.getTime() - RETURN_WINDOW_DAYS * DAY) } },
    select: { id: true, customerId: true, createdAt: true },
  });
  for (const d of open) {
    const back = await prisma.order.findFirst({ where: { customerId: d.customerId, createdAt: { gt: d.createdAt } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (back) await prisma.automationDelivery.update({ where: { id: d.id }, data: { returnedAt: back.createdAt } });
  }
}
