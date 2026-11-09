"use client";

import { useCallback, useEffect, useState } from "react";
import { Btn, Card, Empty, Field, Toggle, inputCls, useToasts } from "@/components/ui";
import { api } from "@/lib/api";

type Rule = {
  kind: "WINBACK" | "THANK_YOU";
  label: string;
  enabled: boolean;
  days: number;
  title: string;
  body: string;
  last30d: { sent: number; returned: number; returnWindowDays: number };
};

const HELP: Record<Rule["kind"], string> = {
  WINBACK: "Le escribe a quien no viene hace un tiempo, una sola vez por ausencia.",
  THANK_YOU: "Al día siguiente de la visita. Si cargaste el link de reseñas de Google, el aviso lleva a dejar la opinión.",
};

/**
 * Avisos automáticos (Web Push + email): el bar los prende una vez y salen solos.
 * Reglas fijas del sistema: solo a quien aceptó, entre las 10 y las 21, y como máximo 1 por semana por cliente.
 */
export function Automations() {
  const { run, view } = useToasts();
  const [rules, setRules] = useState<Rule[] | null>(null);

  const load = useCallback(async () => {
    const r = await run(() => api<Rule[]>("/admin/automations"));
    if (r) setRules(r);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!rules) return <Empty>Cargando avisos automáticos…</Empty>;
  return (
    <section className="grid gap-3">
      {view}
      <div>
        <h3 className="font-display text-xl">Avisos automáticos</h3>
        <p className="text-sm text-muted">Salen solos a los clientes que aceptaron recibir avisos del bar: entre las 10 y las 21, y nunca más de uno por semana a la misma persona.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rules.map((r) => (
          <RuleCard key={r.kind} rule={r} onSaved={load} run={run} />
        ))}
      </div>
    </section>
  );
}

function RuleCard({ rule, onSaved, run }: { rule: Rule; onSaved: () => Promise<void>; run: ReturnType<typeof useToasts>["run"] }) {
  const [draft, setDraft] = useState(rule);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rule);

  const save = async () => {
    setSaving(true);
    const ok = await run(
      () => api(`/admin/automations/${rule.kind}`, { method: "PUT", body: { enabled: draft.enabled, days: draft.days, title: draft.title, body: draft.body } }),
      draft.enabled ? "Aviso automático activado" : "Cambios guardados",
    );
    setSaving(false);
    if (ok) await onSaved();
  };

  const { sent, returned, returnWindowDays } = rule.last30d;
  return (
    <Card className={draft.enabled ? "border-l-4 border-l-amber" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{rule.label}</p>
          <p className="text-xs text-muted">{HELP[rule.kind]}</p>
        </div>
        <Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label={`Activar ${rule.label}`} />
      </div>
      <div className="mt-3 grid gap-3">
        {rule.kind === "WINBACK" && (
          <Field label="Escribirle si no viene hace">
            <select className={inputCls} value={draft.days} onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}>
              {[21, 30, 45, 60, 90].map((d) => (
                <option key={d} value={d}>{d} días</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Título">
          <input className={inputCls} maxLength={80} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="Mensaje" hint={`${draft.body.length}/300`}>
          <textarea className={inputCls} rows={3} maxLength={300} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Últimos 30 días: {sent} aviso(s) · {returned} volvieron dentro de los {returnWindowDays} días
        </p>
        <Btn kind="primary" disabled={!dirty || saving || !draft.title.trim() || !draft.body.trim()} onClick={() => void save()}>
          {saving ? "Guardando…" : "Guardar"}
        </Btn>
      </div>
    </Card>
  );
}
