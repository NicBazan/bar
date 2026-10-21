"use client";

import { useEffect, useState } from "react";
import { Badge, Btn, Card, Empty, Field, Toggle, inputCls, useToasts } from "@/components/ui";
import { type AdminLoyalty, api, formatMoney, parseMoney } from "@/lib/api";

/** Fidelización: el bar elige sellos por visita o puntos por gasto, y define los premios */
export function Loyalty() {
  const { run, view } = useToasts();
  const [p, setP] = useState<AdminLoyalty | null>(null);
  const [perPoint, setPerPoint] = useState("");

  const load = () =>
    run(() => api<AdminLoyalty>("/admin/loyalty")).then((d) => {
      if (!d) return;
      setP(d);
      setPerPoint(String(d.centsPerPoint / 100));
    });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!p) return <Empty>Cargando…</Empty>;

  const unit = p.mode === "STAMPS" ? "sellos" : "puntos";
  const centsPerPoint = parseMoney(perPoint);

  const setReward = (i: number, patch: Partial<AdminLoyalty["rewards"][number]>) =>
    setP({ ...p, rewards: p.rewards.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const save = async () => {
    if (!centsPerPoint) return;
    const ok = await run(
      () =>
        api("/admin/loyalty", {
          method: "PUT",
          body: {
            active: p.active,
            mode: p.mode,
            centsPerPoint,
            rewards: p.rewards.map((r) => ({ id: r.id, name: r.name.trim(), cost: r.cost, active: r.active })),
          },
        }),
      "Fidelización guardada",
    );
    if (ok) await load();
  };

  return (
    <div className="grid max-w-2xl gap-4">
      {view}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl">Programa de fidelización</h3>
            <p className="text-sm text-muted">
              Los clientes con "Mi cuenta" suman al cerrar la mesa. Hoy hay {p.stats.customers} cliente(s) registrados y {p.stats.redeemed} canje(s).
            </p>
          </div>
          <Toggle checked={p.active} onChange={(active) => setP({ ...p, active })} label="Programa activo" />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(["STAMPS", "POINTS"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setP({ ...p, mode: m })}
              className={`rounded-2xl border p-4 text-left transition ${p.mode === m ? "border-amber bg-amber/10" : "border-line bg-surface-2"}`}
            >
              <p className="font-semibold">{m === "STAMPS" ? "⭐ Sellos por visita" : "💰 Puntos por gasto"}</p>
              <p className="mt-1 text-xs text-muted">
                {m === "STAMPS" ? "1 sello por cada visita con un pedido confirmado." : "Suman según lo que gastan en cada visita."}
              </p>
            </button>
          ))}
        </div>

        {p.mode === "POINTS" && (
          <div className="mt-4">
            <Field label="1 punto cada" hint={centsPerPoint ? `Ej.: una cuenta de ${formatMoney(centsPerPoint * 10)} suma 10 puntos` : "Ingresá un monto"}>
              <input value={perPoint} onChange={(e) => setPerPoint(e.target.value)} inputMode="decimal" className={inputCls} />
            </Field>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Si cambiás de sellos a puntos (o al revés), el saldo de los clientes vuelve a empezar en la unidad nueva.
        </p>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-xl">Premios</h3>
          <Btn size="sm" disabled={p.rewards.length >= 10} onClick={() => setP({ ...p, rewards: [...p.rewards, { name: "", cost: 10, active: true }] })}>
            + Premio
          </Btn>
        </div>
        {p.rewards.length === 0 ? (
          <Empty>Agregá al menos un premio (ej.: "Café gratis" a los 5 sellos).</Empty>
        ) : (
          <ul className="grid gap-2">
            {p.rewards.map((r, i) => (
              <li key={r.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2">
                <input
                  aria-label="Nombre del premio"
                  value={r.name}
                  maxLength={60}
                  placeholder="Ej.: Postre gratis"
                  onChange={(e) => setReward(i, { name: e.target.value })}
                  className={`${inputCls} min-w-40 flex-1`}
                />
                <label className="flex items-center gap-1 text-sm text-muted">
                  <input
                    aria-label={`Costo en ${unit}`}
                    type="number"
                    min={1}
                    max={100000}
                    value={r.cost}
                    onChange={(e) => setReward(i, { cost: Math.max(1, Number(e.target.value) || 1) })}
                    className={`${inputCls} w-24`}
                  />
                  {unit}
                </label>
                <Toggle checked={r.active} onChange={(active) => setReward(i, { active })} label="Premio activo" />
                <Btn size="sm" kind="ghost" onClick={() => setP({ ...p, rewards: p.rewards.filter((_, j) => j !== i) })}>
                  Quitar
                </Btn>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">
          El canje lo hace el mozo desde <Badge>Salón → Mesas → Clientes</Badge> con el cliente sentado en la mesa.
        </p>
      </Card>

      <div>
        <Btn kind="primary" onClick={() => void save()} disabled={!centsPerPoint || p.rewards.some((r) => !r.name.trim())}>
          Guardar
        </Btn>
      </div>
    </div>
  );
}
