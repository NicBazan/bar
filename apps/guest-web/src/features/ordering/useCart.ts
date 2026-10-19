"use client";

import { useCallback, useEffect, useState } from "react";
import { load, remove, save } from "@/lib/storage";

export type CartLine = {
  lineId: string;
  dishId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  modifierIds: string[];
  modifierNames: string[];
  unitPriceCents: number; // precio estimado para mostrar; el real lo calcula la API
  quantity: number;
  note?: string;
};

/** Carrito local por mesa: sobrevive a recargas y a que el celular se bloquee */
export function useCart(tag: string) {
  const key = `bar.cart.${tag}`;
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => setLines(load<CartLine[]>(key, [])), [key]);
  useEffect(() => save(key, lines), [key, lines]);

  const add = useCallback((line: Omit<CartLine, "lineId">) => {
    setLines((ls) => {
      // Misma combinación de plato + opciones + nota → suma cantidad
      const same = ls.find(
        (l) =>
          l.dishId === line.dishId &&
          l.variantId === line.variantId &&
          l.note === line.note &&
          l.modifierIds.join() === line.modifierIds.join(),
      );
      if (same) return ls.map((l) => (l === same ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l));
      return [...ls, { ...line, lineId: crypto.randomUUID() }];
    });
  }, []);

  const setQty = useCallback((lineId: string, quantity: number) => {
    setLines((ls) =>
      quantity <= 0 ? ls.filter((l) => l.lineId !== lineId) : ls.map((l) => (l.lineId === lineId ? { ...l, quantity } : l)),
    );
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    remove(key);
  }, [key]);

  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const totalCents = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);

  return { lines, add, setQty, clear, count, totalCents };
}
