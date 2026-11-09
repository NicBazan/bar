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

/** Ingreso del staff: panel claro con la barra naranja a la izquierda + formulario */
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
      setAuth(res.user); // la sesión queda en la cookie HttpOnly que puso la API
      window.location.href = HOME_BY_ROLE[res.user.role];
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Email o contraseña incorrectos" : err instanceof ApiError && err.status === 429 ? "Demasiados intentos, esperá un minuto" : "No se pudo conectar con el servidor");
    } finally {
      setBusy(false);
    }
  };

  const input = "h-12 w-full rounded-2xl border border-line bg-white px-4 text-base outline-none transition focus:border-amber";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="grid w-full max-w-md overflow-hidden rounded-lg border border-line bg-surface md:max-w-4xl md:grid-cols-2">
        <section className="flex flex-col justify-between gap-8 border-b border-line border-l-4 border-l-amber bg-paper p-8 text-cream md:border-r md:border-b-0 md:p-10">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg border border-line bg-surface text-lg">🍸</span>
            <span className="text-sm font-semibold">Panel del local</span>
          </div>
          <div>
            <h1 className="text-3xl leading-tight font-semibold md:text-4xl">Tu salón, tu cocina y tus clientes en un solo lugar.</h1>
            <p className="mt-3 text-sm text-muted">Mozos, cocina, dueño y administración de la plataforma entran por acá.</p>
          </div>
          <div className="hidden gap-2 md:flex" aria-hidden>
            {["Salón", "Cocina", "Admin"].map((t) => (
              <span key={t} className="rounded-lg border border-line bg-surface px-3 py-1 text-xs text-muted">{t}</span>
            ))}
          </div>
        </section>

        <form onSubmit={submit} className="p-8 md:p-10">
          <p className="text-sm text-muted">Bienvenido</p>
          <h2 className="mb-6 text-2xl font-semibold">Ingresar</h2>
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium">Email</span>
            <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </label>
          <label className="mb-5 block">
            <span className="mb-1.5 block text-sm font-medium">Contraseña</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
          </label>
          {error && <p role="alert" className="mb-4 rounded-2xl bg-amber/10 px-4 py-3 text-sm text-brand-dark">{error}</p>}
          <button disabled={busy} className="h-12 w-full rounded-2xl bg-amber font-semibold text-amber-ink transition hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </main>
  );
}
