"use client";

import { type StaffUser, api, clearAuth } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";

export function StaffHeader({ user, title, online, audioOn, onStart, children, brand, contained }: {
  user: StaffUser;
  title: string;
  // Panel de la plataforma: muestra el logo de ZainSoft (el resto de los paneles son del bar)
  brand?: "zainsoft";
  // Pantallas de lectura (admin, plataforma): contenido centrado con ancho máximo. Salón y cocina usan todo el ancho
  contained?: boolean;
  // En salón y cocina: indicador "en vivo" y botón para habilitar el sonido
  online?: boolean;
  audioOn?: boolean;
  onStart?: () => void;
  children?: React.ReactNode;
}) {
  const logout = async () => {
    // La cookie HttpOnly solo la borra el servidor; el token local lo borramos acá
    await api("/staff/logout", { method: "POST" }).catch(() => undefined);
    clearAuth();
    window.location.href = "/login";
  };
  const canSwitch = user.role === "OWNER" || user.role === "MANAGER";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${contained ? "mx-auto max-w-6xl md:px-6" : ""}`}>
      {brand === "zainsoft" && (
        <span className="flex items-center" aria-label="ZainSoft">
          <img src="/zainsoft/logo.png" alt="ZainSoft" className="logo-on-light h-9 w-auto" />
          <img src="/zainsoft/logo-dark.png" alt="ZainSoft" className="logo-on-dark h-9 w-auto" />
        </span>
      )}
      <h1 className="font-display text-2xl">{title}</h1>
      {online !== undefined && (
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${online ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>
          <span className={`h-2 w-2 rounded-full ${online ? "bg-ok" : "bg-warn"}`} />
          {online ? "En vivo" : "Sin conexión"}
        </span>
      )}
      {canSwitch && (
        <nav className="flex gap-1 text-sm">
          <a href="/admin" className="rounded-full bg-surface-2 px-3 py-1">Admin</a>
          <a href="/waiter" className="rounded-full bg-surface-2 px-3 py-1">Salón</a>
          <a href="/kds" className="rounded-full bg-surface-2 px-3 py-1">Cocina</a>
        </nav>
      )}
      {children}
      <div className="ml-auto flex items-center gap-2">
        {onStart && !audioOn && (
          <button onClick={onStart} className="rounded-full bg-amber px-4 py-1.5 text-sm font-semibold text-amber-ink">
            🔔 Iniciar turno
          </button>
        )}
        <ThemeToggle />
        <span className="hidden text-sm text-muted sm:inline">{user.name}</span>
        <button onClick={logout} className="rounded-full border border-line px-3 py-1 text-sm text-muted">Salir</button>
      </div>
      </div>
    </header>
  );
}
