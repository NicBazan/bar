"use client";

import { useMemo, useState } from "react";
import { Sheet } from "@/components/Sheet";
import type { Dish } from "@/lib/api";
import { formatMoney } from "@/lib/storage";
import type { CartLine } from "../ordering/useCart";

/** Detalle del plato: variantes, modificadores (con min/max), cantidad y nota */
export function DishSheet({ dish, currency, canAdd, onClose, onAdd }: {
  dish: Dish;
  currency: string;
  canAdd: boolean;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, "lineId">) => void;
}) {
  const [variantId, setVariantId] = useState<string | undefined>(dish.variants[0]?.id);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const toggle = (groupId: string, modId: string, max: number) =>
    setSelected((s) => {
      const cur = s[groupId] ?? [];
      if (cur.includes(modId)) return { ...s, [groupId]: cur.filter((m) => m !== modId) };
      if (max === 1) return { ...s, [groupId]: [modId] };
      if (cur.length >= max) return s;
      return { ...s, [groupId]: [...cur, modId] };
    });

  const allMods = dish.modifierGroups.flatMap((g) => g.modifiers);
  const modifierIds = Object.values(selected).flat();
  const variant = dish.variants.find((v) => v.id === variantId);
  const unit = (variant?.priceCents ?? dish.priceCents) + allMods.filter((m) => modifierIds.includes(m.id)).reduce((s, m) => s + m.priceCents, 0);

  const missing = useMemo(
    () => dish.modifierGroups.find((g) => (selected[g.id]?.length ?? 0) < g.minSelect),
    [dish.modifierGroups, selected],
  );

  const add = () => {
    onAdd({
      dishId: dish.id,
      name: dish.name,
      variantId: variant?.id,
      variantName: variant?.name,
      modifierIds,
      modifierNames: allMods.filter((m) => modifierIds.includes(m.id)).map((m) => m.name),
      unitPriceCents: unit,
      quantity,
      note: note.trim() || undefined,
    });
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={dish.name}
      footer={
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-full bg-surface-2">
            <button aria-label="Menos" className="h-11 w-11 text-xl" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
            <span className="w-6 text-center font-semibold">{quantity}</span>
            <button aria-label="Más" className="h-11 w-11 text-xl" onClick={() => setQuantity((q) => Math.min(20, q + 1))}>+</button>
          </div>
          <button
            disabled={!dish.available || Boolean(missing) || !canAdd}
            onClick={add}
            className="h-11 flex-1 rounded-full bg-amber font-semibold text-amber-ink disabled:opacity-40"
          >
            {!dish.available ? "Agotado" : missing ? `Elegí: ${missing.name}` : `Agregar · ${formatMoney(unit * quantity, currency)}`}
          </button>
        </div>
      }
    >
      {dish.description && <p className="text-muted">{dish.description}</p>}
      {(dish.allergens.length > 0 || dish.tags.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {dish.tags.map((t) => (
            <span key={t} className="rounded-full bg-ok/15 px-2.5 py-0.5 text-xs text-ok">{t.replace("_", " ")}</span>
          ))}
          {dish.allergens.map((a) => (
            <span key={a} className="rounded-full bg-warn/15 px-2.5 py-0.5 text-xs text-warn">contiene {a.replace("_", " ")}</span>
          ))}
        </div>
      )}

      {dish.variants.length > 0 && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Tamaño</legend>
          <div className="grid gap-2">
            {dish.variants.map((v) => (
              <label key={v.id} className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 ${variantId === v.id ? "border-amber bg-amber/10" : "border-line"}`}>
                <span className="flex items-center gap-3">
                  <input type="radio" name="variant" className="accent-amber" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                  {v.name}
                </span>
                <span className="text-muted">{formatMoney(v.priceCents, currency)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {dish.modifierGroups.map((g) => (
        <fieldset key={g.id} className="mt-5">
          <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            {g.name}{" "}
            <span className="font-normal normal-case">
              {g.minSelect > 0 ? "· obligatorio" : `· hasta ${g.maxSelect}`}
            </span>
          </legend>
          <div className="grid gap-2">
            {g.modifiers.map((m) => {
              const on = selected[g.id]?.includes(m.id) ?? false;
              return (
                <label key={m.id} className={`flex cursor-pointer items-center justify-between rounded-2xl border px-4 py-3 ${on ? "border-amber bg-amber/10" : "border-line"}`}>
                  <span className="flex items-center gap-3">
                    <input type={g.maxSelect === 1 ? "radio" : "checkbox"} className="accent-amber" checked={on} onChange={() => toggle(g.id, m.id, g.maxSelect)} />
                    {m.name}
                  </span>
                  {m.priceCents > 0 && <span className="text-muted">+{formatMoney(m.priceCents, currency)}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      <label className="mt-5 block">
        <span className="mb-2 block text-sm font-semibold uppercase tracking-wide text-muted">Aclaraciones</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Ej.: sin cebolla"
          className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-amber"
        />
      </label>
      {!canAdd && <p className="mt-4 text-sm text-warn">Esperá a que el mozo abra la mesa para agregar platos.</p>}
    </Sheet>
  );
}
