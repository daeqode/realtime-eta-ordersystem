import { Router, Request } from "express";
import prisma from "../lib/prisma";

type StoreParams = { storeId: string };

// mergeParams: true — storeId를 부모 라우터에서 상속
const router = Router({ mergeParams: true });

router.get("/", async (req: Request<StoreParams>, res) => {
  try {
    const menus = await prisma.menu.findMany({
      where: { storeId: Number(req.params.storeId) },
      include: { category: true, options: { include: { choices: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json(menus);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch menus" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const menu = await prisma.menu.findUnique({
      where: { id: Number(req.params.id) },
      include: { category: true, options: { include: { choices: true } } },
    });
    if (!menu) return res.status(404).json({ error: "Menu not found" });
    res.json(menu);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch menu" });
  }
});

router.post("/", async (req: Request<StoreParams>, res) => {
  try {
    const {
      categoryId,
      name,
      description,
      price,
      imageUrl,
      prepTimeSec,
      sortOrder,
    } = req.body;
    const menu = await prisma.menu.create({
      data: {
        storeId: Number(req.params.storeId),
        categoryId,
        name,
        description,
        price,
        imageUrl,
        prepTimeSec,
        sortOrder,
      },
    });
    res.status(201).json(menu);
  } catch (err) {
    res.status(500).json({ error: "Failed to create menu" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const {
      categoryId,
      name,
      description,
      price,
      imageUrl,
      isAvailable,
      prepTimeSec,
      sortOrder,
    } = req.body;
    const menu = await prisma.menu.update({
      where: { id: Number(req.params.id) },
      data: {
        categoryId,
        name,
        description,
        price,
        imageUrl,
        isAvailable,
        prepTimeSec,
        sortOrder,
      },
    });
    res.json(menu);
  } catch (err) {
    res.status(500).json({ error: "Failed to update menu" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await prisma.menu.delete({ where: { id: Number(req.params.id) } });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete menu" });
  }
});

export default router;
