"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

// Componentes mínimos del panel: el mismo lenguaje visual que salón y KDS

export function Btn({
  children,
  onClick,
  kind = "secondary",
  disabled,
  type = "button",
  size = "md",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost" | "ok";
  disabled?: boolean;
  type?: "button" | "submit";
  size?: "sm" | "md";
  title?: string;
}) {
  const styles = {
    primary: "bg-amber text-amber-ink font-semibold",
    secondary: "bg-surface-2 text-cream border border-line",
    danger: "bg-warn/15 text-warn border border-warn/40",
    ghost: "text-muted hover:text-cream",
    ok: "bg-ok/15 text-ok border border-ok/40",
  }[kind];
  const sizes = size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm";
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl transition active:scale-95 disabled:opacity-40 ${sizes} ${styles}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-cream outline-none placeholder:text-muted/60 focus:border-amber";

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-ok" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-cream transition-all ${checked ? "left-5.5" : "left-0.5"}`} />
    </button>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "amber" }) {
  const t = {
    muted: "bg-surface-2 text-muted",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    amber: "bg-amber/15 text-amber",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface p-4 ${className}`}>{children}</section>;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Cerrar" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-line bg-surface sm:rounded-3xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-xl">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-surface-2 px-3 py-1 text-sm text-muted">Cerrar</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

type Toast = { id: number; text: string; tone: "ok" | "warn" };

/** Avisos efímeros + helper para correr acciones con manejo de error uniforme */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (okText) push(okText);
        return r;
      } catch (e) {
        push(e instanceof ApiError ? errorText(e) : "Sin conexión con el servidor", "warn");
        return undefined;
      }
    },
    [push],
  );
  const view = (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`rounded-2xl px-4 py-2.5 text-sm font-medium shadow-lg ${t.tone === "ok" ? "bg-ok text-ink" : "bg-warn text-ink"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
  return { push, run, view };
}

export function errorText(e: ApiError): string {
  if (e.code === "VALIDATION") return "Revisá los datos: hay campos inválidos";
  if (e.code === "ROLE_NOT_ALLOWED") return e.message !== e.code ? e.message : "No tenés permiso para esto";
  return e.message && e.message !== e.code ? e.message : e.code;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</p>;
}
