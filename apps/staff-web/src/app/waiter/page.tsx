"use client";

import { useCallback, useState } from "react";
import { StaffHeader } from "@/components/StaffHeader";
import {
  ApiError,
  type KitchenItem,
  type Order,
  type ServiceCall,
  type TableSession,
  api,
  formatMoney,
  minutesSince,
} from "@/lib/api";
import { useChime, useLiveEvents, useStaffAuth } from "@/lib/live";

type Board = { sessions: TableSession[]; orders: Order[]; calls: ServiceCall[]; ready: KitchenItem[] };

export default function WaiterPage() {
  const user = useStaffAuth(["OWNER", "MANAGER", "WAITER"]);
  const chime = useChime();
  const [board, setBoard] = useState<Board>({ sessions: [], orders: [], calls: [], ready: [] });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [sessions, orders, calls, items] = await Promise.all([
      api<TableSession[]>("/staff/sessions"),
      api<Order[]>("/staff/orders?status=PENDING_APPROVAL"),
      api<ServiceCall[]>("/staff/service-calls"),
      api<KitchenItem[]>("/staff/kitchen/items"),
    ]);
    setBoard({ sessions, orders, calls, ready: items.filter((i) => i.status === "READY") });
  }, []);

  const online = useLiveEvents(Boolean(user), refresh, (events) => {
    if (events.some((e) => e.type === "service_call.created")) chime.play("call");
    else if (events.some((e) => e.type === "order.submitted" || e.type === "session.requested")) chime.play("order");
    else if (events.some((e) => e.type === "item.status_changed" && e.payload.status === "READY")) chime.play("ready");
  });

  // Ejecuta una acción y refresca; los errores (p. ej. otro mozo ya la tomó) se muestran arriba
  const act = async (path: string, body?: unknown, method = "POST") => {
    setError(null);
    try {
      await api(path, { method, body });
    } catch (e) {
      setError(e instanceof ApiError ? (e.message ?? e.code) : "Sin conexión");
    }
    await refresh().catch(() => undefined);
  };

  if (!user) return null;

  const pending = board.sessions.filter((s) => s.status === "PENDING");
  const active = board.sessions.filter((s) => s.status !== "PENDING");

  return (
    <main>
      <StaffHeader user={user} title="Salón" online={online} audioOn={chime.unlocked} onStart={chime.unlock} />
      {error && <p className="mx-4 mt-3 rounded-xl bg-warn/15 px-4 py-2 text-sm text-warn">{error}</p>}

      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
        <Column title="Llamados" count={board.calls.length} accent="warn">
          {board.calls.map((c) => (
            <Card key={c.id} highlight={c.status === "OPEN"}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">{c.type === "BILL" ? "🧾 Cuenta" : "🙋 Mozo"} · Mesa {c.session.table.label}</p>
                <Ago iso={c.createdAt} />
              </div>
              <div className="mt-3 flex gap-2">
                {c.status === "OPEN" && <Btn onClick={() => act(`/staff/service-calls/${c.id}/ack`)}>Voy</Btn>}
                <Btn primary onClick={() => act(`/staff/service-calls/${c.id}/resolve`)}>Listo</Btn>
              </div>
            </Card>
          ))}
        </Column>

        <Column title="Pedidos por confirmar" count={board.orders.length} accent="amber">
          {board.orders.map((o) => (
            <OrderCard key={o.id} order={o} onApprove={() => act(`/staff/orders/${o.id}/approve`)} onReject={(reason) => act(`/staff/orders/${o.id}/reject`, { reason })} />
          ))}
        </Column>

        <Column title="Para llevar a la mesa" count={board.ready.length} accent="ok">
          {board.ready.map((i) => (
            <Card key={i.id} highlight>
              <div className="flex items-center justify-between">
                <p className="font-semibold">Mesa {i.order.session.table.label}</p>
                <Ago iso={i.updatedAt} />
              </div>
              <p className="mt-1">{i.quantity}× {i.nameSnapshot}{i.variantName && <span className="text-muted"> · {i.variantName}</span>}</p>
              <div className="mt-3">
                <Btn primary onClick={() => act(`/staff/order-items/${i.id}/status`, { status: "SERVED" }, "PATCH")}>Servido</Btn>
              </div>
            </Card>
          ))}
        </Column>

        <Column title="Mesas" count={board.sessions.length}>
          {pending.map((s) => (
            <Card key={s.id} highlight>
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">Mesa {s.table.label}</p>
                <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs text-amber">quiere abrir</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                PIN <span className="font-mono font-semibold text-cream">{s.joinPin}</span> · {s._count.devices} celular(es) · hace {minutesSince(s.openedAt)} min
              </p>
              <div className="mt-3 flex gap-2">
                <Btn primary onClick={() => act(`/staff/sessions/${s.id}/open`)}>Abrir mesa</Btn>
                <Btn onClick={() => act(`/staff/sessions/${s.id}/close`)}>Descartar</Btn>
              </div>
            </Card>
          ))}
          {active.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <p className="font-semibold">Mesa {s.table.label}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs ${s.status === "BILL_REQUESTED" ? "bg-warn/20 text-warn" : "bg-ok/15 text-ok"}`}>
                  {s.status === "BILL_REQUESTED" ? "pidió la cuenta" : "abierta"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">PIN {s.joinPin} · {s._count.devices} celular(es) · {s._count.orders} pedido(s)</p>
              {s.pinFailures >= 8 && <p className="mt-1 text-sm text-warn">🔒 PIN bloqueado por intentos fallidos: generá uno nuevo</p>}
              <div className="mt-3">
                <div className="flex gap-2">
                  <Btn onClick={() => confirm(`¿Cerrar la mesa ${s.table.label}?`) && act(`/staff/sessions/${s.id}/close`)}>Cerrar mesa</Btn>
                  <Btn onClick={() => act(`/staff/sessions/${s.id}/new-pin`)}>PIN nuevo</Btn>
                </div>
              </div>
            </Card>
          ))}
        </Column>
      </div>
    </main>
  );
}

function OrderCard({ order, onApprove, onReject }: { order: Order; onApprove: () => void; onReject: (reason: string) => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Card highlight>
      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold">Mesa {order.session.table.label}</p>
        <Ago iso={order.createdAt} />
      </div>
      <ul className="mt-2 grid gap-1 text-sm">
        {order.items.map((i) => (
          <li key={i.id}>
            <span className="font-semibold">{i.quantity}×</span> {i.nameSnapshot}
            {i.variantName && <span className="text-muted"> · {i.variantName}</span>}
            {i.modifiers.length > 0 && <span className="text-muted"> ({i.modifiers.map((m) => m.name).join(", ")})</span>}
            {i.note && <span className="block pl-5 text-amber italic">“{i.note}”</span>}
          </li>
        ))}
      </ul>
      {order.note && <p className="mt-2 rounded-lg bg-surface-2 px-2 py-1 text-sm italic">Nota: {order.note}</p>}
      <p className="mt-2 text-sm text-muted">Total {formatMoney(order.totalCents)}</p>
      {rejecting ? (
        <div className="mt-3 grid gap-2">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (ej.: sin stock)" className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-amber" />
          <div className="flex gap-2">
            <Btn onClick={() => setRejecting(false)}>Volver</Btn>
            <Btn danger disabled={!reason.trim()} onClick={() => onReject(reason.trim())}>Rechazar</Btn>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Btn primary onClick={onApprove}>Confirmar y enviar a cocina</Btn>
          <Btn onClick={() => setRejecting(true)}>Rechazar</Btn>
        </div>
      )}
    </Card>
  );
}

function Column({ title, count, accent, children }: { title: string; count: number; accent?: "warn" | "amber" | "ok"; children: React.ReactNode }) {
  const badge = accent === "warn" ? "bg-warn text-ink" : accent === "amber" ? "bg-amber text-amber-ink" : accent === "ok" ? "bg-ok text-ink" : "bg-surface-2 text-cream";
  return (
    <section className="min-w-0">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
        <span className={`rounded-full px-2 py-0.5 text-xs ${count > 0 ? badge : "bg-surface-2 text-muted"}`}>{count}</span>
      </h2>
      <div className="grid gap-3">
        {count === 0 ? <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">Nada por ahora</p> : children}
      </div>
    </section>
  );
}

function Card({ highlight, children }: { highlight?: boolean; children: React.ReactNode }) {
  return <article className={`rounded-2xl border p-4 ${highlight ? "border-amber/50 bg-surface" : "border-line bg-surface/60"}`}>{children}</article>;
}

function Btn({ primary, danger, disabled, onClick, children }: { primary?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  const cls = primary ? "bg-amber text-amber-ink font-semibold" : danger ? "bg-warn text-ink font-semibold" : "bg-surface-2 text-cream";
  return (
    <button disabled={disabled} onClick={onClick} className={`rounded-full px-4 py-2 text-sm disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

function Ago({ iso }: { iso: string }) {
  const m = minutesSince(iso);
  return <span className={`text-xs ${m >= 10 ? "text-warn" : "text-muted"}`}>{m === 0 ? "recién" : `hace ${m} min`}</span>;
}
