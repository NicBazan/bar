import { prisma, type Tx } from "../../shared/db/index.js";

type Db = Tx | typeof prisma;

/** Solo los pedidos que el bar confirmó suman (rechazados o cancelados, no) */
const COUNTED: Array<"APPROVED" | "COMPLETED"> = ["APPROVED", "COMPLETED"];

export async function getProgram(db: Db, tenantId: string) {
  return db.loyaltyProgram.findUnique({
    where: { tenantId },
    include: { rewards: { orderBy: [{ position: "asc" }, { cost: "asc" }] } },
  });
}

/** Saldo en la unidad vigente del bar (sellos o puntos) */
export async function balanceOf(db: Db, customerId: string, mode: "STAMPS" | "POINTS") {
  const agg = await db.loyaltyEvent.aggregate({ where: { customerId, mode }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

/**
 * Suma sellos o puntos de una visita a cada cliente identificado en ella.
 * Idempotente (único por cliente + visita): se puede llamar al cerrar la mesa y de nuevo si
 * alguien guarda su cuenta después; nunca suma dos veces.
 */
export async function awardSession(tx: Tx, sessionId: string) {
  const session = await tx.tableSession.findUnique({ where: { id: sessionId }, select: { tenantId: true, status: true } });
  if (!session || session.status !== "CLOSED") return;
  const program = await tx.loyaltyProgram.findUnique({ where: { tenantId: session.tenantId } });
  if (!program?.active) return;

  const spent = await tx.order.groupBy({
    by: ["customerId"],
    where: { sessionId, tenantId: session.tenantId, customerId: { not: null }, status: { in: COUNTED } },
    _sum: { totalCents: true },
  });
  const rows = spent
    .map((s) => ({
      customerId: s.customerId!,
      amount: program.mode === "STAMPS" ? 1 : Math.floor((s._sum.totalCents ?? 0) / program.centsPerPoint),
    }))
    .filter((r) => r.amount > 0);
  if (rows.length === 0) return;

  await tx.loyaltyEvent.createMany({
    data: rows.map((r) => ({
      tenantId: session.tenantId,
      customerId: r.customerId,
      kind: "EARN" as const,
      mode: program.mode,
      amount: r.amount,
      sessionId,
    })),
    skipDuplicates: true,
  });
}

/** Resumen para la tarjeta del cliente y para el mozo */
export async function loyaltySummary(db: Db, tenantId: string, customerId: string) {
  const program = await getProgram(db, tenantId);
  if (!program?.active) return { active: false as const };
  const balance = await balanceOf(db, customerId, program.mode);
  const rewards = program.rewards
    .filter((r) => r.active)
    .map((r) => ({ id: r.id, name: r.name, cost: r.cost, canRedeem: balance >= r.cost }));
  // Próximo premio: el más barato que todavía no alcanza (o el más caro si ya alcanza todos)
  const next = rewards.find((r) => r.cost > balance) ?? rewards.at(-1) ?? null;
  return {
    active: true as const,
    mode: program.mode,
    centsPerPoint: program.centsPerPoint,
    balance,
    rewards,
    next: next ? { ...next, remaining: Math.max(0, next.cost - balance) } : null,
  };
}
