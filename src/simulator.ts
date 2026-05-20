import prisma from "./lib/prisma";
import { getIO } from "./lib/socket";
import { calcStoreEta } from "./lib/eta";
import type { OrderStatus } from "@prisma/client";

// ── 내부 emit 헬퍼 ────────────────────────────────────────────────────────────

async function emitOrderEvent(
  event: "order:created" | "order:updated",
  orderId: number
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { eta: true },
    });
    if (!order) return;

    const activeOrders = await prisma.order.findMany({
      where: {
        storeId: order.storeId,
        status: { in: ["PENDING", "ACCEPTED", "PREPARING"] },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    const idx = activeOrders.findIndex((o) => o.id === orderId);

    const payload = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      storeId: order.storeId,
      status: order.status,
      estimatedReadyAt: order.eta?.readyAt?.toISOString() ?? null,
      queuePosition: idx === -1 ? 0 : idx + 1,
    };

    const io = getIO();
    io.to(`store:${order.storeId}`).emit(event, payload);
    io.to(`order:${order.id}`).emit(event, payload);
  } catch (err) {
    console.error("[sim] emit failed:", err);
  }
}

async function emitEtaEvent(storeId: number): Promise<void> {
  try {
    const eta = await calcStoreEta(storeId);
    getIO().to(`store:${storeId}`).emit("eta:updated", {
      storeId: eta.storeId,
      queueCount: eta.queueCount,
      estimatedWaitMin: eta.estimatedWaitMin,
      etaMinLow: eta.etaMinLow,
      etaMinHigh: eta.etaMinHigh,
      earliestPickupAt: eta.earliestPickupAt.toISOString(),
      congestionLevel: eta.congestionLevel,
    });
  } catch (err) {
    console.error("[sim] eta emit failed:", err);
  }
}

// ── 상태 전환 ──────────────────────────────────────────────────────────────────

async function transition(orderId: number, status: OrderStatus): Promise<void> {
  try {
    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status },
      select: { id: true, storeId: true, orderNumber: true },
    });
    console.log(`[sim] ${order.orderNumber} → ${status}`);
    await Promise.all([
      emitOrderEvent("order:updated", orderId),
      emitEtaEvent(order.storeId),
    ]);
  } catch (err) {
    console.error(`[sim] transition(${orderId} → ${status}) failed:`, err);
  }
}

// ── 주문 생성 ─────────────────────────────────────────────────────────────────

let counter = 0;

const NAMES = [
  "김민준", "이서연", "박지호", "최유진", "정하은",
  "윤도현", "강수아", "임재원", "한지수", "오승민",
];

async function createOrder(): Promise<void> {
  try {
    // 열려 있는 매장 중 랜덤 선택
    const stores = await prisma.store.findMany({ where: { isOpen: true } });
    if (stores.length === 0) return;
    const store = stores[Math.floor(Math.random() * stores.length)];

    // 해당 매장의 판매 가능 메뉴 중 랜덤 선택
    const menus = await prisma.menu.findMany({
      where: { storeId: store.id, isAvailable: true },
    });
    if (menus.length === 0) return;
    const menu = menus[Math.floor(Math.random() * menus.length)];

    // 유니크 주문 번호 생성
    let orderNumber: string;
    do {
      const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const digits = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
      orderNumber = `${letter}-${digits}`;
    } while (await prisma.order.findUnique({ where: { orderNumber } }));

    // ETA 계산 (주문 생성 전 현재 큐 기준)
    const eta = await calcStoreEta(store.id);
    const readyAt = new Date(Date.now() + eta.estimatedWaitSec * 1000);

    const customerName = NAMES[counter++ % NAMES.length];

    const order = await prisma.order.create({
      data: {
        storeId: store.id,
        orderNumber,
        customerName,
        pickupType: "NOW",
        totalPrice: menu.price,
        items: {
          create: [{ menuId: menu.id, quantity: 1, price: menu.price }],
        },
        eta: {
          create: { estimatedSec: eta.estimatedWaitSec, readyAt },
        },
      },
    });

    console.log(
      `[sim] 주문 생성: ${orderNumber} · ${customerName} · ${store.name} · ${menu.name}`
    );

    await Promise.all([
      emitOrderEvent("order:created", order.id),
      emitEtaEvent(store.id),
    ]);

    // ── 자동 상태 전환 스케줄 ──────────────────────────────────────────────
    // PENDING → PREPARING : 5~10초
    // PREPARING → READY   : 10~20초
    // READY → COMPLETED   : 8~15초

    const pendingDelay   = 5_000 + Math.random() * 5_000;
    const preparingDelay = 10_000 + Math.random() * 10_000;
    const readyDelay     = 8_000 + Math.random() * 7_000;

    setTimeout(async () => {
      await transition(order.id, "PREPARING");

      setTimeout(async () => {
        await transition(order.id, "READY");

        setTimeout(async () => {
          await transition(order.id, "COMPLETED");
        }, readyDelay);
      }, preparingDelay);
    }, pendingDelay);
  } catch (err) {
    console.error("[sim] createOrder failed:", err);
  }
}

// ── 시작 진입점 ───────────────────────────────────────────────────────────────

export async function startSimulator(intervalMs = 5_000): Promise<void> {
  // 이전 실행에서 남은 미완료 주문 정리
  const stale = await prisma.order.updateMany({
    where: { status: { in: ["PENDING", "ACCEPTED", "PREPARING", "READY"] } },
    data: { status: "CANCELLED" },
  });
  if (stale.count > 0) {
    console.log(`[sim] 이전 미완료 주문 ${stale.count}건 취소 처리`);
  }

  console.log(`[sim] 시뮬레이터 시작 (${intervalMs / 1000}초 간격)`);

  // 서버 기동 직후 바로 1건 생성 후 인터벌 시작
  await createOrder();
  setInterval(createOrder, intervalMs);
}
