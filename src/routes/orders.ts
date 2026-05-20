import { Router } from "express";
import { OrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { getIO } from "../lib/socket";
import { calcStoreEta } from "../lib/eta";

// ── Socket 이벤트 페이로드 ────────────────────────────────────────────────────

interface OrderEventPayload {
  orderId: number;
  orderNumber: string;
  storeId: number;
  status: string;
  estimatedReadyAt: string | null;
  queuePosition: number; // 0 = 대기열 이탈(READY/COMPLETED/CANCELLED)
}

// 대기열 내 위치 계산 + Socket emit
async function emitOrderEvent(
  event: "order:created" | "order:updated",
  order: {
    id: number;
    orderNumber: string;
    storeId: number;
    status: string;
    eta?: { readyAt: Date } | null;
  }
): Promise<void> {
  try {
    const activeOrders = await prisma.order.findMany({
      where: {
        storeId: order.storeId,
        status: { in: ["PENDING", "ACCEPTED", "PREPARING"] },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const idx = activeOrders.findIndex((o) => o.id === order.id);
    const queuePosition = idx === -1 ? 0 : idx + 1;

    const payload: OrderEventPayload = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      storeId: order.storeId,
      status: order.status,
      estimatedReadyAt: order.eta?.readyAt?.toISOString() ?? null,
      queuePosition,
    };

    const io = getIO();
    io.to(`store:${order.storeId}`).emit(event, payload);
    io.to(`order:${order.id}`).emit(event, payload);

    console.log(`[socket] ${event}`, payload);
  } catch (err) {
    // emit 실패가 주문 처리를 중단시키지 않도록 오류만 기록
    console.error("[socket] emit failed:", err);
  }
}

const router = Router();

// 주문 번호 생성 (예: "A-042")
function generateOrderNumber(): string {
  const letter = String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const digits = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `${letter}-${digits}`;
}

// 매장 ETA 변경 사실을 store 룸 전체에 브로드캐스트
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
    console.log(
      `[socket] eta:updated storeId=${storeId} queue=${eta.queueCount} ` +
        `wait=${eta.estimatedWaitMin}min [${eta.etaMinLow}-${eta.etaMinHigh}] ` +
        `level=${eta.congestionLevel}`
    );
  } catch (err) {
    console.error("[socket] eta:updated emit failed:", err);
  }
}

router.get("/", async (req, res) => {
  try {
    const { storeId, status } = req.query;
    const orders = await prisma.order.findMany({
      where: {
        ...(storeId ? { storeId: Number(storeId) } : {}),
        ...(status ? { status: status as OrderStatus } : {}),
      },
      include: { items: { include: { menu: true, choices: true } }, eta: true, pickupSlot: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        items: { include: { menu: true, choices: { include: { choice: true } } } },
        eta: true,
        pickupSlot: true,
      },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      storeId,
      customerName,
      customerPhone,
      pickupType,
      pickupSlotId,
      memo,
      items,
    }: {
      storeId: number;
      customerName: string;
      customerPhone?: string;
      pickupType?: "NOW" | "SCHEDULED";
      pickupSlotId?: number;
      memo?: string;
      items: Array<{
        menuId: number;
        quantity: number;
        choiceIds?: number[];
      }>;
    } = req.body;

    // 메뉴 가격 조회 및 총액 계산
    const menuIds = items.map((i) => i.menuId);
    const menus = await prisma.menu.findMany({ where: { id: { in: menuIds } } });
    const menuMap = new Map(menus.map((m) => [m.id, m]));

    let totalPrice = 0;
    for (const item of items) {
      const menu = menuMap.get(item.menuId);
      if (!menu) return res.status(400).json({ error: `Menu ${item.menuId} not found` });
      totalPrice += menu.price * item.quantity;
    }

    // 주문 생성
    let orderNumber: string;
    do {
      orderNumber = generateOrderNumber();
    } while (await prisma.order.findUnique({ where: { orderNumber } }));

    const order = await prisma.order.create({
      data: {
        storeId,
        orderNumber,
        customerName,
        customerPhone,
        pickupType: pickupType ?? "NOW",
        pickupSlotId,
        totalPrice,
        memo,
        items: {
          create: items.map((item) => ({
            menuId: item.menuId,
            quantity: item.quantity,
            price: menuMap.get(item.menuId)!.price,
            choices: item.choiceIds?.length
              ? { create: item.choiceIds.map((choiceId) => ({ choiceId })) }
              : undefined,
          })),
        },
      },
      include: { items: true },
    });

    // OrderEta 스냅샷 저장 (즉시 픽업일 때만)
    if ((pickupType ?? "NOW") === "NOW") {
      const eta = await calcStoreEta(storeId);
      const readyAt = new Date(Date.now() + eta.estimatedWaitSec * 1000);
      await prisma.orderEta.create({
        data: { orderId: order.id, estimatedSec: eta.estimatedWaitSec, readyAt },
      });
    }

    const result = await prisma.order.findUnique({
      where: { id: order.id },
      include: { items: { include: { menu: true } }, eta: true },
    });

    void emitOrderEvent("order:created", {
      id: result!.id,
      orderNumber: result!.orderNumber,
      storeId: result!.storeId,
      status: result!.status,
      eta: result!.eta,
    });
    void emitEtaEvent(storeId);

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to create order" });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const { status }: { status: OrderStatus } = req.body;
    const order = await prisma.order.update({
      where: { id: Number(req.params.id) },
      data: { status },
      include: { eta: true },
    });

    void emitOrderEvent("order:updated", {
      id: order.id,
      orderNumber: order.orderNumber,
      storeId: order.storeId,
      status: order.status,
      eta: order.eta,
    });
    void emitEtaEvent(order.storeId);

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: "Failed to update order status" });
  }
});

export default router;
