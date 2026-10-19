"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StaffHeader } from "@/components/StaffHeader";
import { ApiError, type KitchenItem, api, minutesSince } from "@/lib/api";
import { useChime, useLiveEvents, useStaffAuth } from "@/lib/live";

const STATION_KEY = "bar.kds.station";

/** Kitchen Display System: comandas activas por estación, agrupadas por pedido */
export default function KdsPage() {
  const user = useStaffAuth(["OWNER", "MANAGER", "KITCHEN"]);
  const chime = useChime();
  const [items, setItems] = useState<KitchenItem[]>([]);
  const [stations, setStations] = useState<Array<{ key: string; name: string }>>([]);
  const [station, setStation] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [, setNow] = useState(0);

  useEffect(() => {
    try {
      setStation(localStorage.getItem(STATION_KEY) ?? "");
    } catch {
      /* noop */
    }
    // Re-render cada 30 s para actualizar los tiempos de espera
    const id = setInterval(() => setNow((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const all = await api<KitchenItem[]>("/staff/kitchen/items");
    setItems(all);
    setStations((prev) => {
      const map = new Map(prev.map((s) => [s.key, s]));
      for (const i of all) if (i.station) map.set(i.station.key, i.station);
      return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  const online = useLiveEvents(Boolean(user), refresh, (events) => {
    if (events.some((e) => e.type === "order.approved")) chime.play("order");
  });

  const pickStation = (key: string) => {
    setStation(key);
    try {
      localStorage.setItem(STATION_KEY, key);
    } catch {
      /* noop */
    }
  };

  const move = async (ids: string[], status: "IN_PROGRESS" | "READY") => {
    setError(null);
    try {
      await Promise.all(ids.map((id) => api(`/staff/order-items/${id}/status`, { method: "PATCH", body: { status } })));
    } catch (e) {
      setError(e instanceof ApiError ? (e.message ?? e.code) : "Sin conexión");
    }
    await refresh().catch(() => undefined);
  };

  // Tickets: ítems de la estación elegida, agrupados por pedido, del más viejo al más nuevo
  const tickets = useMemo(() => {
    const visible = items.filter((i) => !station || i.station?.key === station);
    const byOrder = new Map<string, KitchenItem[]>();
    for (const i of visible) byOrder.set(i.order.id, [...(byOrder.get(i.order.id) ?? []), i]);
    return [...byOrder.values()]
      // Orden fijo dentro del ticket: que los platos no salten de lugar al tocarlos
      .map((its) => ({ order: its[0]!.order, items: its.sort((a, b) => a.nameSnapshot.localeCompare(b.nameSnapshot)) }))
      .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
  }, [items, station]);

  const cooking = tickets.filter((t) => t.items.some((i) => i.status !== "READY"));
  const waiting = tickets.filter((t) => t.items.every((i) => i.status === "READY"));

  if (!user) return null;

  return (
    <main>
      <StaffHeader user={user} title="Cocina" online={online} audioOn={chime.unlocked} onStart={chime.unlock}>
        <div className="flex gap-1 text-sm">
          <Chip on={!station} onClick={() => pickStation("")}>Todas</Chip>
          {stations.map((s) => (
            <Chip key={s.key} on={station === s.key} onClick={() => pickStation(s.key)}>{s.name}</Chip>
          ))}
        </div>
      </StaffHeader>
      {error && <p className="mx-4 mt-3 rounded-xl bg-warn/15 px-4 py-2 text-sm text-warn">{error}</p>}

      <section className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {cooking.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-line p-10 text-center text-muted">Sin comandas pendientes 👌</p>
        )}
        {cooking.map(({ order, items: its }) => {
          const mins = minutesSince(order.createdAt);
          const tone = mins >= 20 ? "border-warn bg-warn/10" : mins >= 10 ? "border-amber bg-amber/5" : "border-line bg-surface";
          const toStart = its.filter((i) => i.status === "FIRED").map((i) => i.id);
          const toFinish = its.filter((i) => i.status !== "READY").map((i) => i.id);
          return (
            <article key={order.id} className={`flex flex-col rounded-2xl border-2 p-4 ${tone}`}>
              <header className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-3xl">Mesa {order.session.table.label}</h2>
                <span className={`font-mono text-lg ${mins >= 20 ? "text-warn" : mins >= 10 ? "text-amber" : "text-muted"}`}>{mins}′</span>
              </header>
              <ul className="grid flex-1 gap-2">
                {its.map((i) => (
                  <li key={i.id} className={`flex items-start justify-between gap-2 rounded-xl px-3 py-2 ${i.status === "READY" ? "bg-ok/10 opacity-60" : i.status === "IN_PROGRESS" ? "bg-amber/15" : "bg-surface-2"}`}>
                    <div>
                      <p className="text-lg font-semibold">
                        {i.quantity}× {i.nameSnapshot}
                        {i.variantName && <span className="font-normal text-muted"> · {i.variantName}</span>}
                      </p>
                      {i.modifiers.length > 0 && <p className="text-sm text-cream/80">{i.modifiers.map((m) => m.name).join(" · ")}</p>}
                      {i.note && <p className="text-sm font-semibold text-amber">⚠ {i.note}</p>}
                      {!station && i.station && <p className="text-xs text-muted">{i.station.name}</p>}
                    </div>
                    {i.status === "FIRED" && <SmallBtn onClick={() => move([i.id], "IN_PROGRESS")}>Empezar</SmallBtn>}
                    {i.status === "IN_PROGRESS" && <SmallBtn primary onClick={() => move([i.id], "READY")}>Listo</SmallBtn>}
                    {i.status === "READY" && <span className="text-sm text-ok">✓</span>}
                  </li>
                ))}
              </ul>
              {order.note && <p className="mt-2 rounded-lg bg-surface-2 px-2 py-1 text-sm italic">Nota: {order.note}</p>}
              <div className="mt-3 flex gap-2">
                {toStart.length > 0 && <SmallBtn onClick={() => move(toStart, "IN_PROGRESS")}>Empezar todo</SmallBtn>}
                <SmallBtn primary onClick={() => move(toFinish, "READY")}>Todo listo ✓</SmallBtn>
              </div>
            </article>
          );
        })}
      </section>

      {waiting.length > 0 && (
        <section className="px-4 pb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Listos, esperando al mozo</h2>
          <div className="flex flex-wrap gap-2">
            {waiting.map(({ order, items: its }) => (
              <span key={order.id} className="rounded-full bg-ok/15 px-3 py-1 text-sm text-ok">
                Mesa {order.session.table.label} · {its.reduce((s, i) => s + i.quantity, 0)} ítem(s)
              </span>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3 py-1 ${on ? "bg-cream text-ink" : "bg-surface-2 text-muted"}`}>
      {children}
    </button>
  );
}

function SmallBtn({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${primary ? "bg-ok text-ink" : "bg-cream/10 text-cream"}`}>
      {children}
    </button>
  );
}
