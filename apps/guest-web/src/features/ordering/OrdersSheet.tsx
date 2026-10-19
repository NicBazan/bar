"use client";

import { Sheet } from "@/components/Sheet";
import type { Order } from "@/lib/api";
import { formatMoney } from "@/lib/storage";

const ORDER_LABEL: Record<Order["status"], string> = {
  PENDING_APPROVAL: "Esperando confirmación del mozo",
  APPROVED: "Confirmado · en cocina",
  REJECTED: "Rechazado",
  COMPLETED: "Entregado",
  CANCELLED: "Cancelado",
};

const ITEM_LABEL: Record<string, { text: string; cls: string }> = {
  PENDING_APPROVAL: { text: "por confirmar", cls: "bg-surface-2 text-muted" },
  APPROVED: { text: "confirmado", cls: "bg-surface-2 text-cream" },
  FIRED: { text: "en cola", cls: "bg-surface-2 text-cream" },
  IN_PROGRESS: { text: "preparando", cls: "bg-amber/20 text-amber" },
  READY: { text: "¡listo!", cls: "bg-ok/20 text-ok" },
  SERVED: { text: "servido", cls: "bg-ok/10 text-ok/80" },
  REJECTED: { text: "rechazado", cls: "bg-warn/20 text-warn" },
  VOIDED: { text: "anulado", cls: "bg-warn/20 text-warn" },
};

export function OrdersSheet({ orders, currency, onClose }: { orders: Order[]; currency: string; onClose: () => void }) {
  const total = orders.filter((o) => o.status !== "REJECTED" && o.status !== "CANCELLED").reduce((s, o) => s + o.totalCents, 0);
  return (
    <Sheet open onClose={onClose} title="Pedidos de la mesa" footer={<p className="flex justify-between font-semibold"><span>Total de la mesa</span><span>{formatMoney(total, currency)}</span></p>}>
      {orders.length === 0 && <p className="py-8 text-center text-muted">La mesa todavía no pidió nada.</p>}
      <div className="grid gap-3">
        {[...orders].reverse().map((o) => (
          <article key={o.id} className="rounded-2xl border border-line p-4">
            <header className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{ORDER_LABEL[o.status]}</span>
              <span className="text-xs text-muted">
                {new Date(o.createdAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </header>
            {o.rejectReason && <p className="mb-2 text-sm text-warn">{o.rejectReason}</p>}
            <ul className="grid gap-1.5">
              {o.items.map((i) => {
                const label = ITEM_LABEL[i.status] ?? { text: i.status, cls: "bg-surface-2" };
                return (
                  <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {i.quantity}× {i.nameSnapshot}
                      {i.variantName && <span className="text-muted"> · {i.variantName}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${label.cls}`}>{label.text}</span>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </Sheet>
  );
}
