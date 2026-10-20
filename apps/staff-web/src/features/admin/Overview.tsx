"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Empty, useToasts } from "@/components/ui";
import { type AdminOverview, api, formatMoney } from "@/lib/api";

export function Overview({ onGo }: { onGo: (tab: "carta" | "mesas" | "equipo" | "local") => void }) {
  const { run, view } = useToasts();
  const [o, setO] = useState<AdminOverview | null>(null);

  useEffect(() => {
    void run(() => api<AdminOverview>("/admin/overview")).then((d) => d && setO(d));
  }, [run]);

  if (!o) return <Empty>Cargando…</Empty>;

  const usage = o.plan ? Math.min(100, Math.round((o.plan.used / o.plan.limit) * 100)) : 0;

  return (
    <div className="grid gap-4">
      {view}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ventas últimas 24 h" value={formatMoney(o.last24h.salesCents)} sub={`${o.last24h.orders} pedido(s) confirmados`} />
        <Stat label="Mesas activas ahora" value={String(o.activeSessions)} sub={`de ${o.counts.tables} mesas`} />
        <Stat label="Platos en la carta" value={String(o.counts.dishes)} sub="activos" onClick={() => onGo("carta")} />
        <Stat label="Equipo" value={String(o.counts.staff)} sub="personas activas" onClick={() => onGo("equipo")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-display text-xl">Plan</h3>
          {o.plan ? (
            <>
              <div className="flex items-center gap-2">
                <Badge tone={o.plan.plan === "PRO" ? "ok" : o.plan.plan === "CANCELED" ? "warn" : "amber"}>{o.plan.plan}</Badge>
                <span className="text-sm text-muted">
                  {o.plan.plan === "PRO" ? "Mesas ilimitadas" : `${o.plan.used} de ${o.plan.limit} mesas este mes`}
                </span>
              </div>
              {o.plan.plan !== "PRO" && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className={`h-full ${usage >= 90 ? "bg-warn" : "bg-amber"}`} style={{ width: `${usage}%` }} />
                </div>
              )}
              <p className="mt-2 text-xs text-muted">El período se renueva el {new Date(o.plan.periodEnd).toLocaleDateString("es-AR")}.</p>
            </>
          ) : (
            <p className="text-sm text-muted">Sin plan asignado.</p>
          )}
        </Card>

        <Card>
          <h3 className="mb-2 font-display text-xl">Lo más pedido (7 días)</h3>
          {o.topDishes7d.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay pedidos confirmados.</p>
          ) : (
            <ol className="grid gap-1.5">
              {o.topDishes7d.map((d, i) => (
                <li key={d.name} className="flex items-center gap-2 text-sm">
                  <span className="w-5 text-muted">{i + 1}.</span>
                  <span className="flex-1">{d.name}</span>
                  <Badge>{d.quantity} u.</Badge>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-2 font-display text-xl">Primeros pasos</h3>
        <ol className="grid gap-2 text-sm">
          <li>1. <button className="text-amber underline" onClick={() => onGo("carta")}>Cargá tu carta</button>: categorías, platos, precios y fotos (y modelos 3D si tenés).</li>
          <li>2. <button className="text-amber underline" onClick={() => onGo("mesas")}>Imprimí los QR</button> y pegalos en cada mesa.</li>
          <li>3. <button className="text-amber underline" onClick={() => onGo("equipo")}>Sumá a tu equipo</button>: mozos y cocina, cada uno con su usuario.</li>
          <li>4. <button className="text-amber underline" onClick={() => onGo("local")}>Configurá el Wi-Fi y el link de reseñas</button>.</li>
          <li>5. En el turno: mozos en <a className="text-amber underline" href="/waiter">Salón</a>, cocina en <a className="text-amber underline" href="/kds">KDS</a>.</li>
        </ol>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, onClick }: { label: string; value: string; sub: string; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="rounded-2xl border border-line bg-surface p-4 text-left">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-display text-3xl">{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </Tag>
  );
}
