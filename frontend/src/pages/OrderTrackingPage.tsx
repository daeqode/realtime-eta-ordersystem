import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { io, Socket } from 'socket.io-client'
import { fetchOrder } from '../api'
import type { OrderResponse, OrderItem } from '../types'

// ── 소켓 이벤트 타입 ──────────────────────────────────────────────────────────

interface OrderUpdatedEvent {
  orderId: number
  status: string
  estimatedReadyAt: string | null
  queuePosition: number
}

interface EtaUpdatedEvent {
  storeId: number
  queueCount: number
  estimatedWaitMin: number
  etaMinLow: number
  etaMinHigh: number
  congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH'
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'PENDING',   label: '접수됨',      icon: '📋' },
  { key: 'PREPARING', label: '제조중',      icon: '☕' },
  { key: 'READY',     label: '준비 완료',   icon: '✅' },
  { key: 'COMPLETED', label: '픽업 완료',   icon: '🎉' },
]

// ACCEPTED는 PENDING과 동일 단계로 취급
const STATUS_TO_STEP: Record<string, number> = {
  PENDING: 0, ACCEPTED: 0, PREPARING: 1, READY: 2, COMPLETED: 3,
}

const CONGESTION_MAP = {
  LOW:    { label: '여유', cls: 'bg-white/20 text-white' },
  MEDIUM: { label: '보통', cls: 'bg-yellow-400/30 text-yellow-100' },
  HIGH:   { label: '혼잡', cls: 'bg-red-400/30 text-red-100' },
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

/** 카운트다운 링 (SVG circle) */
function CountdownRing({ sec, totalSec }: { sec: number; totalSec: number }) {
  const R = 40
  const C = 2 * Math.PI * R
  const ratio = totalSec > 0 ? Math.max(0, sec / totalSec) : 0
  const offset = C * (1 - ratio)
  const mins = Math.floor(sec / 60)
  const secs = sec % 60

  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={R}
          fill="none" stroke="white" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="text-2xl font-bold tabular-nums leading-none">
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
        <span className="text-xs text-white/60 mt-1">남은 시간</span>
      </div>
    </div>
  )
}

/** 수평 progress step */
function ProgressStepper({ currentStep, isDone }: { currentStep: number; isDone: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex items-start">
        {STEPS.map((step, i) => {
          const isPast   = i < currentStep
          const isActive = i === currentStep

          return (
            <div key={step.key} className="flex flex-col items-center flex-1 min-w-0">
              {/* 선 + 원 */}
              <div className="flex items-center w-full">
                {i > 0 && (
                  <div className={`h-0.5 flex-1 transition-colors duration-500 ${
                    isPast || isActive ? 'bg-amber-400' : 'bg-gray-200'
                  }`} />
                )}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm shrink-0 border-2 transition-all duration-500 ${
                  isDone && i === STEPS.length - 1
                    ? 'border-green-500 bg-green-500 text-white shadow-md'
                    : isActive
                    ? 'border-amber-500 bg-amber-500 text-white shadow-md scale-110 ring-4 ring-amber-100'
                    : isPast
                    ? 'border-amber-300 bg-amber-50 text-amber-500'
                    : 'border-gray-200 bg-white text-gray-300'
                }`}>
                  {isPast ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <span>{step.icon}</span>
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 transition-colors duration-500 ${
                    isPast ? 'bg-amber-400' : 'bg-gray-200'
                  }`} />
                )}
              </div>
              {/* 레이블 */}
              <p className={`text-xs mt-2 text-center leading-tight px-0.5 font-medium transition-colors ${
                isActive
                  ? 'text-amber-600'
                  : isPast
                  ? 'text-amber-400'
                  : 'text-gray-300'
              }`}>
                {step.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate    = useNavigate()
  const oid         = Number(orderId)

  const socketRef  = useRef<Socket | null>(null)
  const storeIdRef = useRef<number | null>(null)

  const [order,         setOrder]         = useState<OrderResponse | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [connected,     setConnected]     = useState(false)

  // 실시간으로 갱신되는 값
  const [status,        setStatus]        = useState('PENDING')
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  const [readyAt,       setReadyAt]       = useState<string | null>(null)
  const [totalSec,      setTotalSec]      = useState(0)     // 최초 추정 총 시간
  const [countdown,     setCountdown]     = useState<number | null>(null)
  const [storeEta,      setStoreEta]      = useState<EtaUpdatedEvent | null>(null)

  // ── 주문 데이터 fetch ─────────────────────────────────────────────────────

  useEffect(() => {
    fetchOrder(oid)
      .then((o) => {
        setOrder(o)
        setStatus(o.status)
        if (o.eta?.readyAt) {
          setReadyAt(o.eta.readyAt)
          setTotalSec(o.eta.estimatedSec)
        }
        storeIdRef.current = o.storeId
        socketRef.current?.emit('join:store', o.storeId)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [oid])

  // ── Socket.IO 연결 ────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = io('http://localhost:3000', { transports: ['websocket', 'polling'] })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join:order', oid)
      if (storeIdRef.current) socket.emit('join:store', storeIdRef.current)
    })

    socket.on('disconnect', () => setConnected(false))

    socket.on('order:updated', (data: OrderUpdatedEvent) => {
      if (data.orderId !== oid) return
      setStatus(data.status)
      setQueuePosition(data.queuePosition)
      if (data.estimatedReadyAt) setReadyAt(data.estimatedReadyAt)
    })

    socket.on('eta:updated', (data: EtaUpdatedEvent) => {
      setStoreEta(data)
    })

    return () => { socket.disconnect() }
  }, [oid])

  // ── 1초 카운트다운 ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!readyAt) return
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(readyAt).getTime() - Date.now()) / 1000))
      setCountdown(remaining)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [readyAt])

  // ── 파생 상태 ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">주문 정보를 불러오는 중...</span>
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50 px-4">
        <div className="text-center">
          <p className="text-5xl mb-4">🔍</p>
          <p className="text-gray-600 font-medium mb-2">주문을 찾을 수 없어요</p>
          <p className="text-gray-400 text-sm mb-6">주문 번호를 다시 확인해 주세요</p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2.5 bg-amber-600 text-white rounded-xl font-medium text-sm"
          >
            처음으로
          </button>
        </div>
      </div>
    )
  }

  const currentStep  = STATUS_TO_STEP[status] ?? 0
  const isCancelled  = status === 'CANCELLED'
  const isCompleted  = status === 'COMPLETED'
  const isReady      = status === 'READY'
  const showCountdown = order.pickupType === 'NOW' &&
    ['PENDING', 'ACCEPTED', 'PREPARING'].includes(status)

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="min-h-screen bg-stone-50">
      {/* ── 헤더 ── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3.5 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="text-center">
            <p className="text-xs text-gray-400 leading-tight">주문 번호</p>
            <p className="font-bold text-gray-900 text-lg leading-tight">{order.orderNumber}</p>
          </div>

          {/* 실시간 연결 상태 */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
            <span className="hidden sm:inline">{connected ? 'LIVE' : '연결 중'}</span>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-3 pb-10">

        {/* ── 취소 카드 ── */}
        {isCancelled && (
          <section className="card p-6 text-center border-red-100">
            <div className="text-5xl mb-3">❌</div>
            <p className="font-bold text-red-600 text-xl">주문이 취소되었습니다</p>
            <p className="text-gray-400 text-sm mt-1">문의 사항은 매장에 연락해 주세요</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 px-6 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium"
            >
              새로 주문하기
            </button>
          </section>
        )}

        {/* ── ETA 카운트다운 카드 (PENDING / ACCEPTED / PREPARING) ── */}
        {showCountdown && (
          <section className="rounded-2xl overflow-hidden shadow-sm">
            {/* 상태 배너 */}
            <div className={`px-5 py-3 flex items-center gap-2 text-white text-sm font-semibold ${
              status === 'PREPARING' ? 'bg-amber-700' : 'bg-amber-600'
            }`}>
              <span className="animate-pulse">●</span>
              {status === 'PREPARING' ? '음료를 제조하고 있어요' : '주문을 접수했어요'}
            </div>

            {/* 본문 */}
            <div className="bg-amber-600 px-5 pb-5 pt-2">
              <div className="flex items-center justify-between gap-4">
                {/* 카운트다운 링 */}
                {countdown !== null && countdown > 0 ? (
                  <CountdownRing sec={countdown} totalSec={totalSec} />
                ) : (
                  <div className="w-28 h-28 mx-auto flex flex-col items-center justify-center text-white">
                    <span className="text-3xl">⏳</span>
                    <span className="text-xs text-white/70 mt-1">잠시만요</span>
                  </div>
                )}

                {/* 우측: 시각 + 혼잡도 */}
                <div className="flex-1 text-white">
                  <p className="text-white/70 text-xs font-medium mb-1">준비 완료 예정</p>
                  <p className="text-3xl font-bold tabular-nums">
                    {readyAt ? formatTime(readyAt) : '--:--'}
                  </p>

                  {storeEta && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-white/60 text-xs">
                        매장 대기 {storeEta.queueCount}건
                      </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        CONGESTION_MAP[storeEta.congestionLevel].cls
                      }`}>
                        {CONGESTION_MAP[storeEta.congestionLevel].label}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── 픽업 준비 완료 카드 ── */}
        {isReady && (
          <section className="card overflow-hidden">
            <div className="bg-emerald-500 px-5 py-3 flex items-center gap-2 text-white text-sm font-semibold">
              <span>✅</span>
              픽업 준비가 완료되었어요!
            </div>
            <div className="px-5 py-5 text-center">
              <p className="text-5xl mb-3">🛎️</p>
              <p className="text-gray-500 text-sm mb-2">주문 번호로 수령해 주세요</p>
              <p className="text-4xl font-bold text-gray-900 tracking-wider">{order.orderNumber}</p>
              <p className="text-xs text-gray-400 mt-3">카운터에서 주문 번호를 말씀해 주세요</p>
            </div>
          </section>
        )}

        {/* ── 픽업 완료 카드 ── */}
        {isCompleted && (
          <section className="card p-6 text-center">
            <div className="text-5xl mb-3">🎉</div>
            <p className="font-bold text-gray-900 text-xl mb-1">픽업 완료!</p>
            <p className="text-gray-500 text-sm">이용해 주셔서 감사합니다 ☕</p>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <button
                onClick={() => navigate('/')}
                className="w-full bg-amber-600 text-white rounded-xl py-3 font-semibold text-sm"
              >
                새로 주문하기
              </button>
            </div>
          </section>
        )}

        {/* ── 예약 픽업 슬롯 ── */}
        {order.pickupType === 'SCHEDULED' && order.pickupSlot && (
          <section className="card px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-medium">픽업 예약 시간</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">
                {order.pickupSlot.startTime} – {order.pickupSlot.endTime}
              </p>
            </div>
            <span className="text-2xl">📅</span>
          </section>
        )}

        {/* ── Progress Stepper ── */}
        {!isCancelled && (
          <ProgressStepper currentStep={currentStep} isDone={isCompleted} />
        )}

        {/* ── 대기 순서 ── */}
        {!isCompleted && !isCancelled && !isReady &&
          queuePosition !== null && queuePosition > 0 && (
          <section className="card px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400 font-medium">내 앞 대기</p>
                <p className="text-2xl font-bold text-gray-900 mt-0.5">
                  {queuePosition - 1 > 0 ? `${queuePosition - 1}명` : '없음'}
                </p>
              </div>
              <div className="w-px h-10 bg-gray-100 mx-3" />
              <div className="text-right">
                <p className="text-xs text-gray-400 font-medium">내 순서</p>
                <p className="text-2xl font-bold text-amber-600 mt-0.5">#{queuePosition}</p>
              </div>
              {/* 순서 시각화 (최대 5칸) */}
              <div className="flex gap-1.5 ml-3">
                {Array.from({ length: Math.min(queuePosition, 5) }).map((_, i) => (
                  <div key={i} className={`w-2.5 h-8 rounded-full ${
                    i === queuePosition - 1 ? 'bg-amber-500' : 'bg-gray-200'
                  }`} />
                ))}
                {queuePosition > 5 && (
                  <div className="w-2.5 h-8 rounded-full bg-gray-100 flex items-end justify-center pb-1">
                    <span className="text-gray-400" style={{ fontSize: 7 }}>…</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── 주문 내역 ── */}
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <span>🧾</span> 주문 내역
          </h2>
          <div className="space-y-2">
            {order.items.map((item: OrderItem) => (
              <div key={item.id} className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-700 font-medium">{item.menu.name}</span>
                  <span className="text-gray-400">× {item.quantity}</span>
                </div>
                <span className="text-sm text-gray-600 font-medium">
                  {(item.price * item.quantity).toLocaleString()}원
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 mt-3 pt-3 flex justify-between items-center">
            <span className="font-bold text-gray-900 text-sm">합계</span>
            <span className="font-bold text-amber-600 text-base">
              {order.totalPrice.toLocaleString()}원
            </span>
          </div>
        </section>

      </main>
    </div>
  )
}
