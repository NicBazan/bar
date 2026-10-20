"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, Card, Empty, Field, Modal, inputCls, useToasts } from "@/components/ui";
import { type AdminStaff, ROLE_LABEL, type StaffRole, api, getAuth } from "@/lib/api";

const ASSIGNABLE: Record<string, StaffRole[]> = {
  OWNER: ["MANAGER", "WAITER", "KITCHEN", "CASHIER"],
  MANAGER: ["WAITER", "KITCHEN", "CASHIER"],
};

export function Team() {
  const { run, view } = useToasts();
  const [staff, setStaff] = useState<AdminStaff[] | null>(null);
  const [modal, setModal] = useState<AdminStaff | "new" | null>(null);
  const me = getAuth()?.user;
  const roles = ASSIGNABLE[me?.role ?? ""] ?? [];

  const load = useCallback(async () => {
    const s = await run(() => api<AdminStaff[]>("/admin/staff"));
    if (s) setStaff(s);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (u: AdminStaff) => {
    if (u.active && !confirm(`¿Dar de baja a ${u.name}? Pierde el acceso enseguida.`)) return;
    if (await run(() => api(`/admin/staff/${u.id}`, { method: "PATCH", body: { active: !u.active } }), u.active ? "Usuario dado de baja" : "Usuario reactivado")) {
      await load();
    }
  };

  if (!staff) return <Empty>Cargando equipo…</Empty>;

  const canEdit = (u: AdminStaff) => u.id !== me?.id && u.role !== "OWNER" && !(me?.role === "MANAGER" && u.role === "MANAGER");

  return (
    <div className="grid gap-4">
      {view}
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted">Cada persona entra con su email. Mozos ven el salón, cocina ve el KDS.</p>
        <span className="flex-1" />
        <Btn kind="primary" onClick={() => setModal("new")}>+ Persona</Btn>
      </div>
      <Card>
        <ul className="divide-y divide-line">
          {staff.map((u) => (
            <li key={u.id} className={`flex flex-wrap items-center gap-3 py-3 ${u.active ? "" : "opacity-50"}`}>
              <div className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 font-semibold">{u.name.slice(0, 1).toUpperCase()}</div>
              <div className="min-w-40 flex-1">
                <p className="font-semibold">
                  {u.name} {u.id === me?.id && <Badge>vos</Badge>}
                </p>
                <p className="text-sm text-muted">{u.email}</p>
              </div>
              <Badge tone={u.role === "OWNER" ? "amber" : "muted"}>{ROLE_LABEL[u.role]}</Badge>
              {!u.active && <Badge tone="warn">de baja</Badge>}
              {canEdit(u) && (
                <div className="flex gap-1.5">
                  <Btn size="sm" onClick={() => setModal(u)}>Editar</Btn>
                  <Btn size="sm" kind={u.active ? "danger" : "ok"} onClick={() => toggleActive(u)}>{u.active ? "Dar de baja" : "Reactivar"}</Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {modal && <StaffModal user={modal === "new" ? null : modal} roles={roles} onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}

function StaffModal({ user, roles, onClose, onSaved }: { user: AdminStaff | null; roles: StaffRole[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run, view } = useToasts();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<StaffRole>(user?.role ?? roles[1] ?? roles[0] ?? "WAITER");
  const [password, setPassword] = useState("");
  const isNew = user === null;
  const valid = name.trim().length >= 2 && (isNew ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && password.length >= 8 : password === "" || password.length >= 8);

  const save = async () => {
    const ok = await run(
      () =>
        isNew
          ? api("/admin/staff", { method: "POST", body: { name: name.trim(), email: email.trim(), password, role } })
          : api(`/admin/staff/${user.id}`, { method: "PATCH", body: { name: name.trim(), role, ...(password ? { password } : {}) } }),
      isNew ? "Persona agregada" : "Cambios guardados",
    );
    if (ok) {
      await onSaved();
      onClose();
    }
  };

  return (
    <Modal
      open
      title={isNew ? "Agregar persona" : `Editar a ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn kind="primary" disabled={!valid} onClick={save}>Guardar</Btn>
        </>
      }
    >
      {view}
      <div className="grid gap-3">
        <Field label="Nombre">
          <input autoFocus className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className={inputCls} type="email" value={email} disabled={!isNew} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Rol">
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {roles.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </Field>
        <Field label={isNew ? "Contraseña" : "Nueva contraseña (opcional)"} hint="Mínimo 8 caracteres. Pasásela en persona, no por un chat grupal.">
          <input className={inputCls} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
