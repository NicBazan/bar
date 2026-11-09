"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/Sheet";
import { type Receipt, api } from "@/lib/api";
import { formatMoney, load } from "@/lib/storage";

const dateTime = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone });

/** Cuenta de la mesa en una hoja inferior: se pide a la API al abrirla (el total lo calcula el servidor) */
export function ReceiptSheet({ tag, onClose }: { tag?: string; onClose: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = tag ? load<string | null>(`bar.token.${tag}`, null) : null;
    api<Receipt>("/session/receipt", { token })
      .then(setReceipt)
      .catch(() => setError("No se pudo cargar la cuenta. Probá de nuevo o pedísela al mozo."));
  }, [tag]);

  const title = receipt?.title ?? "Cuenta de la mesa";
  return (
    <Sheet open onClose={onClose} title={title} footer={receipt && <ReceiptTotal receipt={receipt} />}>
      {error && <p role="alert" className="py-6 text-center text-sm text-warn">{error}</p>}
      {!receipt && !error && <p className="py-8 text-center text-sm text-muted">Cargando la cuenta…</p>}
      {receipt && <ReceiptView receipt={receipt} />}
    </Sheet>
  );
}

function ReceiptTotal({ receipt }: { receipt: Receipt }) {
  return (
    <div>
      <p className="flex items-baseline justify-between font-semibold">
        <span>Total {receipt.kind === "PROVISIONAL" ? "hasta ahora" : ""}</span>
        <span className="font-display text-2xl tabular-nums">{formatMoney(receipt.totalCents, receipt.currency)}</span>
      </p>
      <p className="mt-1 text-[11px] text-muted">{receipt.legend}</p>
    </div>
  );
}

/** Comprobante legible: encabezado, líneas agrupadas, lo que no se cobra y por qué */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const money = (c: number) => formatMoney(c, receipt.currency);
  return (
    <div className="grid gap-4 text-sm">
      <header className="rounded-xl border border-line border-l-4 border-l-amber bg-paper p-3">
        <p className="font-semibold">{receipt.venue.name}</p>
        {receipt.venue.address && <p className="text-xs text-muted">{receipt.venue.address}</p>}
        <p className="mt-2 text-xs text-muted">
          Mesa {receipt.table} · desde {dateTime(receipt.openedAt, receipt.timezone)}
          {receipt.closedAt && ` · cerrada ${dateTime(receipt.closedAt, receipt.timezone)}`}
        </p>
        {receipt.kind === "PROVISIONAL" && (
          <p className="mt-2 text-xs text-cream">Es la cuenta hasta ahora. Al cerrar la mesa, el mozo emite el comprobante numerado.</p>
        )}
      </header>

      {receipt.lines.length === 0 ? (
        <p className="py-4 text-center text-muted">Todavía no hay nada confirmado para cobrar.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-[11px] text-muted">
            <tr>
              <th className="pb-1 font-normal">Cant.</th>
              <th className="pb-1 font-normal">Detalle</th>
              <th className="pb-1 text-right font-normal">Importe</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((l) => (
              <tr key={`${l.description}-${l.unitCents}`} className="border-t border-line align-top">
                <td className="py-2 pr-2 tabular-nums">{l.quantity}</td>
                <td className="py-2 pr-2">
                  {l.description}
                  {l.quantity > 1 && <span className="block text-[11px] text-muted">{money(l.unitCents)} c/u</span>}
                </td>
                <td className="py-2 text-right tabular-nums">{money(l.subtotalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {receipt.notBilled.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-muted">No se cobra</h3>
          <ul className="grid gap-1">
            {receipt.notBilled.map((l, i) => (
              <li key={i} className="flex justify-between gap-3 text-xs text-muted">
                <span className="line-through">{l.quantity} × {l.description}</span>
                <span className="shrink-0">{l.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
