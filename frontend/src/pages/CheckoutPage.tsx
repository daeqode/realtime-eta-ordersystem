import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchPickupSlots, createOrder } from '../api'
import type { PickupSlot } from '../types'
import useCart, { useCartTotal } from '../store/useCart'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CheckoutPage() {
  const { storeId } = useParams<{ storeId: string }>()
  const navigate = useNavigate()
  const sid = Number(storeId)

  const cartItems = useCart((s) => s.items)
  const clearCart = useCart((s) => s.clear)
  const total = useCartTotal()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pickupType, setPickupType] = useState<'NOW' | 'SCHEDULED'>('NOW')
  const [slots, setSlots] = useState<PickupSlot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<PickupSlot | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 주문 제출 완료 여부 — clearCart() 후 cart-empty effect가 메뉴로 돌아가는 것을 차단
  const submittedRef = useRef(false)

  // 카트 비었으면 메뉴 페이지로 (주문 제출 완료 상태 제외)
  useEffect(() => {
    if (cartItems.length === 0 && !submittedRef.current) {
      navigate(`/stores/${sid}`)
    }
  }, [cartItems.length, navigate, sid])

  // 예약 픽업 선택 시 슬롯 조회
  useEffect(() => {
    if (pickupType !== 'SCHEDULED') return
    setLoadingSlots(true)
    setSelectedSlot(null)
    fetchPickupSlots(sid, todayStr())
      .then(setSlots)
      .catch(() => setError('슬롯을 불러오지 못했습니다'))
      .finally(() => setLoadingSlots(false))
  }, [pickupType, sid])

  const availableSlots = slots.filter((s) => !s.isBlocked && s.remaining > 0)

  const handleSubmit = async () => {
    if (!name.trim()) { setError('이름을 입력해주세요'); return }
    if (pickupType === 'SCHEDULED' && !selectedSlot) {
      setError('픽업 슬롯을 선택해주세요')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const order = await createOrder({
        storeId: sid,
        customerName: name.trim(),
        customerPhone: phone.trim() || undefined,
        pickupType,
        pickupSlotId: selectedSlot?.id,
        items: cartItems.map((item) => ({
          menuId: item.menuId,
          quantity: item.quantity,
          choiceIds: item.choiceIds.length > 0 ? item.choiceIds : undefined,
        })),
      })

      if (!order?.id) {
        throw new Error('주문 응답에 ID가 없습니다')
      }

      // effect 충돌 방지 후 추적 페이지로 이동, 이후 카트 정리
      submittedRef.current = true
      navigate(`/orders/${order.id}/tracking`)
      clearCart()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '주문에 실패했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3.5 flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="font-bold text-gray-900 text-base">주문 정보 입력</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5 space-y-3 pb-10">
        {/* 고객 정보 */}
        <section className="card p-5">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-600 text-white text-xs font-bold flex items-center justify-center">1</span>
            고객 정보
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                이름 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-gray-50 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                연락처 <span className="text-gray-400 normal-case font-normal">(선택)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-gray-50 focus:bg-white"
              />
            </div>
          </div>
        </section>

        {/* 픽업 방식 */}
        <section className="card p-5">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-600 text-white text-xs font-bold flex items-center justify-center">2</span>
            픽업 방식
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {(['NOW', 'SCHEDULED'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setPickupType(type)}
                className={`py-4 px-3 rounded-2xl text-sm border-2 transition-all text-center ${
                  pickupType === type
                    ? 'border-amber-600 bg-amber-50 text-amber-700 shadow-sm'
                    : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-200'
                }`}
              >
                <div className="text-2xl mb-1.5">{type === 'NOW' ? '⚡' : '📅'}</div>
                <div className="font-semibold text-sm">
                  {type === 'NOW' ? '즉시 픽업' : '예약 픽업'}
                </div>
                <div className="text-xs font-normal mt-0.5 leading-tight opacity-70">
                  {type === 'NOW' ? '주문 즉시 준비 시작' : '원하는 시간에 맞춰 준비'}
                </div>
              </button>
            ))}
          </div>
          {pickupType === 'NOW' && (
            <p className="text-xs text-gray-400 mt-3 text-center">
              주문 후 예상 대기시간을 바로 확인하실 수 있습니다
            </p>
          )}
        </section>

        {/* 슬롯 선택 (예약 픽업) */}
        {pickupType === 'SCHEDULED' && (
          <section className="card p-5">
            <h2 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-600 text-white text-xs font-bold flex items-center justify-center">3</span>
              픽업 시간 선택
            </h2>
            <p className="text-xs text-gray-400 mb-4 ml-8">오늘 ({todayStr()}) 기준</p>

            {loadingSlots ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : availableSlots.length === 0 ? (
              <p className="text-center py-6 text-gray-400 text-sm">오늘 예약 가능한 슬롯이 없습니다</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {availableSlots.map((slot) => {
                  const isAlmostFull = slot.remaining <= 2
                  return (
                  <button
                    key={slot.id}
                    onClick={() => setSelectedSlot(slot)}
                    className={`py-3 rounded-xl border text-xs font-medium transition-all ${
                      selectedSlot?.id === slot.id
                        ? 'border-amber-600 bg-amber-50 text-amber-700 shadow-sm'
                        : isAlmostFull
                        ? 'border-amber-200 bg-amber-50 text-gray-700 hover:border-amber-400'
                        : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-amber-300'
                    }`}
                  >
                    <div className="font-semibold">{slot.startTime}</div>
                    <div className={`font-normal mt-0.5 ${isAlmostFull ? 'text-amber-500' : 'text-gray-400'}`}>
                      {isAlmostFull ? '마감 임박' : '예약 가능'}
                    </div>
                  </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* 주문 내역 */}
        <section className="card p-5">
          <h2 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-amber-600 text-white text-xs font-bold flex items-center justify-center">
              {pickupType === 'SCHEDULED' ? '4' : '3'}
            </span>
            주문 내역
          </h2>
          <div className="space-y-2.5">
            {cartItems.map((item, i) => (
              <div key={i} className="flex justify-between items-start">
                <div className="flex-1 min-w-0 mr-3">
                  <span className="text-sm font-medium text-gray-800">{item.menuName}</span>
                  {item.choiceSummary && (
                    <span className="text-xs text-gray-400 ml-1">({item.choiceSummary})</span>
                  )}
                  <span className="text-xs text-gray-400 ml-1">× {item.quantity}</span>
                </div>
                <span className="text-sm text-gray-700 font-semibold shrink-0">
                  {(item.unitPrice * item.quantity).toLocaleString()}원
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 mt-4 pt-4 flex justify-between items-center">
            <span className="font-bold text-gray-900">최종 결제금액</span>
            <span className="font-bold text-amber-600 text-xl">{total.toLocaleString()}원</span>
          </div>
        </section>

        {/* 에러 */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* 주문 버튼 */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-primary text-base"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              주문 처리 중...
            </span>
          ) : (
            `${total.toLocaleString()}원 주문하기`
          )}
        </button>
      </main>
    </div>
  )
}
