import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CartItem {
  dishId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  addItem: (item: { dishId: string; name: string; priceCents: number }) => void;
  removeItem: (dishId: string) => void;
  updateQuantity: (dishId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
  getTotalItems: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (newItem) => {
        set((state) => {
          const existingIndex = state.items.findIndex(
            (item) => item.dishId === newItem.dishId,
          );

          if (existingIndex > -1) {
            const updated = [...state.items];
            const current = updated[existingIndex]!;
            updated[existingIndex] = {
              ...current,
              quantity: current.quantity + 1,
            };
            return { items: updated };
          }

          return {
            items: [
              ...state.items,
              {
                dishId: newItem.dishId,
                name: newItem.name,
                priceCents: newItem.priceCents,
                quantity: 1,
              },
            ],
          };
        });
      },

      removeItem: (dishId) => {
        set((state) => ({
          items: state.items.filter((item) => item.dishId !== dishId),
        }));
      },

      updateQuantity: (dishId, quantity) => {
        set((state) => {
          if (quantity <= 0) {
            return {
              items: state.items.filter((item) => item.dishId !== dishId),
            };
          }

          return {
            items: state.items.map((item) =>
              item.dishId === dishId ? { ...item, quantity } : item,
            ),
          };
        });
      },

      clearCart: () => {
        set({ items: [] });
      },

      getTotalPrice: () => {
        return get().items.reduce(
          (sum, item) => sum + item.priceCents * item.quantity,
          0,
        );
      },

      getTotalItems: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },
    }),
    {
      name: "bar.cart-storage",
    },
  ),
);
