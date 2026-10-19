"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/storage";
import type { useCart } from "./useCart";

export function CartSheet({ cart, currency, sessionOpen, onClose, onSubmit }: {
  cart: ReturnType<typeof useCart>;
  currency: string;
  sessionOpen: boolean;
  onClose: () => void;
  onSubmit: (note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await onSubmit(note.trim() || undefined);
    } catch (e) {
      setError(e instanceof ApiError ? (e.message ?? e.code) : "Sin conexión. Tu pedido quedó guardado, probá de nuevo.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Tu pedido"
      footer={
        <>
          {error && <p className="mb-2 text-sm text-warn">{error}</p>}
          <button
            onClick={send}
            disabled={cart.count === 0 || sending || !sessionOpen}
            className="h-12 w-full rounded-full bg-amber font-semibold text-amber-ink disabled:opacity-40"
          >
            {!sessionOpen ? "Esperando que abran la mesa…" : sending ? "Enviando…" : `Enviar al mozo · ${formatMoney(cart.totalCents, currency)}`}
          </button>
          <p className="mt-2 text-center text-xs text-muted">El mozo confirma el pedido antes de mandarlo a cocina.</p>
        </>
      }
    >
      {cart.lines.length === 0 ? (
        <p className="py-8 text-center text-muted">Todavía no agregaste nada.</p>
      ) : (
        <ul className="divide-y divide-line">
          {cart.lines.map((l) => (
            <li key={l.lineId} className="flex items-start gap-3 py-3">
              <div className="flex-1">
                <p className="font-medium">{l.name}{l.variantName && <span className="text-muted"> · {l.variantName}</span>}</p>
                {l.modifierNames.length > 0 && <p className="text-sm text-muted">{l.modifierNames.join(", ")}</p>}
                {l.note && <p className="text-sm text-muted italic">“{l.note}”</p>}
                <p className="mt-1 text-sm">{formatMoney(l.unitPriceCents * l.quantity, currency)}</p>
              </div>
              <div className="flex items-center rounded-full bg-surface-2">
                <button aria-label="Quitar uno" className="h-9 w-9" onClick={() => cart.setQty(l.lineId, l.quantity - 1)}>−</button>
                <span className="w-5 text-center text-sm">{l.quantity}</span>
                <button aria-label="Sumar uno" className="h-9 w-9" onClick={() => cart.setQty(l.lineId, Math.min(20, l.quantity + 1))}>+</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cart.lines.length > 0 && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder="Nota para el mozo (opcional)"
          className="mt-3 w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-amber"
        />
      )}
    </Sheet>
  );
}
