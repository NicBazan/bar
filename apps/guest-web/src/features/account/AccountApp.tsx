"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { type Me, type ReorderItem, type Visit, clearCustomerToken, customerApi, getCustomerToken, linkVisitIfLoggedIn } from "@/lib/customer";
import { formatMoney } from "@/lib/storage";
import { useCartStore } from "@/store/cartStore";
import { LoginScreen } from "./LoginScreen";

export type Tab = "home" | "history" | "promos" | "profile";
const TABS: Tab[] = ["home", "history", "promos", "profile"];

type Props = {
  venueId: string;
  venueName: string;
  logoUrl: string | null;
  currency: string;
  tag?: string;
  initialTab?: string;
};

/** "Mi cuenta" del cliente: estilo billetera con los colores de ZainSoft */
export function AccountApp(props: Props) {
  const { venueId, tag } = props;
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(TABS.includes(props.initialTab as Tab) ? (props.initialTab as Tab) : "home");
  const [me, setMe] = useState<Me | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setToken(getCustomerToken(venueId)), [venueId]);

  const notify = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      if (tag) await linkVisitIfLoggedIn(venueId, tag);
      const [m, h] = await Promise.all([
        customerApi<Me>(venueId, "/customer/me"),
        customerApi<Visit[]>(venueId, "/customer/me/history"),
      ]);
      setMe(m);
      setVisits(h);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setToken(null);
      else notify("Sin conexión. Probá de nuevo en un rato.");
    }
  }, [venueId, tag, notify]);

  useEffect(() => {
    if (token) void loadAll();
  }, [token, loadAll]);

  if (token === undefined) return <main className="min-h-dvh bg-paper" />;
  if (!token) return <LoginScreen {...props} onDone={setToken} />;

  const logout = () => {
    clearCustomerToken(venueId);
    setMe(null);
    setVisits(null);
    setToken(null);
  };

  return (
    <div className="min-h-dvh bg-paper text-night">
      <main className="mx-auto max-w-md px-5 pt-6 pb-32">
        {tab === "home" && <HomeTab {...props} me={me} visits={visits} go={setTab} />}
        {tab === "history" && <HistoryTab {...props} visits={visits} notify={notify} />}
        {tab === "promos" && <PromosTab {...props} />}
        {tab === "profile" && <ProfileTab {...props} me={me} onSaved={loadAll} onLogout={logout} notify={notify} />}
      </main>

      {toast && (
        <div role="status" className="fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[90%] rounded-2xl bg-night px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <BottomNav tab={tab} setTab={setTab} />
    </div>
  );
}

// ───── Piezas comunes ─────

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: Array<{ id: Tab; label: string; icon: string }> = [
    { id: "home", label: "Inicio", icon: "⌂" },
    { id: "history", label: "Historial", icon: "☰" },
    { id: "promos", label: "Promos", icon: "%" },
    { id: "profile", label: "Perfil", icon: "◯" },
  ];
  return (
    <nav aria-label="Secciones de Mi cuenta" className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-md items-center justify-between rounded-[28px] bg-night p-2 shadow-2xl">
        {items.map((it) => {
          const active = tab === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              aria-current={active ? "page" : undefined}
              className={`flex h-12 min-w-12 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition ${
                active ? "bg-brand text-white" : "text-white/60"
              }`}
            >
              <span aria-hidden className="text-base">{it.icon}</span>
              {active && <span>{it.label}</span>}
              {!active && <span className="sr-only">{it.label}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Avatar({ name, email }: { name: string | null; email?: string }) {
  const letter = (name || email || "?").trim().charAt(0).toUpperCase();
  return (
    <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand text-lg font-bold text-white ring-4 ring-white">
      {letter}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const thisMonth = (iso: string) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
};

// ───── Inicio ─────

function HomeTab({ venueId, venueName, currency, tag, me, visits, go }: Props & {
  me: Me | null;
  visits: Visit[] | null;
  go: (t: Tab) => void;
}) {
  const menuHref = tag ? `/v/${venueId}/menu?tag=${tag}` : `/v/${venueId}/menu`;
  const monthVisits = visits?.filter((v) => thisMonth(v.date)).length ?? 0;
  const firstName = me?.name?.split(" ")[0];

  return (
    <>
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-night/60">Hola de nuevo,</p>
          <h1 className="text-2xl font-semibold">{firstName ?? "¡bienvenido!"}</h1>
        </div>
        <Avatar name={me?.name ?? null} email={me?.email} />
      </header>

      <section className="mt-5 rounded-[28px] bg-night p-6 text-white shadow-xl" aria-label="Tus visitas">
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>{venueName}</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1">Mi cuenta</span>
        </div>
        <p className="mt-4 text-sm text-white/60">Tus visitas</p>
        <p className="text-5xl font-semibold tracking-tight">{me?.stats.visits ?? "–"}</p>
        <p className="mt-2 text-sm">
          <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-semibold">+{monthVisits} este mes</span>
          <span className="ml-2 text-white/60">{formatMoney(me?.stats.spentCents ?? 0, currency)} en total</span>
        </p>
      </section>

      <section className="mt-5 grid grid-cols-4 gap-2 text-center" aria-label="Accesos rápidos">
        <QuickAction href={menuHref} icon="🍽" label="Carta" />
        <QuickAction onClick={() => go("history")} icon="↺" label="Pedir de nuevo" />
        <QuickAction onClick={() => go("promos")} icon="%" label="Promos" />
        <QuickAction onClick={() => go("profile")} icon="◯" label="Perfil" />
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Actividad reciente</h2>
          {visits && visits.length > 0 && (
            <button onClick={() => go("history")} className="h-11 px-2 text-sm font-medium text-brand">Ver todo</button>
          )}
        </div>
        {visits === null ? (
          <p className="mt-3 text-sm text-night/50">Cargando…</p>
        ) : visits.length === 0 ? (
          <div className="mt-3 rounded-3xl bg-white p-5 text-sm text-night/60 shadow-sm">
            Todavía no hay visitas. La próxima vez que pidas desde la mesa con tu cuenta, aparece acá.
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {visits.slice(0, 5).map((v) => (
              <li key={v.sessionId} className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm">
                <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-paper text-lg">🍽</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{v.venue.name} · Mesa {v.tableLabel}</p>
                  <p className="text-xs text-night/50">{fmtDate(v.date)} · {plural(v.orders.reduce((s, o) => s + o.items.reduce((q, i) => q + i.quantity, 0), 0), "ítem", "ítems")}</p>
                </div>
                <span className="text-sm font-semibold">{formatMoney(v.totalCents, v.venue.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function QuickAction({ href, onClick, icon, label }: { href?: string; onClick?: () => void; icon: string; label: string }) {
  const circle = (
    <>
      <span aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand text-xl text-white shadow-md shadow-brand/30 transition active:bg-brand-dark">
        {icon}
      </span>
      <span className="mt-1.5 block text-xs leading-tight text-night/70">{label}</span>
    </>
  );
  return href ? <Link href={href} className="block">{circle}</Link> : <button onClick={onClick} className="block w-full">{circle}</button>;
}

// ───── Historial y "Pedir lo mismo" ─────

function HistoryTab({ venueId, tag, visits, notify }: Props & { visits: Visit[] | null; notify: (t: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reorder = async (orderId: string) => {
    if (!tag) return notify("Escaneá el QR de tu mesa para pedir lo mismo.");
    setBusy(orderId);
    try {
      const res = await customerApi<{ venueId: string; items: ReorderItem[] }>(venueId, `/customer/me/orders/${orderId}/reorder`);
      if (res.venueId !== venueId) return notify("Ese pedido es de otro local.");
      const cart = useCartStore.getState();
      cart.bindToTable(tag);
      const ok = res.items.filter((i): i is Extract<ReorderItem, { available: true }> => i.available);
      for (const { available: _a, ...item } of ok) cart.addItem(item);
      const missing = res.items.filter((i) => !i.available).map((i) => i.name);
      if (ok.length === 0) return notify(`Hoy no hay: ${missing.join(", ")}`);
      if (missing.length) notify(`Sumamos lo demás. Hoy no hay: ${missing.join(", ")}`);
      router.push(`/v/${venueId}/menu?tag=${tag}&cart=1`);
    } catch {
      notify("No pudimos armar el pedido. Probá de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-semibold">Historial</h1>
      <p className="mt-1 text-sm text-night/60">Tus visitas y lo que pediste.</p>
      {!tag && (
        <p className="mt-3 rounded-2xl bg-brand/10 px-4 py-3 text-xs text-brand-dark">
          Para "Pedir lo mismo" entrá desde el QR de tu mesa.
        </p>
      )}
      {visits === null ? (
        <p className="mt-4 text-sm text-night/50">Cargando…</p>
      ) : visits.length === 0 ? (
        <p className="mt-4 rounded-3xl bg-white p-5 text-sm text-night/60 shadow-sm">Todavía no hay visitas guardadas.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visits.map((v) => {
            const expanded = open === v.sessionId;
            return (
              <li key={v.sessionId} className="rounded-3xl bg-white shadow-sm">
                <button onClick={() => setOpen(expanded ? null : v.sessionId)} aria-expanded={expanded} className="flex min-h-16 w-full items-center gap-3 p-4 text-left">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{fmtDate(v.date)}</p>
                    <p className="text-xs text-night/50">{v.venue.name} · Mesa {v.tableLabel}</p>
                  </div>
                  <span className="font-semibold">{formatMoney(v.totalCents, v.venue.currency)}</span>
                  <span aria-hidden className={`text-night/40 transition ${expanded ? "rotate-180" : ""}`}>⌄</span>
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-night/5 px-4 pt-3 pb-4">
                    {v.orders.map((o) => (
                      <div key={o.id}>
                        <ul className="space-y-1 text-sm">
                          {o.items.map((it, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className={o.status === "REJECTED" || o.status === "CANCELLED" ? "text-night/40 line-through" : ""}>
                                {it.quantity}× {it.nameSnapshot}{it.variantName ? ` (${it.variantName})` : ""}
                              </span>
                              <span className="text-night/60">{formatMoney(it.unitPriceCents * it.quantity, v.venue.currency)}</span>
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => void reorder(o.id)}
                          disabled={busy === o.id}
                          className="mt-2 h-11 w-full rounded-2xl bg-brand text-sm font-semibold text-white active:bg-brand-dark disabled:opacity-50"
                        >
                          {busy === o.id ? "Armando…" : "↺ Pedir lo mismo"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ───── Promos ─────

function PromosTab({ venueName }: Props) {
  return (
    <>
      <h1 className="text-2xl font-semibold">Promos</h1>
      <p className="mt-4 rounded-3xl bg-white p-5 text-sm text-night/60 shadow-sm">
        Cuando {venueName} publique promociones, las vas a ver acá.
      </p>
    </>
  );
}

// ───── Perfil ─────

function ProfileTab({ venueId, me, onSaved, onLogout, notify }: Props & {
  me: Me | null;
  onSaved: () => Promise<void>;
  onLogout: () => void;
  notify: (t: string) => void;
}) {
  const [name, setName] = useState(me?.name ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setName(me?.name ?? ""), [me?.name]);

  const saveName = async () => {
    try {
      await customerApi(venueId, "/customer/me", { method: "PATCH", body: { name } });
      await onSaved();
      notify("Guardado ✅");
    } catch {
      notify("No se pudo guardar.");
    }
  };

  const exportData = async () => {
    try {
      const data = await customerApi<unknown>(venueId, "/customer/me/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "mis-datos.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      notify("No se pudo exportar.");
    }
  };

  const deleteAccount = async () => {
    try {
      await customerApi(venueId, "/customer/me", { method: "DELETE" });
      notify("Tu cuenta se borró.");
      onLogout();
    } catch {
      notify("No se pudo borrar. Probá de nuevo.");
    }
  };

  return (
    <>
      <header className="flex items-center gap-3">
        <Avatar name={me?.name ?? null} email={me?.email} />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{me?.name || "Tu perfil"}</h1>
          <p className="truncate text-sm text-night/60">{me?.email}</p>
        </div>
      </header>

      <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm">
        <label htmlFor="name" className="text-sm font-medium">Nombre</label>
        <div className="mt-2 flex gap-2">
          <input
            id="name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            className="h-12 min-w-0 flex-1 rounded-2xl border border-night/10 px-4 text-base outline-none focus:border-brand"
          />
          <button onClick={() => void saveName()} disabled={!name.trim()} className="h-12 rounded-2xl bg-brand px-5 text-sm font-semibold text-white active:bg-brand-dark disabled:opacity-50">
            Guardar
          </button>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-3xl bg-white shadow-sm">
        <h2 className="px-5 pt-4 text-sm font-semibold text-night/60">Tus datos</h2>
        <button onClick={() => void exportData()} className="flex min-h-14 w-full items-center justify-between px-5 text-left">
          <span>Descargar mis datos</span><span aria-hidden className="text-night/40">↓</span>
        </button>
        <a href="/privacidad" target="_blank" className="flex min-h-14 items-center justify-between border-t border-night/5 px-5">
          <span>Política de privacidad</span><span aria-hidden className="text-night/40">↗</span>
        </a>
        <button onClick={onLogout} className="flex min-h-14 w-full items-center justify-between border-t border-night/5 px-5 text-left">
          <span>Cerrar sesión en este celular</span><span aria-hidden className="text-night/40">→</span>
        </button>
      </section>

      <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm">
        {confirmDelete ? (
          <>
            <p className="text-sm">
              Se borran tu cuenta, tus puntos y tus preferencias. Tus pedidos quedan en el bar sin tu nombre. No se puede deshacer.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmDelete(false)} className="h-12 rounded-2xl border border-night/10 text-sm">Cancelar</button>
              <button onClick={() => void deleteAccount()} className="h-12 rounded-2xl bg-red-600 text-sm font-semibold text-white">Sí, borrar</button>
            </div>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="h-11 w-full text-left text-sm font-medium text-red-600">
            Borrar mi cuenta
          </button>
        )}
      </section>
    </>
  );
}
