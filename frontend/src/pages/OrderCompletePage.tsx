import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchOrder } from '../api'
import type { OrderResponse } from '../types'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function formatEta(sec: number): string {
  if (sec < 60) return `약 ${sec}초`
  const min = Math.round(sec / 60)
  return `약 ${min}분`
}

export default function OrderCompletePage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<OrderResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOrder(Number(orderId))
      .then(setOrder)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [orderId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-gray-500 mb-4">주문 정보를 찾을 수 없습니다</p>
          <button
            onClick={() => navigate('/')}
            className="text-amber-600 underline text-sm"
          >
            처음으로
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-sm text-center">
        {/* 완료 아이콘 */}
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <span className="text-4xl">✓</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">주문 완료!</h1>
        <p className="text-gray-500 text-sm mb-7">주문이 성공적으로 접수되었습니다</p>

        {/* 주문 상세 */}
        <div className="bg-amber-50 rounded-2xl p-5 text-left space-y-3 mb-6">
          <Row label="주문 번호">
            <span className="font-bold text-gray-900 text-base">{order.orderNumber}</span>
          </Row>
          <Row label="픽업 방식">
            <span className="font-medium text-gray-700">
              {order.pickupType === 'NOW' ? '⚡ 지금 픽업' : '📅 예약 픽업'}
            </span>
          </Row>
          <Row label="총 금액">
            <span className="font-bold text-amber-600 text-base">
              {order.totalPrice.toLocaleString()}원
            </span>
          </Row>

          {/* ASAP 주문: ETA */}
          {order.pickupType === 'NOW' && order.eta && (
            <div className="border-t border-amber-100 pt-3 space-y-2">
              <Row label="예상 대기">
                <span className="font-semibold text-gray-800">
                  {formatEta(order.eta.estimatedSec)}
                </span>
              </Row>
              <Row label="준비 완료 예정">
                <span className="font-semibold text-gray-800">
                  {formatTime(order.eta.readyAt)}
                </span>
              </Row>
            </div>
          )}

          {/* 예약 픽업: 슬롯 시간 */}
          {order.pickupType === 'SCHEDULED' && order.pickupSlot && (
            <div className="border-t border-amber-100 pt-3">
              <Row label="픽업 시간">
                <span className="font-semibold text-gray-800">
                  {order.pickupSlot.startTime} – {order.pickupSlot.endTime}
                </span>
              </Row>
            </div>
          )}
        </div>

        <button
          onClick={() => navigate('/')}
          className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-2xl py-3.5 font-semibold transition-colors"
        >
          처음으로 돌아가기
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-gray-500">{label}</span>
      {children}
    </div>
  )
}
