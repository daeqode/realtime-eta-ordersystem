import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchStores, fetchEtaSummary } from '../api'
import type { Store, StoreEta } from '../types'

const CONGESTION = {
  LOW:    { label: '여유', cls: 'bg-emerald-100 text-emerald-700' },
  MEDIUM: { label: '보통', cls: 'bg-amber-100   text-amber-700'   },
  HIGH:   { label: '혼잡', cls: 'bg-red-100     text-red-700'     },
}

function Spinner() {
  return <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
}

export default function StoreListPage() {
  const [stores, setStores]   = useState<Store[]>([])
  const [etaMap, setEtaMap]   = useState<Map<number, StoreEta>>(new Map())
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    // 매장 목록과 ETA 요약을 병렬 조회
    Promise.all([fetchStores(), fetchEtaSummary()])
      .then(([storeList, etaSummary]) => {
        setStores(storeList)
        setEtaMap(new Map(etaSummary.map((e) => [e.storeId, e])))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // 영업중인 매장 중 가장 빠른 storeId 계산 (2곳 이상일 때만 추천 표시)
  const openEtas = stores
    .filter((s) => s.isOpen && etaMap.has(s.id))
    .map((s) => ({ id: s.id, waitMin: etaMap.get(s.id)!.estimatedWaitMin }))

  const fastestWaitMin = openEtas.length >= 2
    ? Math.min(...openEtas.map((e) => e.waitMin))
    : null

  const fastestIds = fastestWaitMin !== null
    ? new Set(openEtas.filter((e) => e.waitMin === fastestWaitMin).map((e) => e.id))
    : new Set<number>()

  return (
    <div className="min-h-screen bg-stone-50">
      {/* 헤더 */}
      <div className="bg-gradient-to-br from-amber-500 to-amber-700 text-white px-6 pt-14 pb-16 shadow-md">
        <div className="max-w-lg mx-auto">
          <p className="text-amber-200 text-xs font-semibold tracking-widest uppercase mb-3">
            ☕ Pickup Café
          </p>
          <h1 className="text-3xl font-bold leading-tight tracking-tight">
            지금 주문하고<br />기다리지 마세요
          </h1>
          <p className="text-amber-100 text-sm mt-2">픽업할 매장을 선택하세요</p>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 -mt-5 pb-10">
        {loading ? (
          <div className="flex flex-col items-center py-20 gap-3 text-gray-400">
            <Spinner />
            <span className="text-sm">매장 정보 불러오는 중</span>
          </div>
        ) : (
          <div className="space-y-3">
            {stores.map((store) => {
              const eta      = etaMap.get(store.id)
              const cong     = eta ? CONGESTION[eta.congestionLevel] : null
              const isFastest = fastestIds.has(store.id)

              return (
                <button
                  key={store.id}
                  onClick={() => navigate(`/stores/${store.id}`)}
                  className={`w-full text-left card p-0 overflow-hidden active:scale-[0.985] transition-all hover:shadow-md ${
                    isFastest ? 'ring-2 ring-amber-400' : ''
                  }`}
                >
                  {/* 추천 배지 */}
                  {isFastest && (
                    <div className="bg-amber-500 px-4 py-1.5 flex items-center gap-1.5">
                      <span className="text-white text-xs font-bold">⚡ 빠른 픽업 추천</span>
                      <span className="text-amber-200 text-xs">· 현재 가장 짧은 대기</span>
                    </div>
                  )}

                  {/* 상단: 매장명 + 영업 상태 */}
                  <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold text-gray-900 leading-tight">
                        {store.name}
                      </h2>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">{store.address}</p>
                      {store.phone && (
                        <p className="text-xs text-gray-400 mt-0.5">{store.phone}</p>
                      )}
                    </div>
                    <span className={`badge shrink-0 mt-0.5 ${
                      store.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        store.isOpen ? 'bg-emerald-500' : 'bg-gray-400'
                      }`} />
                      {store.isOpen ? '영업중' : '영업종료'}
                    </span>
                  </div>

                  {/* 하단: 영업시간 + ETA */}
                  <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400 shrink-0">
                      🕐 {store.openAt} – {store.closeAt}
                    </span>

                    {eta ? (
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          실시간
                        </span>
                        {cong && (
                          <span className={`badge ${cong.cls}`}>{cong.label}</span>
                        )}
                        {eta.queueCount === 0 ? (
                          <span className="text-xs font-semibold text-emerald-600 whitespace-nowrap">
                            대기 없음 · 바로 픽업
                          </span>
                        ) : (
                          <>
                            <span className="text-xs text-gray-400">대기 {eta.queueCount}건</span>
                            <span className="text-sm font-bold text-amber-600 whitespace-nowrap">
                              약 {eta.etaMinLow}~{eta.etaMinHigh}분
                            </span>
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">대기 정보 없음</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
