import prisma from "./prisma";

export type CongestionLevel = "LOW" | "MEDIUM" | "HIGH";

export interface StoreEta {
  storeId: number;
  queueCount: number;
  estimatedWaitSec: number;
  estimatedWaitMin: number;
  etaMinLow: number;
  etaMinHigh: number;
  earliestPickupAt: Date;
  congestionLevel: CongestionLevel;
}

export async function calcStoreEta(storeId: number): Promise<StoreEta> {
  const [config, queueCount] = await Promise.all([
    prisma.etaConfig.findUnique({ where: { storeId } }),
    prisma.order.count({
      where: {
        storeId,
        status: { in: ["PENDING", "ACCEPTED", "PREPARING"] },
      },
    }),
  ]);

  const base = config?.baseBufferSec ?? 60;
  const perOrder = config?.perOrderSec ?? 120;
  const maxCapacity = config?.maxCapacity ?? 20;

  const estimatedWaitSec = base + queueCount * perOrder;
  const estimatedWaitMin = Math.round(estimatedWaitSec / 60);
  const etaMinLow = Math.max(1, estimatedWaitMin - 2);
  const etaMinHigh = estimatedWaitMin + 3;
  const earliestPickupAt = new Date(Date.now() + etaMinLow * 60 * 1000);

  const ratio = maxCapacity > 0 ? queueCount / maxCapacity : 0;
  const congestionLevel: CongestionLevel =
    ratio < 0.3 ? "LOW" : ratio < 0.7 ? "MEDIUM" : "HIGH";

  return {
    storeId,
    queueCount,
    estimatedWaitSec,
    estimatedWaitMin,
    etaMinLow,
    etaMinHigh,
    earliestPickupAt,
    congestionLevel,
  };
}
