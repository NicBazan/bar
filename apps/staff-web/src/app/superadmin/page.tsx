"use client";

import { useCallback, useEffect, useState } from "react";
import { StaffHeader } from "@/components/StaffHeader";
import { Badge, Btn, Card, Empty, Field, Modal, inputCls, useToasts } from "@/components/ui";
import { ROLE_LABEL, type SaAudit, type SaStats, type SaTenant, type StaffRole, api, formatMoney } from "@/lib/api";
import { useStaffAuth } from "@/lib/live";

type Plan = "FREE" | "PRO" | "CANCELED";
const PLAN_TONE: Record<Plan, "amber" | "ok" | "warn"> = { FREE: "amber", PRO: "ok", CANCELED: "warn" };

/** Panel de la plataforma: todos los bares, sus planes y su actividad */
export default function SuperAdminPage() {
  const user = useStaffAuth(["SUPER_ADMIN"]);
  const { run, view } = useToasts();
  const [tab, setTab] = useState<"bares" | "auditoria">("bares");
  const [stats, setStats] = useState<SaStats | null>(null);
  const [tenants, setTenants] = useState<SaTenant[] | null>(null);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      run(() => api<SaStats>("/superadmin/stats")),
      run(() => api<SaTenant[]>(`/superadmin/tenants${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)),
    ]);
    if (s) setStats(s);
    if (t) setTenants(t);
  }, [run, q]);

  useEffect(() => {
    if (!user) return;
    const id = setTimeout(() => void load(), 250); // debounce del buscador
    return () => clearTimeout(id);
  }, [user, load]);

  if (!user) return null;

  return (
    <main>
      {view}
      <StaffHeader user={user} title="Plataforma" />
      <div className="grid gap-4 p-4">
        {stats && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Bares" value={String(stats.tenants)} sub={`${stats.suspended} suspendido(s)`} />
            <Stat label="Planes" value={`${stats.plans.PRO ?? 0} PRO`} sub={`${stats.plans.FREE ?? 0} FREE · ${stats.plans.CANCELED ?? 0} cancelados`} />
            <Stat label="Mesas abiertas 24 h" value={String(stats.sessions.last24h)} sub={`${stats.sessions.last30d} en 30 días`} />
            <Stat label="Pedidos 30 días" value={String(stats.orders30d.count)} sub="confirmados" />
            <Stat label="Volumen 30 días" value={formatMoney(stats.orders30d.gmvCents)} sub="vendido por los bares" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {(["bares", "auditoria"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm ${tab === t ? "bg-cream text-ink" : "bg-surface-2 text-muted"}`}>
              {t === "bares" ? "Bares" : "Auditoría"}
            </button>
          ))}
          <span className="flex-1" />
          {tab === "bares" && (
            <>
              <input className={`${inputCls} max-w-xs`} placeholder="Buscar por bar o email…" value={q} onChange={(e) => setQ(e.target.value)} />
              <Btn kind="primary" onClick={() => setCreating(true)}>+ Dar de alta un bar</Btn>
            </>
          )}
        </div>

        {tab === "bares" &&
          (!tenants ? (
            <Empty>Cargando…</Empty>
          ) : tenants.length === 0 ? (
            <Empty>No hay bares que coincidan.</Empty>
          ) : (
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs tracking-wide text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="p-3">Bar</th>
                    <th className="p-3">Dueño</th>
                    <th className="p-3">Plan</th>
                    <th className="p-3">Uso del mes</th>
                    <th className="p-3">30 días</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className="border-b border-line/60 last:border-0">
                      <td className="p-3">
                        <p className="font-semibold">{t.name}</p>
                        <p className="text-xs text-muted">
                          desde {new Date(t.createdAt).toLocaleDateString("es-AR")} {t.suspendedAt && <Badge tone="warn">suspendido</Badge>}
                        </p>
                      </td>
                      <td className="p-3 text-muted">{t.owner?.email ?? "—"}</td>
                      <td className="p-3">{t.subscription && <Badge tone={PLAN_TONE[t.subscription.plan]}>{t.subscription.plan}</Badge>}</td>
                      <td className="p-3 text-muted">{t.subscription ? `${t.subscription.used} / ${t.subscription.plan === "PRO" ? "∞" : t.subscription.limit}` : "—"}</td>
                      <td className="p-3 text-muted">
                        {t.last30d.sessions} mesas · {t.last30d.orders} pedidos · {formatMoney(t.last30d.salesCents)}
                      </td>
                      <td className="p-3 text-right">
                        <Btn size="sm" onClick={() => setDetail(t.id)}>Gestionar</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}

        {tab === "auditoria" && <AuditList />}
      </div>

      {detail && <TenantModal id={detail} onClose={() => setDetail(null)} onChanged={load} />}
      {creating && <CreateTenantModal onClose={() => setCreating(false)} onCreated={load} />}
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}

type TenantDetail = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendReason: string | null;
  subscription: { plan: Plan; tableSessionsThisMonth: number; tableSessionLimit: number; currentPeriodEnd: string } | null;
  venues: Array<{ id: string; name: string; _count: { tables: number } }>;
  staffUsers: Array<{ id: string; name: string; email: string; role: StaffRole; active: boolean }>;
  audit: Array<{ id: string; action: string; createdAt: string; data: unknown }>;
};

function TenantModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const { run, view } = useToasts();
  const [t, setT] = useState<TenantDetail | null>(null);
  const [plan, setPlan] = useState<Plan>("FREE");
  const [limit, setLimit] = useState(50);
  const [reason, setReason] = useState("");
  const [temp, setTemp] = useState<{ email: string; temporaryPassword: string } | null>(null);

  const load = useCallback(async () => {
    const d = await run(() => api<TenantDetail>(`/superadmin/tenants/${id}`));
    if (d) {
      setT(d);
      setPlan(d.subscription?.plan ?? "FREE");
      setLimit(d.subscription?.tableSessionLimit ?? 50);
    }
  }, [run, id]);
  useEffect(() => {
    void load();
  }, [load]);

  const patchSub = async (body: Record<string, unknown>, ok: string) => {
    if (await run(() => api(`/superadmin/tenants/${id}/subscription`, { method: "PATCH", body }), ok)) {
      await load();
      await onChanged();
    }
  };

  const suspend = async (action: "suspend" | "unsuspend") => {
    if (action === "suspend" && !confirm(`¿Suspender "${t?.name}"? El staff no podrá entrar y la carta no abrirá mesas.`)) return;
    if (await run(() => api(`/superadmin/tenants/${id}/${action}`, { method: "POST", body: { reason: reason || undefined } }), action === "suspend" ? "Bar suspendido" : "Bar reactivado")) {
      await load();
      await onChanged();
    }
  };

  const resetPassword = async (userId: string, email: string) => {
    if (!confirm(`¿Generar una contraseña temporal para ${email}? La actual deja de funcionar.`)) return;
    const r = await run(() => api<{ email: string; temporaryPassword: string }>(`/superadmin/staff/${userId}/reset-password`, { method: "POST" }));
    if (r) setTemp(r);
  };

  return (
    <Modal open wide title={t?.name ?? "Bar"} onClose={onClose} footer={<Btn onClick={onClose}>Cerrar</Btn>}>
      {view}
      {!t ? (
        <Empty>Cargando…</Empty>
      ) : (
        <div className="grid gap-4">
          {t.suspendedAt && (
            <p className="rounded-xl bg-warn/15 px-3 py-2 text-sm text-warn">
              Suspendido el {new Date(t.suspendedAt).toLocaleString("es-AR")}
              {t.suspendReason ? `: ${t.suspendReason}` : ""}
            </p>
          )}

          <Card>
            <h3 className="mb-3 font-display text-lg">Plan y cuota</h3>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Plan">
                <select className={inputCls} value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
                  <option value="FREE">FREE</option>
                  <option value="PRO">PRO</option>
                  <option value="CANCELED">CANCELED</option>
                </select>
              </Field>
              <Field label="Mesas por mes (FREE)">
                <input className={`${inputCls} w-28`} type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
              </Field>
              <Btn kind="primary" onClick={() => patchSub({ plan, tableSessionLimit: limit }, "Plan actualizado")}>Guardar plan</Btn>
            </div>
            {t.subscription && (
              <p className="mt-3 text-sm text-muted">
                Uso: {t.subscription.tableSessionsThisMonth} / {t.subscription.tableSessionLimit} · vence el{" "}
                {new Date(t.subscription.currentPeriodEnd).toLocaleDateString("es-AR")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn size="sm" onClick={() => patchSub({ resetUsage: true }, "Uso reiniciado")}>Reiniciar uso del mes</Btn>
              <Btn size="sm" onClick={() => patchSub({ extendDays: 30 }, "Período extendido 30 días")}>Extender 30 días</Btn>
            </div>
          </Card>

          <Card>
            <h3 className="mb-3 font-display text-lg">Estado</h3>
            {t.suspendedAt ? (
              <Btn kind="ok" onClick={() => suspend("unsuspend")}>Reactivar bar</Btn>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input className={`${inputCls} max-w-sm`} placeholder="Motivo (opcional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                <Btn kind="danger" onClick={() => suspend("suspend")}>Suspender</Btn>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="mb-2 font-display text-lg">Equipo</h3>
            {temp && (
              <div className="mb-3 rounded-xl border border-ok/40 bg-ok/10 p-3 text-sm">
                Contraseña temporal para <b>{temp.email}</b>:{" "}
                <code className="rounded bg-surface-2 px-2 py-0.5 font-mono text-cream">{temp.temporaryPassword}</code>
                <p className="mt-1 text-xs text-muted">Se muestra una sola vez. Pasala por un canal privado y pedile que la cambie.</p>
              </div>
            )}
            <ul className="divide-y divide-line">
              {t.staffUsers.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="flex-1">
                    {u.name} <span className="text-muted">· {u.email}</span>
                  </span>
                  <Badge>{ROLE_LABEL[u.role]}</Badge>
                  {!u.active && <Badge tone="warn">de baja</Badge>}
                  <Btn size="sm" onClick={() => resetPassword(u.id, u.email)}>Contraseña temporal</Btn>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 font-display text-lg">Actividad reciente</h3>
            {t.audit.length === 0 ? (
              <p className="text-sm text-muted">Sin registros.</p>
            ) : (
              <ul className="grid gap-1 text-xs">
                {t.audit.slice(0, 20).map((a) => (
                  <li key={String(a.id)} className="flex gap-2">
                    <span className="w-36 shrink-0 text-muted">{new Date(a.createdAt).toLocaleString("es-AR")}</span>
                    <span className="font-mono">{a.action}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Modal>
  );
}

function CreateTenantModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { run, view } = useToasts();
  const [f, setF] = useState({ barName: "", ownerName: "", email: "", password: "", plan: "FREE" as "FREE" | "PRO", tableSessionLimit: 50 });
  const valid = f.barName.trim().length >= 2 && f.ownerName.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email) && f.password.length >= 8;
  const save = async () => {
    if (await run(() => api("/superadmin/tenants", { method: "POST", body: f }), "Bar creado con 10 mesas y su QR")) {
      await onCreated();
      onClose();
    }
  };
  return (
    <Modal
      open
      title="Dar de alta un bar"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn kind="primary" disabled={!valid} onClick={save}>Crear bar</Btn>
        </>
      }
    >
      {view}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre del bar">
          <input autoFocus className={inputCls} value={f.barName} onChange={(e) => setF({ ...f, barName: e.target.value })} />
        </Field>
        <Field label="Nombre del dueño">
          <input className={inputCls} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
        </Field>
        <Field label="Email del dueño">
          <input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Contraseña inicial" hint="Mínimo 8 caracteres">
          <input className={inputCls} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Plan">
          <select className={inputCls} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value as "FREE" | "PRO" })}>
            <option value="FREE">FREE</option>
            <option value="PRO">PRO</option>
          </select>
        </Field>
        <Field label="Mesas por mes (FREE)">
          <input className={inputCls} type="number" min={1} value={f.tableSessionLimit} onChange={(e) => setF({ ...f, tableSessionLimit: Number(e.target.value) })} />
        </Field>
      </div>
    </Modal>
  );
}

function AuditList() {
  const { run, view } = useToasts();
  const [rows, setRows] = useState<SaAudit[] | null>(null);
  useEffect(() => {
    void run(() => api<SaAudit[]>("/superadmin/audit")).then((r) => r && setRows(r));
  }, [run]);
  if (!rows) return <Empty>Cargando…</Empty>;
  if (rows.length === 0) return <Empty>Sin registros todavía.</Empty>;
  return (
    <Card className="overflow-x-auto p-0">
      {view}
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs tracking-wide text-muted uppercase">
          <tr className="border-b border-line">
            <th className="p-3">Fecha</th>
            <th className="p-3">Bar</th>
            <th className="p-3">Acción</th>
            <th className="p-3">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/60 last:border-0">
              <td className="p-3 text-muted">{new Date(r.createdAt).toLocaleString("es-AR")}</td>
              <td className="p-3">{r.tenantName}</td>
              <td className="p-3 font-mono text-xs">{r.action}</td>
              <td className="max-w-xs truncate p-3 font-mono text-xs text-muted">{r.data ? JSON.stringify(r.data) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
