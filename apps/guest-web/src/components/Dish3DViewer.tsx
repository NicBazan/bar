"use client";

import { useEffect, useRef, useState } from "react";

export interface Dish3DViewerProps {
  glbUrl: string;
  usdzUrl?: string;
  posterUrl?: string;
  altText: string;
  className?: string;
}

export function Dish3DViewer({
  glbUrl,
  usdzUrl,
  posterUrl,
  altText,
  className = "",
}: Dish3DViewerProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  // <model-viewer> servido desde el propio sitio (sin CDN externo): funciona aunque el Wi-Fi
  // del bar no tenga salida a internet y permite una CSP estricta. Se carga solo si hay un plato 3D.
  useEffect(() => {
    void import("@google/model-viewer").catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const handleLoad = () => setLoaded(true);
    el.addEventListener("load", handleLoad);
    return () => {
      el.removeEventListener("load", handleLoad);
    };
  }, []);

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_center,_var(--color-surface-2)_0%,_var(--color-ink)_100%)] ${className}`}
    >
      {/* Visor 3D y WebAR */}
      <model-viewer
        ref={viewerRef}
        src={glbUrl}
        ios-src={usdzUrl}
        poster={posterUrl}
        alt={altText}
        ar
        ar-modes="webxr scene-viewer quick-look"
        camera-controls
        auto-rotate
        shadow-intensity="1"
        environment-image="neutral"
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          outline: "none",
        }}
      >
        {/* Botón nativo de Realidad Aumentada (model-viewer slot) */}
        <button
          slot="ar-button"
          type="button"
          className="absolute right-3 bottom-3 z-10 flex items-center gap-2 rounded-full border border-amber/40 bg-surface/90 px-4 py-2 text-xs font-semibold text-cream shadow-xl backdrop-blur-md transition-all duration-200 hover:border-amber hover:bg-surface-2 active:scale-95"
        >
          <span className="flex h-2 w-2 rounded-full bg-amber animate-ping"></span>
          <span>✨ Ver en tu mesa</span>
        </button>

        {/* Indicador de carga sutil antes del primer render 3D */}
        {!loaded && (
          <div
            slot="poster"
            className="flex h-full w-full items-center justify-center bg-surface-2/40"
          >
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={altText}
                className="h-full w-full object-cover opacity-80 transition-opacity duration-300"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted">
                <span className="text-2xl animate-spin">🍽️</span>
                <span className="text-xs">Cargando 3D...</span>
              </div>
            )}
          </div>
        )}
      </model-viewer>

      {/* Badge informativo de modo interactivo 3D */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-[11px] font-medium tracking-wide text-cream/80 backdrop-blur-md">
        <span>3D</span>
        <span className="text-muted/60">·</span>
        <span className="text-muted">Girá con el dedo</span>
      </div>
    </div>
  );
}
