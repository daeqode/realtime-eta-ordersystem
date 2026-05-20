import type { Store, Menu, PickupSlot, OrderResponse, StoreEta } from '../types'

const BASE = '/api'

export async function fetchStores(): Promise<Store[]> {
  const r = await fetch(`${BASE}/stores`)
  if (!r.ok) throw new Error('매장 목록을 불러오지 못했습니다')
  return r.json()
}

export async function fetchStore(id: number): Promise<Store> {
  const r = await fetch(`${BASE}/stores/${id}`)
  if (!r.ok) throw new Error('매장 정보를 불러오지 못했습니다')
  return r.json()
}

export async function fetchStoreEta(storeId: number): Promise<StoreEta> {
  const r = await fetch(`${BASE}/stores/${storeId}/eta`)
  if (!r.ok) throw new Error('ETA 정보를 불러오지 못했습니다')
  return r.json()
}

export async function fetchEtaSummary(): Promise<StoreEta[]> {
  const r = await fetch(`${BASE}/stores/eta-summary`)
  if (!r.ok) throw new Error('ETA 요약을 불러오지 못했습니다')
  return r.json()
}

export async function fetchMenus(storeId: number): Promise<Menu[]> {
  const r = await fetch(`${BASE}/stores/${storeId}/menus`)
  if (!r.ok) throw new Error('메뉴를 불러오지 못했습니다')
  return r.json()
}

export async function fetchPickupSlots(storeId: number, date: string): Promise<PickupSlot[]> {
  const r = await fetch(`${BASE}/stores/${storeId}/pickup-slots?date=${date}`)
  if (!r.ok) throw new Error('픽업 슬롯을 불러오지 못했습니다')
  return r.json()
}

export async function createOrder(body: {
  storeId: number
  customerName: string
  customerPhone?: string
  pickupType: 'NOW' | 'SCHEDULED'
  pickupSlotId?: number
  memo?: string
  items: Array<{ menuId: number; quantity: number; choiceIds?: number[] }>
}): Promise<OrderResponse> {
  const r = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error('주문 생성에 실패했습니다')
  return r.json()
}

export async function fetchOrder(id: number): Promise<OrderResponse> {
  const r = await fetch(`${BASE}/orders/${id}`)
  if (!r.ok) throw new Error('주문 정보를 불러오지 못했습니다')
  return r.json()
}
