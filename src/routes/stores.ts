import { Router } from "express";
import prisma from "../lib/prisma";
import { calcStoreEta } from "../lib/eta";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const stores = await prisma.store.findMany({
      orderBy: { createdAt: "desc" },
    });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stores" });
  }
});

// /:id 보다 먼저 선언 — "eta-summary"가 :id로 매칭되는 것을 방지
router.get("/eta-summary", async (_req, res) => {
  try {
    const stores = await prisma.store.findMany({
      select: { id: true },
    });

    const results = await Promise.allSettled(
      stores.map((s) => calcStoreEta(s.id))
    );

    const summary = results.map((r, i) => {
      if (r.status === "rejected") return null;
      const eta = r.value;
      return {
        storeId: stores[i].id,
        queueCount: eta.queueCount,
        estimatedWaitMin: eta.estimatedWaitMin,
        etaMinLow: eta.etaMinLow,
        etaMinHigh: eta.etaMinHigh,
        earliestPickupAt: eta.earliestPickupAt.toISOString(),
        congestionLevel: eta.congestionLevel,
      };
    }).filter(Boolean);

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch ETA summary" });
  }
});

router.get("/:id/eta", async (req, res) => {
  try {
    const eta = await calcStoreEta(Number(req.params.id));
    res.json({
      storeId: eta.storeId,
      queueCount: eta.queueCount,
      estimatedWaitMin: eta.estimatedWaitMin,
      etaMinLow: eta.etaMinLow,
      etaMinHigh: eta.etaMinHigh,
      earliestPickupAt: eta.earliestPickupAt.toISOString(),
      congestionLevel: eta.congestionLevel,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to calculate ETA" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const store = await prisma.store.findUnique({
      where: { id: Number(req.params.id) },
      include: { etaConfig: true },
    });
    if (!store) return res.status(404).json({ error: "Store not found" });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch store" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, address, phone, imageUrl, openAt, closeAt } = req.body;
    const store = await prisma.store.create({
      data: { name, address, phone, imageUrl, openAt, closeAt },
    });
    res.status(201).json(store);
  } catch (err) {
    res.status(500).json({ error: "Failed to create store" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { name, address, phone, imageUrl, isOpen, openAt, closeAt } =
      req.body;
    const store = await prisma.store.update({
      where: { id: Number(req.params.id) },
      data: { name, address, phone, imageUrl, isOpen, openAt, closeAt },
    });
    res.json(store);
  } catch (err) {
    res.status(500).json({ error: "Failed to update store" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await prisma.store.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete store" });
  }
});

export default router;
