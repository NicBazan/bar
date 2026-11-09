"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { THEME_KEY } from "@/lib/theme";

/**
 * Tema de la pantalla: Automático (sigue al sistema), Claro u Oscuro. Se recuerda en este dispositivo.
 * Solo cambia `data-theme` en <html>: los colores salen de los tokens de globals.css.
 *
 * Efecto: el tema nuevo "inunda" la pantalla con un círculo que nace en el botón (View Transitions API).
 * Sin soporte del navegador o con "reducir movimiento" activado, el cambio es instantáneo.
 */
type Theme = "auto" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<Theme, string> = { auto: "Tema automático", light: "Tema claro", dark: "Tema oscuro" };
const ICON: Record<Theme, string> = { auto: "◐", light: "☀", dark: "☾" };
const REVEAL_MS = 600;

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* sin almacenamiento: el tema dura hasta recargar */
  }
}

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };

/** Aplica `change` revelándolo con un círculo que crece desde (x, y) hasta la esquina más lejana */
function revealFrom(x: number, y: number, change: () => void) {
  const doc = document as ViewTransitionDoc;
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    change();
    return;
  }
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  // Una sola vez: si el navegador no llega a dibujar (pestaña oculta), el tema igual cambia al segundo
  let applied = false;
  const applyOnce = () => {
    if (applied) return;
    applied = true;
    flushSync(change);
  };
  const transition = doc.startViewTransition(applyOnce);
  window.setTimeout(applyOnce, 1000);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: REVEAL_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => undefined); // si la transición se cancela, el tema igual quedó aplicado
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setTheme(t === "light" || t === "dark" ? t : "auto");
  }, []);
  const next = NEXT[theme];
  return (
    <button
      type="button"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        revealFrom(box.left + box.width / 2, box.top + box.height / 2, () => {
          applyTheme(next);
          setTheme(next);
        });
      }}
      title={`${LABEL[theme]}. Tocá para pasar a: ${LABEL[next].toLowerCase()}`}
      aria-label={`${LABEL[theme]}. Cambiar a ${LABEL[next].toLowerCase()}`}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-base text-cream ${className}`}
    >
      <span aria-hidden>{ICON[theme]}</span>
    </button>
  );
}
