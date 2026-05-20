import { useCallback, useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { fetchStoresAdmin, fetchOrders, updateOrderStatus } from '../api/admin'
import type { AdminOrder } from '../api/admin'
import type { Store } from '../types'

// ── 타입 ────────────────────────────────────────────────────────────────────

type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED'

type TabKey = 'ALL' | 'UPCOMING' | OrderStatus

interface SocketOrderPayload {
  orderId: number
  status: string
  estimatedReadyAt: string | null
  queuePosition: number
}

// ── 상수 ────────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'ALL',      label: '전체'    },
  { key: 'UPCOMING', label: '제조 예정' },
  { key: 'PENDING',  label: '접수 대기' },
  { key: 'ACCEPTED',  label: '수락됨'   },
  { key: 'PREPARING', label: '제조중'   },
  { key: 'READY',     label: '준비 완료' },
  { key: 'COMPLETED', label: '완료'     },
  { key: 'CANCELLED', label: '취소'     },
]

const STATUS_BADGE: Record<OrderStatus, { label: string; cls: string }> = {
  PENDING:   { label: '접수 대기', cls: 'bg-gray-100 text-gray-600 ring-gray-200'      },
  ACCEPTED:  { label: '수락됨',   cls: 'bg-blue-100 text-blue-800 ring-blue-200'      },
  PREPARING: { label: '제조중',   cls: 'bg-orange-100 text-orange-800 ring-orange-200'},
  READY:     { label: '준비 완료', cls: 'bg-emerald-100 text-emerald-800 ring-emerald-200'},
  COMPLETED: { label: '완료',     cls: 'bg-gray-100 text-gray-600 ring-gray-200'       },
  CANCELLED: { label: '취소',     cls: 'bg-red-100 text-red-700 ring-red-200'          },
}

type BtnVariant = 'primary' | 'success' | 'danger'

const ACTIONS: Partial<
  Record<OrderStatus, { label: string; next: OrderStatus; variant: BtnVariant }[]>
> = {
  PENDING: [
    { label: '수락',      next: 'ACCEPTED',  variant: 'primary' },
    { label: '취소',      next: 'CANCELLED', variant: 'danger'  },
  ],
  ACCEPTED:  [{ label: '제조 시작', next: 'PREPARING', variant: 'primary' }],
  PREPARING: [{ label: '준비 완료', next: 'READY',     variant: 'success' }],
  READY:     [{ label: '픽업 완료', next: 'COMPLETED', variant: 'success' }],
}

const BTN_CLS: Record<BtnVariant, string> = {
  primary: 'bg-amber-500 hover:bg-amber-600 text-white',
  success: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  danger:  'bg-white border border-red-300 text-red-600 hover:bg-red-50',
}

// ── 유틸 ────────────────────────────────────────────────────────────────────

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function summarizeItems(items: AdminOrder['items']): string {
  return items.map((i) => `${i.menu.name} × ${i.quantity}`).join(', ')
}

// 제조 예정 탭 대상: 예약 주문 & 제조 시작 전
function isUpcoming(order: AdminOrder): boolean {
  const isScheduled =
    order.pickupType === 'SCHEDULED' || order.pickupSlot !== null
  const beforePrepare =
    order.status === 'PENDING' || order.status === 'ACCEPTED'
  return isScheduled && beforePrepare
}

// pickupSlot.startTime("HH:mm") 기준 남은 시간 → reminder badge
interface Reminder {
  label: string
  cls: string
  diffMin: number
}

function getReminder(startTime: string): Reminder {
  const [h, m] = startTime.split(':').map(Number)
  const target = new Date()
  target.setHours(h, m, 0, 0)
  const diffMin = Math.round((target.getTime() - Date.now()) / 60000)

  if (diffMin < 0)
    return { label: '지연 위험',     cls: 'bg-red-200 text-red-800',       diffMin }
  if (diffMin < 15)
    return { label: '제조 시작 권장', cls: 'bg-red-100 text-red-700',       diffMin }
  if (diffMin < 30)
    return { label: '곧 제조 필요',  cls: 'bg-orange-100 text-orange-700', diffMin }
  if (diffMin < 120)
    return { label: '준비 예정',     cls: 'bg-amber-100 text-amber-700',   diffMin }
  return   { label: '예약 예정',     cls: 'bg-gray-100 text-gray-500',     diffMin }
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex flex-col gap-1.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-3xl font-black tabular-nums ${accent ?? 'text-gray-900'}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function AdminOrderBoard() {
  const [stores, setStores] = useState<Store[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null)
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [activeTab, setActiveTab] = useState<TabKey>('ALL')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  const socketRef = useRef<Socket | null>(null)

  // ── 매장 목록 로드 ───────────────────────────────────────────────────────

  useEffect(() => {
    fetchStoresAdmin()
      .then((list) => {
        setStores(list)
        if (list.length > 0) setSelectedStoreId(list[0].id)
      })
      .catch(console.error)
  }, [])

  // ── 주문 로드 ────────────────────────────────────────────────────────────

  // 초기 로드·매장 전환 시 사용 — 로딩 스피너 표시
  const loadOrders = useCallback(async (storeId: number) => {
    setLoading(true)
    try {
      const data = await fetchOrders(storeId)
      setOrders(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 소켓 이벤트 시 사용 — 스피너 없이 조용히 갱신
  const refreshOrders = useCallback(async (storeId: number) => {
    try {
      const data = await fetchOrders(storeId)
      setOrders(data)
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    if (selectedStoreId === null) return
    setOrders([])
    loadOrders(selectedStoreId)
  }, [selectedStoreId, loadOrders])

  // ── Socket.IO ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (selectedStoreId === null) return

    const socket = io('http://localhost:3000', {
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join:store', selectedStoreId)
    })
    socket.on('disconnect', () => setConnected(false))

    // 새 주문: 스피너 없이 전체 재조회 (items 등 풀 데이터 필요)
    socket.on('order:created', () => {
      refreshOrders(selectedStoreId)
    })

    // 상태 변경: 해당 주문만 갱신
    socket.on('order:updated', (data: SocketOrderPayload) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === data.orderId ? { ...o, status: data.status } : o
        )
      )
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [selectedStoreId, loadOrders, refreshOrders])

  // ── 상태 변경 ────────────────────────────────────────────────────────────

  const handleStatusChange = async (orderId: number, next: OrderStatus) => {
    setUpdatingId(orderId)
    try {
      await updateOrderStatus(orderId, next)
      // 낙관적 업데이트 (소켓 order:updated 도 동일하게 반영됨)
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: next } : o))
      )
    } catch {
      alert('상태 변경에 실패했습니다.')
    } finally {
      setUpdatingId(null)
    }
  }

  // ── KPI 계산 ─────────────────────────────────────────────────────────────

  const todayOrders    = orders.filter((o) => isToday(o.createdAt))

  const activeCount    = todayOrders.filter((o) =>
    ['PENDING', 'ACCEPTED', 'PREPARING'].includes(o.status)
  ).length
  const completedCount = todayOrders.filter((o) => o.status === 'COMPLETED').length
  const todayCount     = todayOrders.length

  const etaMins = todayOrders
    .filter((o) => o.eta != null)
    .map((o) => o.eta!.estimatedSec / 60)
  const avgEta =
    etaMins.length > 0
      ? `${Math.round(etaMins.reduce((a, b) => a + b, 0) / etaMins.length)}분`
      : '-'

  // ── 탭 필터 ─────────────────────────────────────────────────────────────

  const filtered =
    activeTab === 'ALL'      ? orders :
    activeTab === 'UPCOMING' ? orders.filter(isUpcoming) :
                               orders.filter((o) => o.status === activeTab)

  const countOf = (key: TabKey) =>
    key === 'ALL'      ? orders.length :
    key === 'UPCOMING' ? orders.filter(isUpcoming).length :
                         orders.filter((o) => o.status === key).length

  const selectedStore = stores.find((s) => s.id === selectedStoreId)

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── 헤더 ─────────────────────────────────────────────────────────── */}
      <header className="bg-gray-900 text-white px-6 py-3.5 flex items-center justify-between shadow-xl sticky top-0 z-20">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-3">
            <span className="font-black text-xl text-amber-400 tracking-tight">
              ADMIN
            </span>
            <span className="text-gray-700 text-sm hidden sm:inline">|</span>
            <span className="text-gray-400 text-sm hidden sm:inline">실시간 주문 모니터링</span>
          </div>

          {/* 매장 선택 */}
          <select
            value={selectedStoreId ?? ''}
            onChange={(e) => {
              setSelectedStoreId(Number(e.target.value))
              setActiveTab('ALL')
            }}
            className="bg-gray-800 text-white text-sm px-3 py-1.5 rounded-lg border border-gray-700
                       focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
          >
            {stores.length === 0 && (
              <option value="">매장 불러오는 중...</option>
            )}
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4">
          {/* 영업 상태 배지 */}
          {selectedStore && (
            <span
              className={`hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold ${
                selectedStore.isOpen
                  ? 'bg-emerald-900/60 text-emerald-300'
                  : 'bg-gray-800 text-gray-500'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  selectedStore.isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
                }`}
              />
              {selectedStore.isOpen ? '영업중' : '영업종료'}
            </span>
          )}

          {/* 소켓 연결 상태 */}
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'
              }`}
            />
            <span
              className={`hidden sm:inline font-semibold ${
                connected ? 'text-emerald-400' : 'text-gray-500'
              }`}
            >
              {connected ? 'LIVE' : '연결 중'}
            </span>
            {connected && (
              <span className="hidden sm:inline text-gray-500">/ 연결됨</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* ── KPI 카드 ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="진행 중 주문"
            value={activeCount}
            sub="접수 대기 · 수락 · 제조중"
            accent="text-amber-600"
          />
          <KpiCard
            label="완료 주문"
            value={completedCount}
            sub="픽업 완료"
            accent="text-emerald-600"
          />
          <KpiCard
            label="평균 ETA"
            value={avgEta}
            sub="실시간 주문량 기반 예상 대기시간"
          />
          <KpiCard
            label="오늘 주문 수"
            value={todayCount}
            sub={new Date().toLocaleDateString('ko-KR', {
              month: 'long',
              day: 'numeric',
            })}
          />
        </div>

        {/* ── 주문 테이블 ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

          {/* 탭 */}
          <div className="border-b border-gray-200 px-2 flex overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium
                            whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-200'
                }`}
              >
                {tab.label}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    activeTab === tab.key
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {countOf(tab.key)}
                </span>
              </button>
            ))}
          </div>

          {/* 테이블 본문 */}
          {loading ? (
            <div className="flex items-center justify-center py-28 gap-3 text-gray-400">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">주문 불러오는 중...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-28 text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p className="font-semibold text-gray-500">주문이 없습니다</p>
              <p className="text-sm mt-1">해당 상태의 주문이 없어요</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] text-gray-500 uppercase tracking-wider">
                    <th className="px-5 py-3 text-left font-semibold">주문번호</th>
                    <th className="px-5 py-3 text-left font-semibold">접수 시각</th>
                    <th className="px-5 py-3 text-left font-semibold">고객명</th>
                    <th className="px-5 py-3 text-left font-semibold">메뉴</th>
                    <th className="px-5 py-3 text-right font-semibold">금액</th>
                    <th className="px-5 py-3 text-center font-semibold">픽업</th>
                    <th className="px-5 py-3 text-center font-semibold">ETA</th>
                    <th className="px-5 py-3 text-center font-semibold">상태</th>
                    <th className="px-5 py-3 text-center font-semibold">액션</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((order) => {
                    const badge   = STATUS_BADGE[order.status as OrderStatus]
                    const actions = ACTIONS[order.status as OrderStatus] ?? []
                    const busy    = updatingId === order.id

                    return (
                      <tr
                        key={order.id}
                        className="hover:bg-amber-50/40 transition-colors"
                      >
                        {/* 주문번호 */}
                        <td className="px-5 py-3.5 font-mono font-bold text-gray-900 text-[13px] whitespace-nowrap">
                          {order.orderNumber}
                        </td>

                        {/* 접수 시각 */}
                        <td className="px-5 py-3.5 text-gray-500 tabular-nums text-[12px] whitespace-nowrap">
                          {fmtTime(order.createdAt)}
                        </td>

                        {/* 고객명 */}
                        <td className="px-5 py-3.5 text-gray-800 font-medium whitespace-nowrap">
                          <div>{order.customerName}</div>
                          {order.customerPhone && (
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              {order.customerPhone}
                            </div>
                          )}
                        </td>

                        {/* 메뉴 */}
                        <td className="px-5 py-3.5 text-gray-600 max-w-[200px]">
                          <div className="truncate">{summarizeItems(order.items)}</div>
                          {order.memo && (
                            <div className="text-[11px] text-amber-600 mt-0.5 truncate">
                              📌 {order.memo}
                            </div>
                          )}
                        </td>

                        {/* 금액 */}
                        <td className="px-5 py-3.5 text-right font-bold text-gray-900 tabular-nums whitespace-nowrap">
                          {order.totalPrice.toLocaleString()}원
                        </td>

                        {/* 픽업 타입 */}
                        <td className="px-5 py-3.5 text-center">
                          {order.pickupType === 'SCHEDULED' ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-700">
                                예약
                              </span>
                              <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap">
                                {order.pickupSlot
                                  ? `${order.pickupSlot.startTime}–${order.pickupSlot.endTime}`
                                  : '예약 주문'}
                              </span>
                              {/* 제조 예정 reminder — 제조 시작 전 예약 주문에만 표시 */}
                              {isUpcoming(order) && order.pickupSlot && (() => {
                                const r = getReminder(order.pickupSlot.startTime)
                                const absMin = Math.abs(r.diffMin)
                                const timeLabel =
                                  r.diffMin < 0
                                    ? `${absMin}분 초과`
                                    : r.diffMin < 60
                                    ? `${r.diffMin}분 후`
                                    : `${Math.floor(r.diffMin / 60)}시간 ${r.diffMin % 60}분 후`
                                return (
                                  <div className="flex flex-col items-center gap-0.5 mt-0.5">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${r.cls}`}>
                                      {r.label}
                                    </span>
                                    <span className="text-[10px] text-gray-400 tabular-nums">
                                      {timeLabel}
                                    </span>
                                  </div>
                                )
                              })()}
                            </div>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-100 text-gray-500">
                              즉시
                            </span>
                          )}
                        </td>

                        {/* ETA */}
                        <td className="px-5 py-3.5 text-center text-gray-500 tabular-nums text-[12px] whitespace-nowrap">
                          {order.eta
                            ? `${Math.round(order.eta.estimatedSec / 60)}분`
                            : '-'}
                        </td>

                        {/* 상태 배지 */}
                        <td className="px-5 py-3.5 text-center whitespace-nowrap">
                          {badge && (
                            <span
                              className={`inline-flex items-center text-[11px] font-bold
                                          px-2.5 py-1 rounded-full ring-1 ${badge.cls}`}
                            >
                              {badge.label}
                            </span>
                          )}
                        </td>

                        {/* 액션 버튼 */}
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {busy ? (
                              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            ) : actions.length === 0 ? (
                              <span className="text-gray-300 text-xs select-none">—</span>
                            ) : (
                              actions.map((action) => (
                                <button
                                  key={action.next}
                                  onClick={() =>
                                    handleStatusChange(order.id, action.next)
                                  }
                                  className={`px-3 py-1.5 text-[11px] font-bold rounded-lg
                                              transition-colors whitespace-nowrap ${BTN_CLS[action.variant]}`}
                                >
                                  {action.label}
                                </button>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 하단 여백 */}
        <div className="h-6" />
      </main>
    </div>
  )
}
