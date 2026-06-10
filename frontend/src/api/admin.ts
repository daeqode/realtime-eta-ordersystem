import type { Store, OrderResponse } from '../types'

const BASE = '/api'

export interface AdminOrder extends OrderResponse {
  createdAt: string
  customerPhone: string | null
  memo: string | null
}

export async function fetchStoresAdmin(): Promise<Store[]> {
  const r = await fetch(`${BASE}/stores`)
  if (!r.ok) throw new Error('매장 목록을 불러오지 못했습니다')
  return r.json()
}

export async function fetchOrders(storeId: number): Promise<AdminOrder[]> {
  const r = await fetch(`${BASE}/orders?storeId=${storeId}`)
  if (!r.ok) throw new Error('주문 목록을 불러오지 못했습니다')
  return r.json()
}

export async function updateOrderStatus(
  orderId: number,
  status: string
): Promise<OrderResponse> {
  const r = await fetch(`${BASE}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!r.ok) throw new Error('주문 상태 변경에 실패했습니다')
  return r.json()
}
