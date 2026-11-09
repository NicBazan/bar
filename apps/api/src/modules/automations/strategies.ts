import type { AutomationKind } from "@bar/db";
import { prisma } from "../../shared/db/index.js";
import { type Recipient, hasConsent } from "../../shared/notify/deliver.js";

/**
 * Cada tipo de aviso automático es una estrategia (GoF Strategy): sabe a quién le corresponde
 * y por qué motivo (`reasonKey`). El ejecutor (runner.ts) no cambia cuando se suma un tipo nuevo.
 */

export type Rule = { id: string; tenantId: string; kind: AutomationKind; days: number; title: string; body: string };
export type Candidate = { customer: Recipient; reasonKey: string };

export type AutomationStrategy = {
  kind: AutomationKind;
  label: string;
  defaults: { title: string; body: string; days: number };
  findCandidates(rule: Rule, now: Date): Promise<Candidate[]>;
};

const DAY = 24 * 60 * 60 * 1000;
const COUNTED = ["APPROVED", "COMPLETED"] as const;
/** Pasada la ausencia, durante cuántos días más todavía vale la pena escribirle */
export const WINBACK_WINDOW_DAYS = 30;

const recipientSelect = {
  id: true,
  email: true,
  name: true,
  marketingOptInAt: true,
  pushSubs: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
} as const;

const consenting = (tenantId: string, ids: string[]) =>
  prisma.customer.findMany({ where: { tenantId, id: { in: ids } }, select: recipientSelect }).then((list) => list.filter(hasConsent));

/** "Te extrañamos": su última visita fue hace `days` días (y no hace tanto como para que ya no tenga sentido) */
const winback: AutomationStrategy = {
  kind: "WINBACK",
  label: "Te extrañamos",
  defaults: { days: 30, title: "Te extrañamos", body: "Hace un tiempo que no te vemos. Vení esta semana: te esperamos con tu mesa de siempre." },
  async findCandidates(rule, now) {
    const lastVisits = await prisma.order.groupBy({
      by: ["customerId"],
      where: { tenantId: rule.tenantId, customerId: { not: null }, status: { in: [...COUNTED] } },
      _max: { createdAt: true },
    });
    const from = now.getTime() - (rule.days + WINBACK_WINDOW_DAYS) * DAY;
    const to = now.getTime() - rule.days * DAY;
    const due = lastVisits.filter((v) => {
      const t = v._max.createdAt?.getTime() ?? 0;
      return t >= from && t <= to;
    });
    const lastBy = new Map(due.map((v) => [v.customerId!, v._max.createdAt!.toISOString().slice(0, 10)]));
    // Motivo = fecha de la última visita: si vuelve y se vuelve a ausentar, es otra ausencia y otro aviso
    return (await consenting(rule.tenantId, [...lastBy.keys()])).map((customer) => ({ customer, reasonKey: lastBy.get(customer.id)! }));
  },
};

/** "Gracias por venir": al día siguiente de una visita (mesa cerrada hace entre 12 y 36 horas) */
const thankYou: AutomationStrategy = {
  kind: "THANK_YOU",
  label: "Gracias por venir",
  defaults: { days: 1, title: "Gracias por venir", body: "Gracias por elegirnos. Si te gustó, nos ayuda mucho que lo cuentes." },
  async findCandidates(rule, now) {
    const sessions = await prisma.tableSession.findMany({
      where: { tenantId: rule.tenantId, status: "CLOSED", closedAt: { gte: new Date(now.getTime() - 36 * 3600_000), lte: new Date(now.getTime() - 12 * 3600_000) } },
      select: { id: true, orders: { where: { customerId: { not: null }, status: { in: [...COUNTED] } }, select: { customerId: true } } },
    });
    const sessionBy = new Map<string, string>();
    for (const s of sessions) for (const o of s.orders) sessionBy.set(o.customerId!, s.id);
    return (await consenting(rule.tenantId, [...sessionBy.keys()])).map((customer) => ({ customer, reasonKey: sessionBy.get(customer.id)! }));
  },
};

export const STRATEGIES: Record<AutomationKind, AutomationStrategy> = { WINBACK: winback, THANK_YOU: thankYou };
