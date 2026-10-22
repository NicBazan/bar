"use client";

import { useState } from "react";
import { DishSheet } from "@/features/menu/DishSheet";
import type { Dish } from "@/lib/api";
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
  variants?: Dish["variants"];
  modifierGroups?: Dish["modifierGroups"];
  /** Diseño elegido por el dueño en Admin → Local: tarjetas (clásico), pantalla completa (reels) o lista compacta */
  layout?: MenuLayout;
}

export type MenuLayout = "classic" | "reels" | "list";

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
  variants = [],
  modifierGroups = [],
  layout = "classic",
}: DishCardProps) {
  const [added, setAdded] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  // Platos con tamaños u opciones (punto de cocción, extras) se eligen en la hoja de detalle
  const needsChoice = variants.length > 0 || modifierGroups.length > 0;
  const displayPrice = variants.length > 0 ? Math.min(...variants.map((v) => v.priceCents)) : priceCents;

  const flashAdded = () => {
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const handleAdd = () => {
    if (!available) return;
    if (needsChoice) return setChoosing(true);
    addItem({ dishId: id, name, priceCents, modifierIds: [], modifierNames: [] });
    flashAdded();
  };

  const addLabel = needsChoice ? "Elegir opciones" : "Agregar al pedido";

  const sheet = choosing && (
    <DishSheet
      dish={{ id, name, description, priceCents, available, tags, allergens, variants, modifierGroups, assets: {} }}
      currency={currency}
      canAdd
      onClose={() => setChoosing(false)}
      onAdd={(line) => {
        addItem({
          dishId: line.dishId,
          name: line.name,
          variantId: line.variantId,
          variantName: line.variantName,
          modifierIds: line.modifierIds,
          modifierNames: line.modifierNames,
          note: line.note,
          priceCents: line.unitPriceCents,
          quantity: line.quantity,
        });
        flashAdded();
      }}
    />
  );

  const price = (
    <>
      {variants.length > 0 && <span className="text-xs font-normal text-muted">desde </span>}
      {formatMoney(displayPrice, currency)}
    </>
  );

  if (layout === "list") {
    return (
      <article className="flex items-center gap-3 border-b border-line/50 py-3 last:border-b-0">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 text-2xl">
          {posterUrl ? <img src={posterUrl} alt="" className="h-full w-full object-cover" /> : glbUrl ? "✨" : "🍽️"}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-medium text-cream">
            {name}
            {!available && <span className="ml-2 text-[10px] font-semibold text-warn">Agotado</span>}
          </h3>
          {description && <p className="truncate text-xs text-muted">{description}</p>}
          <p className="mt-0.5 text-sm font-semibold text-amber">{price}</p>
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!available}
          aria-label={`${addLabel}: ${name}`}
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-bold transition active:scale-95 disabled:opacity-40 ${
            added ? "bg-ok text-ink" : "bg-amber text-amber-ink"
          }`}
        >
          {added ? "✓" : "+"}
        </button>
        {sheet}
      </article>
    );
  }

  if (layout === "reels") {
    return (
      <article className="relative flex h-[calc(100dvh-7rem)] min-h-[480px] snap-start scroll-mt-16 flex-col overflow-hidden rounded-3xl border border-line/70 bg-surface">
        <div className="relative min-h-0 flex-1 bg-surface-2">
          {glbUrl ? (
            <Dish3DViewer glbUrl={glbUrl} usdzUrl={usdzUrl} posterUrl={posterUrl} altText={name} />
          ) : posterUrl ? (
            <img src={posterUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-6xl">🍽️</div>
          )}
        </div>
        <div className="p-5">
          {tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-cream/70">{t}</span>
              ))}
            </div>
          )}
          <h3 className="font-display text-2xl text-cream">{name}</h3>
          {description && <p className="mt-1 line-clamp-3 text-sm text-muted">{description}</p>}
          {allergens.length > 0 && <p className="mt-1 text-[11px] text-warn/80">Contiene {allergens.join(", ")}</p>}
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="font-display text-2xl font-semibold text-amber">{price}</span>
            <button
              type="button"
              onClick={handleAdd}
              disabled={!available}
              className={`h-12 rounded-2xl px-5 text-sm font-semibold transition active:scale-95 disabled:opacity-40 ${added ? "bg-ok text-ink" : "bg-amber text-amber-ink"}`}
            >
              {!available ? "Agotado" : added ? "✓ ¡Agregado!" : `+ ${addLabel}`}
            </button>
          </div>
        </div>
        {sheet}
      </article>
    );
  }

  return (
    <article className="group flex flex-col overflow-hidden rounded-3xl border border-line/70 bg-surface/90 shadow-sm shadow-night/5 transition-all duration-300 hover:border-amber/40 hover:shadow-amber/5">
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
              {price}
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
                <span>{addLabel}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {sheet}
    </article>
  );
}
