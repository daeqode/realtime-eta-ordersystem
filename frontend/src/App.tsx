import { BrowserRouter, Routes, Route } from 'react-router-dom'
import StoreListPage from './pages/StoreListPage'
import StoreMenuPage from './pages/StoreMenuPage'
import CheckoutPage from './pages/CheckoutPage'
import OrderCompletePage from './pages/OrderCompletePage'
import OrderTrackingPage from './pages/OrderTrackingPage'
import AdminOrderBoard from './pages/AdminOrderBoard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StoreListPage />} />
        <Route path="/stores/:storeId" element={<StoreMenuPage />} />
        <Route path="/stores/:storeId/checkout" element={<CheckoutPage />} />
        <Route path="/order-complete/:orderId" element={<OrderCompletePage />} />
        <Route path="/orders/:orderId/tracking" element={<OrderTrackingPage />} />
        <Route path="/admin" element={<AdminOrderBoard />} />
      </Routes>
    </BrowserRouter>
  )
}
