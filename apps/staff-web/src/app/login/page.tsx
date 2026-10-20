"use client";

import { useState } from "react";
import { ApiError, type StaffUser, api, setAuth } from "@/lib/api";

const HOME_BY_ROLE: Record<StaffUser["role"], string> = {
  SUPER_ADMIN: "/superadmin",
  OWNER: "/admin",
  MANAGER: "/waiter",
  WAITER: "/waiter",
  KITCHEN: "/kds",
  CASHIER: "/waiter",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; user: StaffUser }>("/staff/login", { method: "POST", body: { email, password } });
      setAuth(res.token, res.user);
      window.location.href = HOME_BY_ROLE[res.user.role];
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Email o contraseña incorrectos" : err instanceof ApiError && err.status === 429 ? "Demasiados intentos, esperá un minuto" : "No se pudo conectar con el servidor");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6">
        <p className="text-sm text-muted">Panel del local</p>
        <h1 className="mb-6 font-display text-3xl">Ingresar</h1>
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-muted">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-amber" />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-muted">Contraseña</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 outline-none focus:border-amber" />
        </label>
        {error && <p className="mb-3 text-sm text-warn">{error}</p>}
        <button disabled={busy} className="h-11 w-full rounded-full bg-amber font-semibold text-amber-ink disabled:opacity-50">
          {busy ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
