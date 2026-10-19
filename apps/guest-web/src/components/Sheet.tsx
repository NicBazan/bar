"use client";

import { useEffect } from "react";

/** Hoja inferior (bottom sheet) para mobile */
export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
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
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button aria-label="Cerrar" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="animate-sheet relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-line bg-surface">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-display text-xl">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-surface-2 px-3 py-1 text-sm text-muted">
            Cerrar
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts({ items }: { items: Array<{ id: number; text: string; tone: "info" | "success" | "warn" }> }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      {items.map((n) => (
        <div
          key={n.id}
          className={`max-w-sm rounded-2xl px-4 py-2.5 text-sm font-medium shadow-lg ${
            n.tone === "success" ? "bg-ok text-ink" : n.tone === "warn" ? "bg-warn text-ink" : "bg-surface-2 text-cream"
          }`}
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}
