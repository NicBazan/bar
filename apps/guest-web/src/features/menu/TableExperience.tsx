"use client";

import { useEffect, useRef, useState } from "react";
import { Toasts } from "@/components/Sheet";
import { ApiError, type Dish } from "@/lib/api";
import { formatMoney } from "@/lib/storage";
import { CartSheet } from "../ordering/CartSheet";
import { OrdersSheet } from "../ordering/OrdersSheet";
import { useCart } from "../ordering/useCart";
import { useTableSession } from "../ordering/useTableSession";
import { DishSheet } from "./DishSheet";

const CATEGORY_EMOJI: Record<string, string> = {
  "Para compartir": "🥔",
  Principales: "🥩",
  Postres: "🍮",
  Bebidas: "🍺",
};

export function TableExperience({ tag }: { tag: string }) {
  const t = useTableSession(tag);
  const cart = useCart(tag);
  const [dish, setDish] = useState<Dish | null>(null);
  const [sheet, setSheet] = useState<"cart" | "orders" | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  if (t.phase === "error") return <Centered emoji="😕" title="Ups" text={t.error ?? ""} />;
  if (t.phase === "closed") return <Centered emoji="👋" title="¡Gracias por venir!" text="Esta mesa ya se cerró. Escaneá de nuevo si volvés a sentarte." />;
  if (t.phase === "need_pin") return <PinGate tableLabel={t.tagInfo?.table.label} onSubmit={(pin) => t.join(pin)} />;
  if (t.phase === "loading" || !t.menu || !t.session) return <Skeleton />;

  const { menu, session } = t;
  const currency = menu.venue.currency;
  const isOpen = session.status === "OPEN" || session.status === "BILL_REQUESTED";
  const activeOrders = session.orders.filter((o) => o.status === "PENDING_APPROVAL" || o.status === "APPROVED").length;

  const submit = async (note?: string) => {
    await t.submitOrder({
      items: cart.lines.map((l) => ({
        dishId: l.dishId,
        variantId: l.variantId,
        modifierIds: l.modifierIds,
        quantity: l.quantity,
        note: l.note,
      })),
      note,
    });
    cart.clear();
    setSheet("orders");
    t.notify("¡Pedido enviado! El mozo lo va a confirmar.", "success");
  };

  return (
    <main className="mx-auto max-w-md pb-36">
      <Toasts items={t.notices} />

      <header className="px-5 pt-6 pb-3">
        <p className="text-sm text-muted">Mesa {session.table.label}</p>
        <h1 className="font-display text-3xl leading-tight">{menu.venue.name}</h1>
      </header>

      {session.status === "PENDING" && (
        <div className="mx-5 mb-3 rounded-2xl border border-amber/40 bg-amber/10 p-4 text-sm">
          <p className="font-semibold text-amber">Esperando que el mozo abra la mesa</p>
          <p className="mt-1 text-cream/80">Mientras tanto mirá la carta y armá tu pedido.</p>
          <PinHint pin={session.pin} />
        </div>
      )}
      {isOpen && <div className="mx-5 mb-3"><PinHint pin={session.pin} compact /></div>}

      <CategoryNav
        categories={menu.categories}
        active={activeCat}
        onChange={setActiveCat}
      />

      <div className="grid gap-8 px-5 pt-4">
        {menu.categories.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} data-cat={c.id} className="scroll-mt-16">
            <h2 className="mb-3 font-display text-2xl">{c.name}</h2>
            <ul className="grid gap-3">
              {c.dishes.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setDish(d)}
                    className="flex w-full items-center gap-4 rounded-3xl border border-line bg-surface p-3 text-left transition active:scale-[0.99]"
                  >
                    <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-surface-2 to-ink text-3xl">
                      {d.assets.POSTER ? <img src={d.assets.POSTER} alt="" className="h-full w-full rounded-2xl object-cover" /> : CATEGORY_EMOJI[c.name] ?? "🍽️"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{d.name}</p>
                      {d.description && <p className="line-clamp-2 text-sm text-muted">{d.description}</p>}
                      <p className="mt-1 text-sm font-medium text-amber">
                        {d.variants.length > 0 ? `desde ${formatMoney(Math.min(...d.variants.map((v) => v.priceCents)), currency)}` : formatMoney(d.priceCents, currency)}
                        {!d.available && <span className="ml-2 text-warn">· agotado</span>}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* Barra inferior: llamados + pedidos + carrito */}
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-md border-t border-line bg-ink/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mb-2 grid grid-cols-3 gap-2 text-sm">
          <button disabled={!isOpen} onClick={() => t.callService("WAITER")} className="rounded-full bg-surface-2 py-2 disabled:opacity-40">🙋 Mozo</button>
          <button disabled={!isOpen} onClick={() => t.callService("BILL")} className="rounded-full bg-surface-2 py-2 disabled:opacity-40">🧾 Cuenta</button>
          <button onClick={() => setSheet("orders")} className="relative rounded-full bg-surface-2 py-2">
            📋 Pedidos
            {activeOrders > 0 && <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-amber text-xs font-bold text-amber-ink">{activeOrders}</span>}
          </button>
        </div>
        <button
          onClick={() => setSheet("cart")}
          disabled={cart.count === 0}
          className="flex h-12 w-full items-center justify-between rounded-full bg-amber px-5 font-semibold text-amber-ink disabled:bg-surface-2 disabled:text-muted"
        >
          <span>{cart.count > 0 ? `Ver pedido (${cart.count})` : "Elegí algo de la carta"}</span>
          {cart.count > 0 && <span>{formatMoney(cart.totalCents, currency)}</span>}
        </button>
      </nav>

      {dish && <DishSheet dish={dish} currency={currency} canAdd onClose={() => setDish(null)} onAdd={(l) => { cart.add(l); t.notify(`Agregaste ${l.name}`); }} />}
      {sheet === "cart" && <CartSheet cart={cart} currency={currency} sessionOpen={isOpen} onClose={() => setSheet(null)} onSubmit={submit} />}
      {sheet === "orders" && <OrdersSheet orders={session.orders} currency={currency} onClose={() => setSheet(null)} />}
    </main>
  );
}

function CategoryNav({ categories, active, onChange }: {
  categories: Array<{ id: string; name: string }>;
  active: string | null;
  onChange: (id: string) => void;
}) {
  // Resalta la categoría visible mientras se scrollea
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) onChange((top.target as HTMLElement).dataset.cat!);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    document.querySelectorAll("[data-cat]").forEach((el) => observer.current?.observe(el));
    return () => observer.current?.disconnect();
  }, [categories, onChange]);

  return (
    <div className="no-scrollbar sticky top-0 z-20 flex gap-2 overflow-x-auto bg-ink/95 px-5 py-3 backdrop-blur">
      {categories.map((c) => (
        <a
          key={c.id}
          href={`#cat-${c.id}`}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm transition ${active === c.id ? "bg-cream text-ink" : "bg-surface-2 text-muted"}`}
        >
          {c.name}
        </a>
      ))}
    </div>
  );
}

function PinHint({ pin, compact }: { pin: string; compact?: boolean }) {
  return (
    <p className={`${compact ? "text-xs text-muted" : "mt-3 text-xs text-cream/70"}`}>
      ¿Vienen más amigos? Para unirse a la mesa necesitan el PIN{" "}
      <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono font-bold tracking-widest text-cream">{pin}</span>
    </p>
  );
}

function PinGate({ tableLabel, onSubmit }: { tableLabel?: string; onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "PIN_INVALID" ? "PIN incorrecto" : "No pudimos conectar");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6">
      <div className="text-5xl">🔐</div>
      <h1 className="font-display text-3xl">Unite a la mesa {tableLabel}</h1>
      <p className="text-muted">Alguien ya abrió esta mesa. Pedile el PIN de 4 números que ve en su celular.</p>
      <input
        inputMode="numeric"
        autoFocus
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        className="h-16 rounded-2xl border border-line bg-surface text-center font-mono text-3xl tracking-[0.5em] outline-none focus:border-amber"
        aria-label="PIN de la mesa"
      />
      {error && <p className="text-warn">{error}</p>}
      <button disabled={pin.length !== 4 || busy} onClick={go} className="h-12 rounded-full bg-amber font-semibold text-amber-ink disabled:opacity-40">
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </main>
  );
}

function Centered({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-5xl">{emoji}</div>
      <h1 className="font-display text-3xl">{title}</h1>
      <p className="text-muted">{text}</p>
    </main>
  );
}

function Skeleton() {
  return (
    <main className="mx-auto max-w-md animate-pulse px-5 pt-6">
      <div className="h-4 w-20 rounded bg-surface-2" />
      <div className="mt-2 h-8 w-56 rounded bg-surface-2" />
      <div className="mt-6 flex gap-2">{[1, 2, 3].map((i) => <div key={i} className="h-8 w-24 rounded-full bg-surface-2" />)}</div>
      <div className="mt-6 grid gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-26 rounded-3xl bg-surface" />)}</div>
    </main>
  );
}
