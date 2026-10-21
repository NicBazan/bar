"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, Card, Empty, Field, Modal, Toggle, inputCls, useToasts } from "@/components/ui";
import { type AdminCampaigns, type AdminPromotion, api } from "@/lib/api";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR") : "—");
const toInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

type Draft = { id?: string; title: string; body: string; startsAt: string; endsAt: string; active: boolean };

/** Promociones del bar y avisos (Web Push + email) a los clientes que aceptaron recibirlos */
export function Promotions() {
  const { run, view, push } = useToasts();
  const [promos, setPromos] = useState<AdminPromotion[] | null>(null);
  const [camp, setCamp] = useState<AdminCampaigns | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ promotionId?: string; title: string; body: string; segment: "ALL" | "INACTIVE_30" } | null>(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([run(() => api<AdminPromotion[]>("/admin/promotions")), run(() => api<AdminCampaigns>("/admin/campaigns"))]);
    if (p) setPromos(p);
    if (c) setCamp(c);
  }, [run]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!promos || !camp) return <Empty>Cargando…</Empty>;

  const savePromo = async () => {
    if (!draft) return;
    // Fechas del día en la zona del navegador: inicio a las 00:00 y fin al terminar el día
    const body = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      startsAt: draft.startsAt ? new Date(`${draft.startsAt}T00:00:00`).toISOString() : null,
      endsAt: draft.endsAt ? new Date(`${draft.endsAt}T23:59:59`).toISOString() : null,
      active: draft.active,
    };
    const ok = await run(
      () => (draft.id ? api(`/admin/promotions/${draft.id}`, { method: "PATCH", body }) : api("/admin/promotions", { method: "POST", body })),
      "Promo guardada",
    );
    if (ok) {
      setDraft(null);
      await load();
    }
  };

  const remove = async (p: AdminPromotion) => {
    if (!confirm(`¿Borrar "${p.title}"?`)) return;
    if (await run(() => api(`/admin/promotions/${p.id}`, { method: "DELETE" }), "Promo borrada")) await load();
  };

  const sendCampaign = async () => {
    if (!msg) return;
    const res = await run(() =>
      api<{ pushSent: number; emailSent: number }>("/admin/campaigns", {
        method: "POST",
        body: { ...msg, title: msg.title.trim(), body: msg.body.trim() },
      }),
    );
    if (res) {
      setMsg(null);
      push(`Enviado: ${res.pushSent} notificación(es) y ${res.emailSent} email(s)`);
      await load();
    }
  };

  const blocked = Boolean(camp.nextAllowedAt);
  const aud = msg ? camp.audience[msg.segment] : null;

  return (
    <div className="grid max-w-3xl gap-4">
      {view}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-xl">Promociones</h3>
            <p className="text-sm text-muted">Se ven en la carta y en "Mi cuenta" de tus clientes mientras estén vigentes.</p>
          </div>
          <Btn kind="primary" onClick={() => setDraft({ title: "", body: "", startsAt: "", endsAt: "", active: true })}>+ Promo</Btn>
        </div>
        {promos.length === 0 ? (
          <Empty>Todavía no cargaste promociones.</Empty>
        ) : (
          <ul className="grid gap-2">
            {promos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.title} {!p.active && <Badge>pausada</Badge>}</p>
                  <p className="truncate text-sm text-muted">{p.body}</p>
                  <p className="text-xs text-muted">Desde {day(p.startsAt)} · hasta {day(p.endsAt)}</p>
                </div>
                <Btn size="sm" onClick={() => setMsg({ promotionId: p.id, title: p.title, body: p.body, segment: "ALL" })} disabled={blocked}>
                  Avisar
                </Btn>
                <Btn size="sm" onClick={() => setDraft({ id: p.id, title: p.title, body: p.body, startsAt: toInput(p.startsAt), endsAt: toInput(p.endsAt), active: p.active })}>
                  Editar
                </Btn>
                <Btn size="sm" kind="ghost" onClick={() => void remove(p)}>Borrar</Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-display text-xl">Avisos a clientes</h3>
          <Btn kind="primary" disabled={blocked} onClick={() => setMsg({ title: "", body: "", segment: "INACTIVE_30" })}>Nuevo aviso</Btn>
        </div>
        <p className="text-sm text-muted">
          Notificación al celular y email, solo a quienes aceptaron recibir avisos de tu bar. Máximo <b>1 por semana</b>; cada aviso trae su baja en un toque.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Audience label="Todos los que aceptaron" a={camp.audience.ALL} />
          <Audience label="No vienen hace 30 días" a={camp.audience.INACTIVE_30} />
        </div>
        {blocked && (
          <p className="mt-3 rounded-xl bg-amber/10 px-3 py-2 text-sm text-amber">Próximo aviso disponible el {day(camp.nextAllowedAt)}.</p>
        )}
        {camp.campaigns.length > 0 && (
          <ul className="mt-4 grid gap-1 text-sm">
            {camp.campaigns.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 border-t border-line pt-2">
                <span className="min-w-0 truncate">
                  {day(c.createdAt)} · <b>{c.title}</b> <span className="text-muted">({c.segment === "ALL" ? "todos" : "inactivos 30 días"})</span>
                </span>
                <span className="text-muted whitespace-nowrap">📱 {c.pushSent} · ✉️ {c.emailSent}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? "Editar promo" : "Nueva promo"}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Btn onClick={() => setDraft(null)}>Cancelar</Btn>
            <Btn kind="primary" disabled={!draft?.title.trim() || !draft?.body.trim()} onClick={() => void savePromo()}>Guardar</Btn>
          </>
        }
      >
        {draft && (
          <div className="grid gap-3">
            <Field label="Título">
              <input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={inputCls} placeholder="2x1 en pintas" />
            </Field>
            <Field label="Detalle">
              <textarea value={draft.body} maxLength={500} rows={3} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className={inputCls} placeholder="De lunes a jueves de 18 a 20 h" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desde (opcional)">
                <input type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Hasta (opcional)">
                <input type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} className={inputCls} />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              Activa
              <Toggle checked={draft.active} onChange={(active) => setDraft({ ...draft, active })} label="Promo activa" />
            </label>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(msg)}
        title="Nuevo aviso"
        onClose={() => setMsg(null)}
        footer={
          <>
            <Btn onClick={() => setMsg(null)}>Cancelar</Btn>
            <Btn kind="primary" disabled={!msg?.title.trim() || !msg?.body.trim() || !aud?.customers} onClick={() => void sendCampaign()}>
              Enviar a {aud?.customers ?? 0} cliente(s)
            </Btn>
          </>
        }
      >
        {msg && (
          <div className="grid gap-3">
            <Field label="A quién">
              <select value={msg.segment} onChange={(e) => setMsg({ ...msg, segment: e.target.value as "ALL" | "INACTIVE_30" })} className={inputCls}>
                <option value="INACTIVE_30">No vienen hace 30 días ("te extrañamos")</option>
                <option value="ALL">Todos los que aceptaron avisos</option>
              </select>
            </Field>
            <Field label="Título">
              <input value={msg.title} maxLength={80} onChange={(e) => setMsg({ ...msg, title: e.target.value })} className={inputCls} placeholder="¡Te extrañamos!" />
            </Field>
            <Field label="Mensaje" hint={`${msg.body.length}/300`}>
              <textarea value={msg.body} maxLength={300} rows={3} onChange={(e) => setMsg({ ...msg, body: e.target.value })} className={inputCls} />
            </Field>
            {aud && (
              <p className="text-sm text-muted">
                Llega a {aud.customers} cliente(s): {aud.push} con notificaciones y {aud.email} por email. Después no vas a poder mandar otro aviso por 7 días.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Audience({ label, a }: { label: string; a: { customers: number; email: number; push: number } }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold">{a.customers}</p>
      <p className="text-xs text-muted">📱 {a.push} · ✉️ {a.email}</p>
    </div>
  );
}
