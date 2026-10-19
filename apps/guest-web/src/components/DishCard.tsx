"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/storage";
import { useCartStore } from "@/store/cartStore";
import { Dish3DViewer } from "./Dish3DViewer";

export interface DishCardProps {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency?: string;
  available?: boolean;
  tags?: string[];
  allergens?: string[];
  glbUrl?: string;
  usdzUrl?: string;
  posterUrl?: string;
}

export function DishCard({
  id,
  name,
  description,
  priceCents,
  currency = "ARS",
  available = true,
  tags = [],
  allergens = [],
  glbUrl,
  usdzUrl,
  posterUrl,
}: DishCardProps) {
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  const handleAdd = () => {
    if (!available) return;
    addItem({ dishId: id, name, priceCents });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-line/70 bg-surface/90 shadow-lg shadow-black/40 transition-all duration-300 hover:border-amber/40 hover:shadow-amber/5">
      {/* Cabecera visual: Visor 3D interactivo si tiene GLB, o imagen/poster */}
      {glbUrl ? (
        <div className="h-[250px] w-full">
          <Dish3DViewer
            glbUrl={glbUrl}
            usdzUrl={usdzUrl}
            posterUrl={posterUrl}
            altText={name}
          />
        </div>
      ) : posterUrl ? (
        <div className="relative h-[180px] w-full overflow-hidden bg-surface-2">
          <img
            src={posterUrl}
            alt={name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface to-transparent"></div>
        </div>
      ) : null}

      {/* Cuerpo de la tarjeta con tipografía y datos */}
      <div className="flex flex-1 flex-col justify-between p-5">
        <div>
          {/* Etiquetas y Alérgenos */}
          {(tags.length > 0 || allergens.length > 0 || glbUrl) && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {glbUrl && (
                <span className="rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[10px] font-semibold text-amber">
                  ✨ 3D / AR
                </span>
              )}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-cream/70"
                >
                  {tag}
                </span>
              ))}
              {allergens.map((allergen) => (
                <span
                  key={allergen}
                  className="rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[10px] text-warn/80"
                >
                  contiene {allergen}
                </span>
              ))}
            </div>
          )}

          {/* Título y descripción */}
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-xl font-medium tracking-tight text-cream">
              {name}
            </h3>
            {!available && (
              <span className="shrink-0 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-semibold text-warn">
                Agotado
              </span>
            )}
          </div>

          {description && (
            <p className="mt-2 text-xs leading-relaxed text-muted line-clamp-2">
              {description}
            </p>
          )}
        </div>

        {/* Footer: Precio y Botón de Agregar a Zustand */}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-line/40 pt-3">
          <div>
            <span className="text-[10px] tracking-wider text-muted uppercase">Precio</span>
            <div className="font-display text-lg font-semibold text-amber">
              {formatMoney(priceCents, currency)}
            </div>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            disabled={!available}
            className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold transition-all duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
              added
                ? "bg-ok text-ink shadow-md shadow-ok/20 scale-105"
                : "border border-line bg-surface-2 text-cream hover:border-amber hover:bg-surface hover:text-amber"
            }`}
          >
            {added ? (
              <>
                <span>✓</span>
                <span>¡Agregado!</span>
              </>
            ) : (
              <>
                <span>+</span>
                <span>Agregar al pedido</span>
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
