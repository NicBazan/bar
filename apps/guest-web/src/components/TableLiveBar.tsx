"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OrdersSheet } from "@/features/ordering/OrdersSheet";
import { useLiveTable } from "@/features/ordering/useLiveTable";
import { Toasts } from "./Sheet";

/**
 * Franja de estado de la mesa en la carta: PIN para sumar amigos, aviso de "esperando al mozo",
 * pedidos con su estado en vivo y botones de llamar al mozo / pedir la cuenta.
 * Expone el estado de la sesión al carrito vía evento para que no deje enviar con la mesa cerrada.
 */
export function TableLiveBar({ tag, currency }: { tag?: string; currency: string }) {
  const live = useLiveTable(tag);
  const [showOrders, setShowOrders] = useState(false);
  const [showWifi, setShowWifi] = useState(false);
  const s = live.session;
  const isOpen = s?.status === "OPEN" || s?.status === "BILL_REQUESTED";

  // Se emite recién cuando llega el estado real (async), así el carrito ya está escuchando
  const sessionStatus = s?.status;
  useEffect(() => {
    if (!sessionStatus) return;
    window.dispatchEvent(new CustomEvent("bar:session", { detail: { open: isOpen } }));
  }, [sessionStatus, isOpen]);

  // El carrito avisa cuando envió un pedido: refrescar para que aparezca en "Pedidos"
  const { refresh } = live;
  useEffect(() => {
    const onSent = () => void refresh();
    window.addEventListener("bar:order-sent", onSent);
    return () => window.removeEventListener("bar:order-sent", onSent);
  }, [refresh]);

  if (!tag) return null;

  if (live.status === "no_session" || live.status === "closed") {
    return (
      <div className="mb-4 rounded-2xl border border-line bg-surface p-4 text-sm">
        <p className="text-cream">{live.status === "closed" ? "Esta mesa ya se cerró. ¡Gracias por venir!" : "Estás viendo la carta."}</p>
        <Link href={`/t/${tag}`} className="mt-2 inline-block font-semibold text-amber">
          {live.status === "closed" ? "Volver a sentarme →" : "Unirme a la mesa para pedir →"}
        </Link>
      </div>
    );
  }
  if (!s) return null;

  const activeOrders = s.orders.filter((o) => o.status === "PENDING_APPROVAL" || o.status === "APPROVED").length;

  return (
    <>
      <Toasts items={live.notices} />

      {s.status === "PENDING" ? (
        <div className="mb-4 rounded-2xl border border-amber/40 bg-amber/10 p-4 text-sm">
          <p className="font-semibold text-amber">Esperando que el mozo abra la mesa {s.table.label}</p>
          <p className="mt-1 text-cream/80">Mientras tanto mirá la carta y armá tu pedido.</p>
          <Pin pin={s.pin} />
        </div>
      ) : (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-3">
          <div className="grid grid-cols-3 gap-2 text-xs font-medium">
            <button onClick={() => live.callService("WAITER")} className="rounded-xl bg-surface-2 py-2.5">🙋 Mozo</button>
            <button onClick={() => live.callService("BILL")} className="rounded-xl bg-surface-2 py-2.5">🧾 Cuenta</button>
            <button onClick={() => setShowOrders(true)} className="relative rounded-xl bg-surface-2 py-2.5">
              📋 Pedidos
              {activeOrders > 0 && (
                <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-amber text-[10px] font-bold text-amber-ink">
                  {activeOrders}
                </span>
              )}
            </button>
          </div>
          {(s.hub?.wifi || (s.hub?.googleReviewUrl && s.orders.length > 0)) && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-medium">
              {s.hub?.wifi && (
                <button onClick={() => setShowWifi(true)} className="rounded-xl bg-surface-2 py-2.5">📶 Wi-Fi</button>
              )}
              {s.hub?.googleReviewUrl && s.orders.length > 0 && (
                <a
                  href={s.hub.googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`rounded-xl bg-surface-2 py-2.5 text-center ${s.hub?.wifi ? "" : "col-span-2"}`}
                >
                  ⭐ Dejanos tu reseña
                </a>
              )}
            </div>
          )}
          <Pin pin={s.pin} compact />
        </div>
      )}

      {showWifi && s.hub?.wifi && <WifiSheet wifi={s.hub.wifi} onClose={() => setShowWifi(false)} onCopied={() => live.notify("Clave copiada ✅", "success")} />}

      {showOrders && <OrdersSheet orders={s.orders} currency={currency} onClose={() => setShowOrders(false)} />}
    </>
  );
}

function Pin({ pin, compact }: { pin: string; compact?: boolean }) {
  return (
    <p className={compact ? "mt-2 text-center text-[11px] text-muted" : "mt-3 text-xs text-cream/70"}>
      ¿Vienen más amigos? Para unirse necesitan el PIN{" "}
      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-bold tracking-widest text-cream">{pin}</span>
    </p>
  );
}

function WifiSheet({ wifi, onClose, onCopied }: { wifi: { ssid: string; password: string }; onClose: () => void; onCopied: () => void }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(wifi.password);
      onCopied();
    } catch {
      /* sin portapapeles (HTTP): la clave queda visible para copiar a mano */
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Wi-Fi del local">
      <button aria-label="Cerrar" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet relative w-full max-w-md rounded-t-3xl border-t border-line bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <h2 className="font-display text-xl">📶 Wi-Fi del local</h2>
        <p className="mt-3 text-xs text-muted">Red</p>
        <p className="font-mono text-lg text-cream">{wifi.ssid}</p>
        {wifi.password && (
          <>
            <p className="mt-3 text-xs text-muted">Contraseña</p>
            <p className="font-mono text-lg break-all text-cream select-all">{wifi.password}</p>
          </>
        )}
        <p className="mt-3 text-xs text-muted">Abrí los ajustes de Wi-Fi del celular, elegí la red y pegá la contraseña.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {wifi.password && (
            <button onClick={copy} className="h-12 rounded-2xl bg-amber text-sm font-semibold text-amber-ink">Copiar contraseña</button>
          )}
          <button onClick={onClose} className={`h-12 rounded-2xl border border-line text-sm ${wifi.password ? "" : "col-span-2"}`}>Listo</button>
        </div>
      </div>
    </div>
  );
}
