"use client";

import { useEffect, useState } from "react";
import { Btn, Modal } from "@/components/ui";
import { ApiError, api, formatMoney } from "@/lib/api";

/** Comprobante de consumo tal como lo arma la API (los totales nunca se calculan en el navegador) */
export type Receipt = {
  kind: "PROVISIONAL" | "FINAL";
  number: number | null;
  title: string;
  venue: { name: string; address: string | null };
  table: string;
  openedAt: string;
  closedAt: string | null;
  timezone?: string;
  lines: Array<{ quantity: number; description: string; unitCents: number; subtotalCents: number }>;
  notBilled: Array<{ quantity: number; description: string; reason: string }>;
  totalCents: number;
  legend: string;
};

const dateTime = (iso: string, timeZone?: string) => new Date(iso).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", timeZone });

/**
 * Cuenta de una mesa para el mozo o la caja. Si llega `receipt` (recién cerrada) se muestra ese;
 * si no, se pide a la API (cuenta provisoria de una mesa abierta).
 */
export function SessionReceipt({ sessionId, receipt: given, onClose }: { sessionId: string; receipt?: Receipt; onClose: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(given ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (given) return;
    api<Receipt>(`/staff/sessions/${sessionId}/receipt`)
      .then(setReceipt)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Sin conexión"));
  }, [sessionId, given]);

  return (
    <Modal
      open
      title={receipt?.title ?? "Cuenta de la mesa"}
      onClose={onClose}
      footer={receipt && <Btn kind="primary" onClick={() => window.print()}>Imprimir</Btn>}
    >
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      {!receipt && !error && <p className="text-sm text-muted">Cargando…</p>}
      {receipt && <ReceiptBody receipt={receipt} />}
    </Modal>
  );
}

function ReceiptBody({ receipt }: { receipt: Receipt }) {
  return (
    <div className="grid gap-3 text-sm">
      <div className="border-l-4 border-l-amber pl-3">
        <p className="font-semibold">{receipt.venue.name}</p>
        {receipt.venue.address && <p className="text-xs text-muted">{receipt.venue.address}</p>}
        <p className="text-xs text-muted">
          Mesa {receipt.table} · abierta {dateTime(receipt.openedAt, receipt.timezone)}
          {receipt.closedAt && ` · cerrada ${dateTime(receipt.closedAt, receipt.timezone)}`}
        </p>
      </div>
      <table className="w-full">
        <tbody>
          {receipt.lines.map((l) => (
            <tr key={`${l.description}-${l.unitCents}`} className="border-t border-line align-top">
              <td className="py-1.5 pr-2 tabular-nums">{l.quantity}</td>
              <td className="py-1.5 pr-2">
                {l.description}
                {l.quantity > 1 && <span className="block text-xs text-muted">{formatMoney(l.unitCents)} c/u</span>}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(l.subtotalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {receipt.lines.length === 0 && <p className="text-muted">No hay consumos confirmados.</p>}
      {receipt.notBilled.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-muted">
          {receipt.notBilled.map((l, i) => (
            <li key={i}>
              <span className="line-through">{l.quantity} × {l.description}</span> · {l.reason}
            </li>
          ))}
        </ul>
      )}
      <p className="flex justify-between border-t border-line pt-2 text-lg font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatMoney(receipt.totalCents)}</span>
      </p>
      <p className="text-xs text-muted">{receipt.legend}</p>
    </div>
  );
}
