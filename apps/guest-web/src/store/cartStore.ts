import { create } from "zustand";
import { persist } from "zustand/middleware";
import { uuid } from "@/lib/storage";

/**
 * Una línea del carrito = plato + opción elegida (variante, modificadores, nota).
 * Dos "Bife" con distinto punto de cocción son líneas distintas.
 */
export interface CartItem {
  lineId: string;
  dishId: string;
  name: string;
  variantId?: string;
  variantName?: string;
  modifierIds: string[];
  modifierNames: string[];
  note?: string;
  priceCents: number; // unitario estimado (variante + extras); el precio real lo calcula la API
  quantity: number;
}

export type NewCartItem = Omit<CartItem, "lineId" | "quantity"> & { quantity?: number };

interface CartState {
  tag: string | null;
  items: CartItem[];
  /** El carrito es por mesa: si cambia el tag, se vacía */
  bindToTable: (tag: string) => void;
  addItem: (item: NewCartItem) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
  getTotalItems: () => number;
}

const sameChoice = (a: CartItem, b: NewCartItem) =>
  a.dishId === b.dishId &&
  a.variantId === b.variantId &&
  (a.note ?? "") === (b.note ?? "") &&
  [...a.modifierIds].sort().join() === [...b.modifierIds].sort().join();

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      tag: null,
      items: [],

      bindToTable: (tag) => {
        if (get().tag !== tag) set({ tag, items: [] });
      },

      addItem: (newItem) => {
        const qty = newItem.quantity ?? 1;
        set((state) => {
          const existing = state.items.find((item) => sameChoice(item, newItem));
          if (existing) {
            return {
              items: state.items.map((item) =>
                item === existing ? { ...item, quantity: Math.min(20, item.quantity + qty) } : item,
              ),
            };
          }
          const { quantity: _q, ...rest } = newItem;
          return { items: [...state.items, { ...rest, lineId: uuid(), quantity: qty }] };
        });
      },

      removeItem: (lineId) => {
        set((state) => ({ items: state.items.filter((item) => item.lineId !== lineId) }));
      },

      updateQuantity: (lineId, quantity) => {
        set((state) =>
          quantity <= 0
            ? { items: state.items.filter((item) => item.lineId !== lineId) }
            : { items: state.items.map((item) => (item.lineId === lineId ? { ...item, quantity: Math.min(20, quantity) } : item)) },
        );
      },

      clearCart: () => set({ items: [] }),

      getTotalPrice: () => get().items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0),

      getTotalItems: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
    }),
    {
      name: "bar.cart-storage",
      version: 2,
      // Carritos guardados con el formato viejo (sin lineId) se descartan
      migrate: () => ({ tag: null, items: [] }),
    },
  ),
);
