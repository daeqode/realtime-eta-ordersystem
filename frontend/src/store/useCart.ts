import { create } from 'zustand'
import type { CartItem } from '../types'

interface CartState {
  storeId: number | null
  items: CartItem[]
  addItem: (storeId: number, item: Omit<CartItem, 'quantity'> & { quantity?: number }) => void
  removeItem: (index: number) => void
  updateQuantity: (index: number, delta: number) => void
  clear: () => void
}

const useCart = create<CartState>((set) => ({
  storeId: null,
  items: [],

  addItem: (storeId, incoming) =>
    set((state) => {
      const item: CartItem = { ...incoming, quantity: incoming.quantity ?? 1 }

      if (state.storeId !== null && state.storeId !== storeId) {
        return { storeId, items: [item] }
      }

      const idx = state.items.findIndex(
        (i) =>
          i.menuId === item.menuId &&
          JSON.stringify([...i.choiceIds].sort()) ===
            JSON.stringify([...item.choiceIds].sort()),
      )
      if (idx !== -1) {
        const items = [...state.items]
        items[idx] = { ...items[idx], quantity: items[idx].quantity + item.quantity }
        return { storeId, items }
      }
      return { storeId, items: [...state.items, item] }
    }),

  removeItem: (index) =>
    set((state) => ({ items: state.items.filter((_, i) => i !== index) })),

  updateQuantity: (index, delta) =>
    set((state) => ({
      items: state.items
        .map((item, i) => (i === index ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0),
    })),

  clear: () => set({ storeId: null, items: [] }),
}))

export const useCartTotal = () =>
  useCart((s) => s.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0))

export default useCart
