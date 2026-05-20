export interface Store {
  id: number
  name: string
  address: string
  phone: string | null
  isOpen: boolean
  openAt: string
  closeAt: string
}

export interface Category {
  id: number
  name: string
  sortOrder: number
}

export interface MenuOptionChoice {
  id: number
  optionId: number
  name: string
  extraPrice: number
}

export interface MenuOption {
  id: number
  menuId: number
  name: string
  isRequired: boolean
  maxSelect: number
  choices: MenuOptionChoice[]
}

export interface Menu {
  id: number
  storeId: number
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  isAvailable: boolean
  sortOrder: number
  category: Category | null
  options: MenuOption[]
}

export interface PickupSlot {
  id: number
  storeId: number
  date: string
  startTime: string
  endTime: string
  capacity: number
  remaining: number
  isBlocked: boolean
}

export interface StoreEta {
  storeId: number
  queueCount: number
  estimatedWaitMin: number
  etaMinLow: number
  etaMinHigh: number
  earliestPickupAt: string
  congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface CartItem {
  menuId: number
  menuName: string
  unitPrice: number
  quantity: number
  choiceIds: number[]
  choiceSummary: string
}

export interface OrderItem {
  id: number
  menuId: number
  quantity: number
  price: number
  menu: { id: number; name: string }
}

export interface OrderResponse {
  id: number
  orderNumber: string
  status: string
  totalPrice: number
  pickupType: string
  customerName: string
  storeId: number
  items: OrderItem[]
  pickupSlot: {
    startTime: string
    endTime: string
  } | null
  eta: {
    estimatedSec: number
    readyAt: string
  } | null
}
