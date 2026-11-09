"use client";

import { useEffect, useState } from "react";
import { Btn, Card, Empty, Field, Toggle, inputCls, useToasts } from "@/components/ui";
import { type AdminLoyalty, api, formatMoney, parseMoney } from "@/lib/api";

type Reward = AdminLoyalty["rewards"][number];

const MODES = {
  STAMPS: { title: "Sellos por visita", text: "Un sello por cada visita con un pedido confirmado. Simple de explicar en la mesa." },
  POINTS: { title: "Puntos por gasto", text: "Suman según lo que gasta cada cliente. Premia más a quien más consume." },
} as const;

/** Fidelización: el bar elige sellos o puntos, define los premios y ve cómo rinde el programa */
export function Loyalty() {
  const { run, view } = useToasts();
  const [p, setP] = useState<AdminLoyalty | null>(null);
  const [perPoint, setPerPoint] = useState("");
  const [saving, setSaving] = useState(false);

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

  if (!p) return <Empty>Cargando fidelización…</Empty>;

  const unit = p.mode === "STAMPS" ? "sellos" : "puntos";
  const centsPerPoint = parseMoney(perPoint);
  const setReward = (i: number, patch: Partial<Reward>) => setP({ ...p, rewards: p.rewards.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const sorted = [...p.rewards].filter((r) => r.active && r.name.trim()).sort((a, b) => a.cost - b.cost);

  const save = async () => {
    if (!centsPerPoint) return;
    setSaving(true);
    const ok = await run(
      () =>
        api("/admin/loyalty", {
          method: "PUT",
          body: { active: p.active, mode: p.mode, centsPerPoint, rewards: p.rewards.map((r) => ({ id: r.id, name: r.name.trim(), cost: r.cost, active: r.active })) },
        }),
      "Programa de fidelización guardado",
    );
    setSaving(false);
    if (ok) await load();
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      {view}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Fidelización</h2>
          <p className="text-sm text-muted">Tus clientes suman con "Mi cuenta" cada vez que vienen, y el mozo canjea los premios en la mesa.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className={p.active ? "text-ok" : "text-muted"}>{p.active ? "Programa activo" : "Programa pausado"}</span>
          <Toggle checked={p.active} onChange={(active) => setP({ ...p, active })} label="Programa activo" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Clientes registrados" value={p.stats.customers} />
        <Metric label="Activos en 30 días" value={p.stats.last30d.members} />
        <Metric label={`${unit[0]!.toUpperCase()}${unit.slice(1)} entregados (30 días)`} value={p.stats.last30d.earned} />
        <Metric label="Premios canjeados (30 días)" value={p.stats.last30d.redeemed} sub={`${p.stats.redeemed} en total`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-4">
          <Card>
            <h3 className="font-display text-xl">Cómo suman</h3>
            <div role="radiogroup" aria-label="Modo del programa" className="mt-3 grid gap-2 sm:grid-cols-2">
              {(["STAMPS", "POINTS"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={p.mode === m}
                  onClick={() => setP({ ...p, mode: m })}
                  className={`rounded-2xl border p-4 text-left transition ${p.mode === m ? "border-amber bg-amber/15" : "border-line bg-surface hover:bg-surface-2"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{MODES[m].title}</span>
                    <span aria-hidden className={`grid h-5 w-5 place-items-center rounded-full border ${p.mode === m ? "border-brand-dark bg-brand-dark" : "border-line"}`}>
                      {p.mode === m && <span className="h-2 w-2 rounded-full bg-surface" />}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">{MODES[m].text}</span>
                </button>
              ))}
            </div>
            {p.mode === "POINTS" && (
              <div className="mt-4 max-w-xs">
                <Field label="1 punto cada" hint={centsPerPoint ? `Una cuenta de ${formatMoney(centsPerPoint * 10)} suma 10 puntos` : "Ingresá un monto"}>
                  <input value={perPoint} onChange={(e) => setPerPoint(e.target.value)} inputMode="decimal" className={inputCls} />
                </Field>
              </div>
            )}
            <p className="mt-3 text-xs text-muted">Si cambiás de sellos a puntos (o al revés), el saldo de los clientes empieza de cero en la unidad nueva.</p>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-display text-xl">Premios</h3>
                <p className="text-xs text-muted">Hasta 10. Ordenados por costo en la tarjeta del cliente.</p>
              </div>
              <Btn size="sm" disabled={p.rewards.length >= 10} onClick={() => setP({ ...p, rewards: [...p.rewards, { name: "", cost: 10, active: true }] })}>
                Agregar premio
              </Btn>
            </div>
            {p.rewards.length === 0 ? (
              <Empty>Sumá el primer premio, por ejemplo "Café gratis" a los 5 {unit}.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {p.rewards.map((r, i) => (
                  <li key={r.id ?? `new-${i}`} className={`flex flex-wrap items-center gap-2 py-2.5 ${r.active ? "" : "opacity-60"}`}>
                    <input
                      aria-label="Nombre del premio"
                      value={r.name}
                      maxLength={60}
                      placeholder="Ej.: Postre gratis"
                      onChange={(e) => setReward(i, { name: e.target.value })}
                      className={`${inputCls} min-w-40 flex-1`}
                    />
                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      <input
                        aria-label={`Costo en ${unit}`}
                        type="number"
                        min={1}
                        max={100000}
                        value={r.cost}
                        onChange={(e) => setReward(i, { cost: Math.max(1, Number(e.target.value) || 1) })}
                        className={`${inputCls} w-20 tabular-nums`}
                      />
                      {unit}
                    </label>
                    <Toggle checked={r.active} onChange={(active) => setReward(i, { active })} label={`Premio ${r.name || "nuevo"} activo`} />
                    <Btn size="sm" kind="ghost" onClick={() => setP({ ...p, rewards: p.rewards.filter((_, j) => j !== i) })}>Quitar</Btn>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="flex items-center gap-3">
            <Btn kind="primary" onClick={() => void save()} disabled={saving || !centsPerPoint || p.rewards.some((r) => !r.name.trim())}>
              {saving ? "Guardando…" : "Guardar cambios"}
            </Btn>
            <p className="text-xs text-muted">El canje lo hace el mozo desde Salón → Mesas → Clientes, con el cliente en la mesa.</p>
          </div>
        </div>

        <CardPreview venueUnit={unit} rewards={sorted} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Vista previa de la tarjeta que ve el cliente en "Mi cuenta" (con un saldo de ejemplo) */
function CardPreview({ venueUnit, rewards }: { venueUnit: string; rewards: Reward[] }) {
  const next = rewards[0];
  const sample = next ? Math.max(0, next.cost - 1) : 0;
  const pct = next ? Math.round((sample / next.cost) * 100) : 0;
  return (
    <aside aria-label="Vista previa de la tarjeta del cliente" className="self-start">
      <p className="mb-2 text-xs text-muted">Así la ve el cliente</p>
      <div className="rounded-3xl border border-line border-l-4 border-l-amber bg-surface p-5">
        <p className="text-xs text-muted">Tu saldo</p>
        <p className="font-display text-4xl tabular-nums">
          {sample} <span className="text-base text-muted">{venueUnit}</span>
        </p>
        {next ? (
          <>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-amber" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-sm">
              Te falta <strong>1</strong> para <strong>{next.name}</strong>
            </p>
            <ul className="mt-4 grid gap-1.5 border-t border-line pt-3 text-sm">
              {rewards.map((r) => (
                <li key={r.id ?? r.name} className="flex justify-between gap-2">
                  <span>{r.name}</span>
                  <span className="text-muted tabular-nums">{r.cost} {venueUnit}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">Agregá un premio para ver la tarjeta completa.</p>
        )}
      </div>
    </aside>
  );
}
