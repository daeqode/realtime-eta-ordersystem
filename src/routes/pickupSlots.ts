import { Router, Request } from "express";
import prisma from "../lib/prisma";

type StoreParams = { storeId: string };

// mergeParams: true — storeId를 부모 라우터에서 상속
const router = Router({ mergeParams: true });

router.get("/", async (req: Request<StoreParams>, res) => {
  try {
    const { date } = req.query;
    const slots = await prisma.pickupSlot.findMany({
      where: {
        storeId: Number(req.params.storeId),
        ...(date ? { date: new Date(date as string) } : {}),
      },
      include: { _count: { select: { orders: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });

    // 잔여 capacity 계산
    const result = slots.map((slot) => ({
      ...slot,
      remaining: slot.capacity - slot._count.orders,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pickup slots" });
  }
});

router.post("/", async (req: Request<StoreParams>, res) => {
  try {
    const { date, startTime, endTime, capacity } = req.body;
    const slot = await prisma.pickupSlot.create({
      data: {
        storeId: Number(req.params.storeId),
        date: new Date(date),
        startTime,
        endTime,
        capacity,
      },
    });
    res.status(201).json(slot);
  } catch (err) {
    res.status(500).json({ error: "Failed to create pickup slot" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { capacity, isBlocked } = req.body;
    const slot = await prisma.pickupSlot.update({
      where: { id: Number(req.params.id) },
      data: { capacity, isBlocked },
    });
    res.json(slot);
  } catch (err) {
    res.status(500).json({ error: "Failed to update pickup slot" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await prisma.pickupSlot.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete pickup slot" });
  }
});

export default router;
