import type { Tx } from "../../shared/db/index.js";
import { prisma } from "../../shared/db/index.js";

/**
 * Comprobante de consumo de una mesa.
 *
 * Pensado para que se entienda solo, hoy o dentro de un mes desde "Mi cuenta":
 * - Encabezado: local, dirección, mesa, número correlativo del local, fecha y hora de apertura y cierre.
 * - Líneas agrupadas: "2 × Pinta IPA (Grande) · extra limón" con precio unitario y subtotal.
 * - Lo que NO se cobra aparece aparte y con el motivo (rechazado por el mozo, anulado, sin confirmar).
 * - Total, moneda y leyenda: no es factura.
 *
 * Pure Fabrication (GRASP): `buildReceipt` es una función pura sobre una foto de la sesión, sin base ni HTTP.
 * Mientras la mesa está abierta se calcula al vuelo ("Cuenta provisoria"); al cerrarla se numera y se
 * guarda una copia fija (`TableSession.receipt`): nunca cambia, aunque cambien la carta o el local.
 */

export const RECEIPT_LEGEND = "Comprobante de consumo. No válido como factura.";

const BILLABLE = new Set(["APPROVED", "FIRED", "IN_PROGRESS", "READY", "SERVED"]);
const NOT_BILLED_REASON: Record<string, string> = {
  PENDING_APPROVAL: "Sin confirmar por el mozo",
  REJECTED: "Rechazado por el mozo",
  VOIDED: "Anulado",
};

export type ReceiptLine = { quantity: number; description: string; unitCents: number; subtotalCents: number };
export type NotBilledLine = { quantity: number; description: string; reason: string };

export type Receipt = {
  kind: "PROVISIONAL" | "FINAL";
  number: number | null;
  title: string;
  venue: { name: string; address: string | null };
  table: string;
  openedAt: string;
  closedAt: string | null;
  currency: string;
  // Zona horaria del local: las horas se muestran como en el local, no como en el celular de un turista
  timezone: string;
  lines: ReceiptLine[];
  notBilled: NotBilledLine[];
  units: number;
  totalCents: number;
  legend: string;
};

export type ReceiptSource = {
  venue: { name: string; address: string | null; currency: string; timezone: string };
  tableLabel: string;
  openedAt: Date;
  closedAt: Date | null;
  orders: Array<{ status: string; rejectReason: string | null; items: ReceiptItemSource[] }>;
};

type ReceiptItemSource = {
  nameSnapshot: string;
  variantName: string | null;
  modifiers: unknown;
  unitPriceCents: number;
  quantity: number;
  status: string;
  voidReason: string | null;
};

export function describeItem(i: Pick<ReceiptItemSource, "nameSnapshot" | "variantName" | "modifiers">): string {
  const extras = Array.isArray(i.modifiers) ? (i.modifiers as Array<{ name: string }>).map((m) => m.name) : [];
  const variant = i.variantName ? ` (${i.variantName})` : "";
  return `${i.nameSnapshot}${variant}${extras.length ? ` · ${extras.join(", ")}` : ""}`;
}

/** Junta ítems iguales (misma descripción y precio unitario) en una sola línea */
function groupLines(items: ReceiptItemSource[]): ReceiptLine[] {
  const byKey = new Map<string, ReceiptLine>();
  for (const i of items) {
    const description = describeItem(i);
    const key = `${description}|${i.unitPriceCents}`;
    const line = byKey.get(key) ?? { quantity: 0, description, unitCents: i.unitPriceCents, subtotalCents: 0 };
    line.quantity += i.quantity;
    line.subtotalCents += i.unitPriceCents * i.quantity;
    byKey.set(key, line);
  }
  return [...byKey.values()];
}

function notBilledLines(source: ReceiptSource): NotBilledLine[] {
  return source.orders.flatMap((o) =>
    o.items
      .filter((i) => !BILLABLE.has(i.status))
      .map((i) => ({
        quantity: i.quantity,
        description: describeItem(i),
        reason: i.voidReason ?? (i.status === "REJECTED" && o.rejectReason ? `Rechazado: ${o.rejectReason}` : NOT_BILLED_REASON[i.status] ?? "No se cobra"),
      })),
  );
}

export function buildReceipt(source: ReceiptSource, number: number | null): Receipt {
  const billable = source.orders.flatMap((o) => o.items.filter((i) => BILLABLE.has(i.status)));
  const lines = groupLines(billable);
  const final = number !== null;
  return {
    kind: final ? "FINAL" : "PROVISIONAL",
    number,
    title: final ? `Comprobante N.º ${String(number).padStart(6, "0")}` : "Cuenta provisoria",
    venue: { name: source.venue.name, address: source.venue.address },
    table: source.tableLabel,
    openedAt: source.openedAt.toISOString(),
    closedAt: source.closedAt?.toISOString() ?? null,
    currency: source.venue.currency,
    timezone: source.venue.timezone,
    lines,
    notBilled: notBilledLines(source),
    units: lines.reduce((s, l) => s + l.quantity, 0),
    totalCents: lines.reduce((s, l) => s + l.subtotalCents, 0),
    legend: RECEIPT_LEGEND,
  };
}

async function loadSource(db: Tx | typeof prisma, sessionId: string): Promise<ReceiptSource & { venueId: string }> {
  const s = await db.tableSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      venue: { select: { name: true, address: true, currency: true, timezone: true } },
      table: { select: { label: true } },
      orders: { orderBy: { createdAt: "asc" }, select: { status: true, rejectReason: true, items: true } },
    },
  });
  return { venueId: s.venueId, venue: s.venue, tableLabel: s.table.label, openedAt: s.openedAt, closedAt: s.closedAt, orders: s.orders };
}

/**
 * Numera y guarda el comprobante final (dentro de la transacción que cierra la mesa).
 * El número sale de un UPDATE ... RETURNING atómico sobre el local, más un UNIQUE (venueId, receiptNumber):
 * dos cierres simultáneos nunca reciben el mismo número.
 */
export async function issueFinalReceipt(tx: Tx, sessionId: string): Promise<Receipt> {
  const source = await loadSource(tx, sessionId);
  const rows = await tx.$queryRaw<Array<{ receiptSeq: number }>>`
    UPDATE "Venue" SET "receiptSeq" = "receiptSeq" + 1 WHERE id = ${source.venueId}::uuid RETURNING "receiptSeq"`;
  const receiptSeq = rows[0]!.receiptSeq;
  const receipt = buildReceipt(source, receiptSeq);
  await tx.tableSession.update({ where: { id: sessionId }, data: { receiptNumber: receiptSeq, receipt } });
  return receipt;
}

/** Comprobante de una mesa: el guardado si ya cerró, o la cuenta provisoria calculada ahora */
export async function receiptOf(sessionId: string): Promise<Receipt> {
  const saved = await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId }, select: { receipt: true } });
  if (saved.receipt) return saved.receipt as unknown as Receipt;
  return buildReceipt(await loadSource(prisma, sessionId), null);
}
