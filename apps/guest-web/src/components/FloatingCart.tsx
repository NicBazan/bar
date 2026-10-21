"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { formatMoney, load, remove, save, uuid } from "@/lib/storage";
import { useCartStore } from "@/store/cartStore";

interface FloatingCartProps {
  currency?: string;
  tag?: string;
}

export function FloatingCart({ currency = "ARS", tag }: FloatingCartProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [orderNote, setOrderNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);
  const getTotalPrice = useCartStore((state) => state.getTotalPrice);
  const getTotalItems = useCartStore((state) => state.getTotalItems);
  const bindToTable = useCartStore((state) => state.bindToTable);

  // El carrito pertenece a esta mesa: entrar a otra mesa empieza vacío
  useEffect(() => {
    if (tag) bindToTable(tag);
  }, [tag, bindToTable]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // "Pedir lo mismo" desde Mi cuenta llega con ?cart=1: se abre el carrito ya cargado
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cart") === "1") setIsOpen(true);
  }, []);

  // TableLiveBar avisa si la mesa ya está abierta (hasta que el mozo la abra no se puede enviar)
  const [sessionOpen, setSessionOpen] = useState<boolean | null>(null);
  useEffect(() => {
    const onSession = (e: Event) => setSessionOpen((e as CustomEvent<{ open: boolean }>).detail.open);
    window.addEventListener("bar:session", onSession);
    return () => window.removeEventListener("bar:session", onSession);
  }, []);
  const waitingForWaiter = sessionOpen === false;

  const totalItems = getTotalItems();
  const totalPrice = getTotalPrice();

  const handleSendOrder = async () => {
    if (items.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // Token de respaldo si está almacenado en memoria local
      const storedToken = tag ? load<string | null>(`bar.token.${tag}`, null) : null;

      const bodyPayload = {
        items: items.map((item) => ({
          dishId: item.dishId,
          variantId: item.variantId,
          modifierIds: item.modifierIds,
          quantity: item.quantity,
          note: item.note,
        })),
        note: orderNote.trim() || undefined,
      };

      // Idempotencia: si se corta la red y el comensal reintenta el MISMO pedido, se reusa la key
      // y la API devuelve el pedido ya creado en vez de duplicarlo en cocina.
      const pendingKey = `bar.pendingOrder.${tag ?? "sin-mesa"}`;
      const serialized = JSON.stringify(bodyPayload);
      const pending = load<{ key: string; body: string } | null>(pendingKey, null);
      const idempotencyKey = pending?.body === serialized ? pending.key : uuid();
      save(pendingKey, { key: idempotencyKey, body: serialized });

      await api("/orders", {
        method: "POST",
        body: bodyPayload,
        token: storedToken,
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      });

      // Éxito: vaciamos carrito, cerramos sheet y mostramos confirmación
      remove(pendingKey);
      clearCart();
      window.dispatchEvent(new Event("bar:order-sent"));
      setOrderNote("");
      setIsOpen(false);
      setSuccessToast("¡Pedido enviado a cocina! El mozo lo confirmará a la brevedad.");
      setTimeout(() => setSuccessToast(null), 4500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMsg("Sesión vencida. Por favor escaneá el QR nuevamente.");
        } else if (err.status === 402) {
          setErrorMsg("El establecimiento no tiene el servicio disponible en este momento.");
        } else {
          setErrorMsg(err.message || "Error al registrar el pedido.");
        }
      } else {
        setErrorMsg("Falla de conexión al enviar el pedido. Por favor intentá nuevamente.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Si no hay ítems y no hay toast visible, no renderiza nada
  // El carrito vive en localStorage: hasta montar en el navegador se renderiza igual que en el
  // servidor (vacío); si no, React avisa "hydration mismatch" cuando hay ítems guardados
  if (!mounted || (totalItems === 0 && !successToast)) {
    return null;
  }

  return (
    <>
      {/* Toast flotante de éxito */}
      {successToast && (
        <div className="fixed top-6 right-0 left-0 z-50 mx-auto max-w-sm px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-ok/40 bg-surface-2 p-4 text-cream shadow-2xl backdrop-blur-xl animate-sheet">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ok/20 text-lg text-ok">
              ✓
            </span>
            <div className="text-xs font-medium leading-relaxed">{successToast}</div>
          </div>
        </div>
      )}

      {/* Barra adhesiva inferior si hay ítems en el carrito */}
      {totalItems > 0 && (
        <aside className="fixed right-0 bottom-4 left-0 z-40 mx-auto max-w-md px-4">
          <div className="flex items-center justify-between rounded-2xl border border-line bg-surface/95 p-3.5 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-amber/10 text-xl text-amber">
                🛒
                <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber text-[10px] font-bold text-amber-ink shadow-sm">
                  {totalItems}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-muted">Total del pedido</p>
                <p className="font-display text-base font-semibold text-cream">
                  {formatMoney(totalPrice, currency)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber to-warn px-5 py-2.5 text-xs font-semibold text-amber-ink shadow-md shadow-amber/20 transition-all duration-200 active:scale-95"
            >
              <span>Ver orden</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          </div>
        </aside>
      )}

      {/* Bottom Sheet Modal del Carrito */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:p-4 backdrop-blur-md animate-fade-in">
          <div className="relative flex max-h-[90vh] w-full max-w-md flex-col rounded-t-[32px] sm:rounded-3xl border-t sm:border border-line bg-surface p-6 shadow-2xl animate-sheet">
            {/* Tirador decorativo móvil */}
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-line/80 sm:hidden"></div>

            {/* Encabezado del Sheet */}
            <div className="flex items-center justify-between pb-4 border-b border-line/60">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">📋</span>
                <h2 className="font-display text-2xl font-medium text-cream">
                  Tu Pedido
                </h2>
                <span className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
                  {totalItems} {totalItems === 1 ? "ítem" : "ítems"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-cream transition"
              >
                ✕
              </button>
            </div>

            {/* Mensaje de error si falla el envío */}
            {errorMsg && (
              <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
                {errorMsg}
              </div>
            )}

            {/* Lista deslizable de platos seleccionados */}
            <div className="mt-4 flex-1 overflow-y-auto space-y-3.5 pr-1 no-scrollbar">
              {items.map((item) => (
                <div
                  key={item.lineId}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line/40 bg-surface-2/60 p-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-cream truncate">
                      {item.name}
                      {item.variantName && <span className="text-muted"> · {item.variantName}</span>}
                    </p>
                    {(item.modifierNames.length > 0 || item.note) && (
                      <p className="truncate text-[11px] text-muted">
                        {[item.modifierNames.join(", "), item.note && `“${item.note}”`].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-amber font-display">
                      {formatMoney(item.priceCents * item.quantity, currency)}
                    </p>
                  </div>

                  {/* Controles de Cantidad (+ / -) */}
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.lineId, item.quantity - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-sm text-muted hover:text-cream active:scale-95 transition"
                    >
                      -
                    </button>
                    <span className="w-5 text-center font-display text-sm font-semibold text-cream">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.lineId, item.quantity + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-sm text-muted hover:text-cream active:scale-95 transition"
                    >
                      +
                    </button>
                  </div>

                  {/* Botón eliminar plato */}
                  <button
                    type="button"
                    onClick={() => removeItem(item.lineId)}
                    className="p-1.5 text-muted hover:text-warn transition"
                    title="Eliminar del pedido"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>

            {/* Aclaraciones opcionales para la cocina */}
            <div className="mt-4">
              <label
                htmlFor="order-note"
                className="block text-[11px] font-medium text-muted uppercase tracking-wider mb-1.5"
              >
                Observaciones para cocina (opcional)
              </label>
              <textarea
                id="order-note"
                rows={2}
                placeholder="Ej: Sin sal, aderezo aparte..."
                value={orderNote}
                onChange={(e) => setOrderNote(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface-2 p-3 text-xs text-cream placeholder:text-muted/50 outline-none transition focus:border-amber focus:ring-1 focus:ring-amber/30 resize-none"
              />
            </div>

            {/* Resumen Final y Botón de Enviar a Cocina */}
            <div className="mt-5 border-t border-line/60 pt-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-muted">Total a abonar</span>
                <span className="font-display text-2xl font-semibold text-amber">
                  {formatMoney(totalPrice, currency)}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void handleSendOrder()}
                disabled={isSubmitting || items.length === 0 || waitingForWaiter}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber to-warn py-4 text-sm font-semibold text-amber-ink shadow-lg shadow-amber/25 transition-all duration-200 active:scale-95 disabled:opacity-40"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="h-5 w-5 animate-spin text-amber-ink"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8z"
                      ></path>
                    </svg>
                    Enviando a cocina...
                  </span>
                ) : (
                  <>
                    <span>{waitingForWaiter ? "Esperando que el mozo abra la mesa…" : "Confirmar y Enviar a Cocina"}</span>
                    <span>👨‍🍳</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
