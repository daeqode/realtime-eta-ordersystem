import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchStore, fetchMenus, fetchStoreEta } from '../api'
import type { Store, Menu, MenuOption, MenuOptionChoice, StoreEta } from '../types'

const CONGESTION = {
  LOW:    { label: '여유', cls: 'bg-emerald-100 text-emerald-700' },
  MEDIUM: { label: '보통', cls: 'bg-amber-100   text-amber-700'   },
  HIGH:   { label: '혼잡', cls: 'bg-red-100     text-red-700'     },
}
import useCart, { useCartTotal } from '../store/useCart'

// ── 옵션 선택 모달 ─────────────────────────────────────────────────────────────

interface OptionsModalProps {
  menu: Menu
  storeId: number
  onClose: () => void
}

function OptionsModal({ menu, storeId, onClose }: OptionsModalProps) {
  const addItem = useCart((s) => s.addItem)
  const [selections, setSelections] = useState<Record<number, number[]>>({})

  const isReady = menu.options
    .filter((o: MenuOption) => o.isRequired)
    .every((o: MenuOption) => (selections[o.id]?.length ?? 0) > 0)

  const toggle = (option: MenuOption, choiceId: number) => {
    setSelections((prev) => {
      const current = prev[option.id] ?? []
      if (current.includes(choiceId)) {
        return { ...prev, [option.id]: current.filter((id) => id !== choiceId) }
      }
      if (option.maxSelect === 1) return { ...prev, [option.id]: [choiceId] }
      if (current.length < option.maxSelect) {
        return { ...prev, [option.id]: [...current, choiceId] }
      }
      return prev
    })
  }

  const handleAdd = () => {
    const allChoiceIds = Object.values(selections).flat()
    const allChoices   = menu.options.flatMap((o: MenuOption) => o.choices)
    const extraPrice   = allChoiceIds.reduce((sum, id) => {
      const c = allChoices.find((c: MenuOptionChoice) => c.id === id)
      return sum + (c?.extraPrice ?? 0)
    }, 0)
    const choiceSummary = allChoiceIds
      .map((id) => allChoices.find((c: MenuOptionChoice) => c.id === id)?.name ?? '')
      .filter(Boolean)
      .join(', ')

    addItem(storeId, {
      menuId: menu.id,
      menuName: menu.name,
      unitPrice: menu.price + extraPrice,
      choiceIds: allChoiceIds,
      choiceSummary,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-0 md:px-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full md:max-w-sm md:rounded-2xl rounded-t-3xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 드래그 핸들 (모바일) */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5 md:hidden" />

        <h3 className="text-lg font-bold text-gray-900">{menu.name}</h3>
        <p className="text-amber-600 font-semibold text-sm mt-0.5 mb-5">
          {menu.price.toLocaleString()}원~
        </p>

        <div className="space-y-5 max-h-64 overflow-y-auto">
          {menu.options.map((option: MenuOption) => (
            <div key={option.id}>
              <p className="text-sm font-semibold text-gray-700 mb-2">
                {option.name}
                {option.isRequired && <span className="text-red-500 ml-1">*</span>}
                {option.maxSelect > 1 && (
                  <span className="text-xs text-gray-400 ml-1 font-normal">
                    (최대 {option.maxSelect}개)
                  </span>
                )}
              </p>
              <div className="space-y-2">
                {option.choices.map((choice: MenuOptionChoice) => {
                  const selected = (selections[option.id] ?? []).includes(choice.id)
                  return (
                    <button
                      key={choice.id}
                      onClick={() => toggle(option, choice.id)}
                      className={`w-full flex justify-between items-center px-4 py-3 rounded-xl border text-sm transition-colors ${
                        selected
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            selected ? 'border-amber-500 bg-amber-500' : 'border-gray-300'
                          }`}
                        >
                          {selected && <span className="w-1.5 h-1.5 bg-white rounded-full block" />}
                        </span>
                        {choice.name}
                      </div>
                      {choice.extraPrice > 0 && (
                        <span className="text-gray-400 text-xs">
                          +{choice.extraPrice.toLocaleString()}원
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 border border-gray-200 rounded-2xl text-gray-600 text-sm font-medium"
          >
            취소
          </button>
          <button
            onClick={handleAdd}
            disabled={!isReady}
            className="flex-1 py-3.5 bg-amber-600 text-white rounded-2xl text-sm font-bold disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
          >
            담기
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────

export default function StoreMenuPage() {
  const { storeId } = useParams<{ storeId: string }>()
  const navigate    = useNavigate()
  const sid         = Number(storeId)

  const [store, setStore]                       = useState<Store | null>(null)
  const [menus, setMenus]                       = useState<Menu[]>([])
  const [eta, setEta]                           = useState<StoreEta | null>(null)
  const [loading, setLoading]                   = useState(true)
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [activeMenu, setActiveMenu]             = useState<Menu | null>(null)

  const cartItems     = useCart((s) => s.items)
  const cartStoreId   = useCart((s) => s.storeId)
  const removeItem    = useCart((s) => s.removeItem)
  const updateQuantity = useCart((s) => s.updateQuantity)
  const addItem       = useCart((s) => s.addItem)
  const total         = useCartTotal()
  const cartCount     = cartItems.reduce((s, i) => s + i.quantity, 0)

  useEffect(() => {
    Promise.all([fetchStore(sid), fetchMenus(sid), fetchStoreEta(sid).catch(() => null)])
      .then(([s, m, e]) => { setStore(s); setMenus(m); setEta(e) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sid])

  const categories = Array.from(
    new Map(
      menus.filter((m) => m.category).map((m) => [m.category!.id, m.category!]),
    ).values(),
  ).sort((a, b) => a.sortOrder - b.sortOrder)

  const filteredMenus = selectedCategoryId
    ? menus.filter((m) => m.category?.id === selectedCategoryId)
    : menus

  const handleMenuClick = (menu: Menu) => {
    if (!menu.isAvailable) return
    if (cartStoreId !== null && cartStoreId !== sid && cartItems.length > 0) {
      if (!confirm('다른 매장의 메뉴가 담겨있습니다. 장바구니를 초기화하고 계속하시겠습니까?')) return
    }
    if (menu.options.length === 0) {
      addItem(sid, { menuId: menu.id, menuName: menu.name, unitPrice: menu.price, choiceIds: [], choiceSummary: '' })
    } else {
      setActiveMenu(menu)
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-gray-900 leading-tight truncate">
              {store ? store.name : '메뉴 선택'}
            </h1>
            {store && (
              <p className="text-xs text-gray-400 mt-0.5">
                {store.openAt} – {store.closeAt}
              </p>
            )}
          </div>
          {/* 모바일 카트 버튼 */}
          {cartItems.length > 0 && (
            <button
              onClick={() => navigate(`/stores/${sid}/checkout`)}
              className="md:hidden relative p-2 rounded-xl bg-amber-600 text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center leading-none">
                {cartCount}
              </span>
            </button>
          )}
        </div>

        {/* 대기 정보 배너 */}
        {eta && (
          <div className={`px-4 py-2 flex items-center gap-2 text-xs border-t ${
            eta.congestionLevel === 'HIGH'
              ? 'bg-red-50 border-red-100 text-red-700'
              : eta.congestionLevel === 'MEDIUM'
              ? 'bg-amber-50 border-amber-100 text-amber-700'
              : 'bg-emerald-50 border-emerald-100 text-emerald-700'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse shrink-0" />
            <span className="font-medium">
              {eta.queueCount === 0
                ? '현재 대기 없음 · 바로 픽업 가능'
                : `현재 대기 ${eta.queueCount}건 · 예상 ${eta.etaMinLow}~${eta.etaMinHigh}분`}
            </span>
            <span className={`ml-auto badge shrink-0 text-xs ${CONGESTION[eta.congestionLevel].cls}`}>
              {CONGESTION[eta.congestionLevel].label}
            </span>
          </div>
        )}

        {/* 카테고리 탭 */}
        <div className="overflow-x-auto scrollbar-none">
          <div className="flex gap-2 px-4 pb-3 w-max min-w-full">
            <button
              onClick={() => setSelectedCategoryId(null)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                selectedCategoryId === null
                  ? 'bg-amber-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              전체
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  selectedCategoryId === cat.id
                    ? 'bg-amber-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 컨텐츠 영역 */}
      <div className="max-w-5xl mx-auto px-4 py-4 md:flex md:gap-6 md:items-start pb-28 md:pb-8">
        {/* 메뉴 목록 */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {filteredMenus.map((menu) => (
                <div
                  key={menu.id}
                  onClick={() => handleMenuClick(menu)}
                  className={`card p-4 flex justify-between items-start gap-4 transition-all ${
                    menu.isAvailable
                      ? 'cursor-pointer hover:shadow-md active:scale-[0.99]'
                      : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900">{menu.name}</h3>
                      {!menu.isAvailable && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">품절</span>
                      )}
                      {menu.options.length > 0 && (
                        <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                          옵션
                        </span>
                      )}
                    </div>
                    {menu.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                        {menu.description}
                      </p>
                    )}
                    <p className="text-base font-bold text-gray-900 mt-2">
                      {menu.price.toLocaleString()}
                      <span className="text-sm font-normal text-gray-500">원</span>
                      {menu.options.length > 0 && (
                        <span className="text-sm font-normal text-gray-400">~</span>
                      )}
                    </p>
                  </div>
                  {menu.isAvailable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleMenuClick(menu) }}
                      className="shrink-0 w-9 h-9 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-xl flex items-center justify-center text-xl font-light transition-colors"
                    >
                      +
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 데스크톱 장바구니 사이드바 */}
        <div className="hidden md:block w-72 shrink-0 sticky top-32">
          <div className="card p-5">
            <h2 className="font-bold text-gray-900 text-base mb-4">장바구니</h2>
            {cartItems.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-3xl mb-2">🛒</p>
                <p className="text-sm text-gray-400">메뉴를 선택해주세요</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-4 max-h-72 overflow-y-auto">
                  {cartItems.map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 leading-snug">{item.menuName}</p>
                        {item.choiceSummary && (
                          <p className="text-xs text-gray-400 mt-0.5">{item.choiceSummary}</p>
                        )}
                        <p className="text-sm font-bold text-amber-600 mt-0.5">
                          {(item.unitPrice * item.quantity).toLocaleString()}원
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => updateQuantity(i, -1)}
                          className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm"
                        >−</button>
                        <span className="text-sm w-5 text-center font-medium">{item.quantity}</span>
                        <button
                          onClick={() => updateQuantity(i, 1)}
                          className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm"
                        >+</button>
                        <button
                          onClick={() => removeItem(i)}
                          className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-400 ml-0.5 text-lg leading-none"
                        >×</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-gray-100 pt-3 mb-4">
                  <div className="flex justify-between font-bold text-gray-900 text-sm">
                    <span>합계</span>
                    <span>{total.toLocaleString()}원</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/stores/${sid}/checkout`)}
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-xl py-3 font-bold text-sm transition-colors"
                >
                  주문하기 →
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 모바일 하단 장바구니 바 */}
      {cartItems.length > 0 && (
        <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 px-4 py-3 shadow-xl z-20">
          <button
            onClick={() => navigate(`/stores/${sid}/checkout`)}
            className="w-full bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-2xl py-4 font-bold flex items-center justify-between px-5 transition-colors"
          >
            <span className="bg-amber-700 text-white text-xs font-bold px-2.5 py-1 rounded-lg">
              {cartCount}개
            </span>
            <span>주문하기</span>
            <span>{total.toLocaleString()}원</span>
          </button>
        </div>
      )}

      {/* 옵션 모달 */}
      {activeMenu && (
        <OptionsModal menu={activeMenu} storeId={sid} onClose={() => setActiveMenu(null)} />
      )}
    </div>
  )
}
