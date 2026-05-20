import { createServer } from "http";
import express from "express";
import { initSocket } from "./lib/socket";
import storesRouter from "./routes/stores";
import menusRouter from "./routes/menus";
import ordersRouter from "./routes/orders";
import pickupSlotsRouter from "./routes/pickupSlots";

const app = express();
const httpServer = createServer(app);
const PORT = 3000;

initSocket(httpServer);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/stores", storesRouter);
app.use("/api/stores/:storeId/menus", menusRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/stores/:storeId/pickup-slots", pickupSlotsRouter);

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);

  if (process.env.NODE_ENV !== "production") {
    import("./simulator").then(({ startSimulator }) => {
      startSimulator().catch(console.error);
    });
  }
});
