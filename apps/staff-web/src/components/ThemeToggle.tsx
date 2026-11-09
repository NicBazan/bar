"use client";

import { useEffect, useState } from "react";
import { THEME_KEY } from "@/lib/theme";

/**
 * Tema de la pantalla: Automático (sigue al sistema), Claro u Oscuro. Se recuerda en este dispositivo.
 * Solo cambia `data-theme` en <html>: los colores salen de los tokens de globals.css.
 */
type Theme = "auto" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<Theme, string> = { auto: "Tema automático", light: "Tema claro", dark: "Tema oscuro" };
const ICON: Record<Theme, string> = { auto: "◐", light: "☀", dark: "☾" };


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
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      title={`${LABEL[theme]}. Tocá para pasar a: ${LABEL[next].toLowerCase()}`}
      aria-label={`${LABEL[theme]}. Cambiar a ${LABEL[next].toLowerCase()}`}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-base text-cream ${className}`}
    >
      <span aria-hidden>{ICON[theme]}</span>
    </button>
  );
}
