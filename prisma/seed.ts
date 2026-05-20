import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// "HH:mm" 기준 10분 단위 슬롯 목록 생성 (startHour ~ endHour)
function buildSlotTimes(startHour: number, endHour: number) {
  const slots: { startTime: string; endTime: string }[] = [];
  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += 10) {
      const sh = String(h).padStart(2, "0");
      const sm = String(m).padStart(2, "0");
      const eh = m + 10 >= 60 ? h + 1 : h;
      const em = (m + 10) % 60;
      slots.push({
        startTime: `${sh}:${sm}`,
        endTime: `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`,
      });
    }
  }
  return slots;
}

async function main() {
  // ── 기존 데이터 초기화 ───────────────────────────────────────────────────
  // TRUNCATE ... CASCADE: 관련 테이블을 동시에 락 → 시뮬레이터 동시 쓰기에 안전
  await prisma.$executeRawUnsafe(
    "TRUNCATE TABLE stores, categories RESTART IDENTITY CASCADE"
  );

  // ── 카테고리 ──────────────────────────────────────────────────────────────
  const [catDrink, catBakery] = await Promise.all([
    prisma.category.create({ data: { name: "커피/음료", sortOrder: 0 } }),
    prisma.category.create({ data: { name: "베이커리", sortOrder: 1 } }),
  ]);

  // ── 매장 + 메뉴 + 옵션 ───────────────────────────────────────────────────
  const gangnam = await prisma.store.create({
    data: {
      name: "강남점",
      address: "서울 강남구 테헤란로 123",
      phone: "02-1234-5678",
      openAt: "08:00",
      closeAt: "22:00",
      etaConfig: {
        create: { baseBufferSec: 60, perOrderSec: 120, maxCapacity: 20 },
      },
      menus: {
        create: [
          {
            categoryId: catDrink.id,
            name: "아메리카노",
            description: "깔끔하고 진한 에스프레소 베이스",
            price: 4500,
            prepTimeSec: 120,
            sortOrder: 0,
            options: {
              create: [
                {
                  name: "사이즈",
                  isRequired: true,
                  maxSelect: 1,
                  choices: {
                    create: [
                      { name: "Regular", extraPrice: 0 },
                      { name: "Large", extraPrice: 500 },
                    ],
                  },
                },
                {
                  name: "온도",
                  isRequired: true,
                  maxSelect: 1,
                  choices: {
                    create: [
                      { name: "Hot", extraPrice: 0 },
                      { name: "Iced", extraPrice: 0 },
                    ],
                  },
                },
              ],
            },
          },
          {
            categoryId: catDrink.id,
            name: "카페라떼",
            description: "부드러운 우유와 에스프레소의 조화",
            price: 5500,
            prepTimeSec: 150,
            sortOrder: 1,
            options: {
              create: [
                {
                  name: "사이즈",
                  isRequired: true,
                  maxSelect: 1,
                  choices: {
                    create: [
                      { name: "Regular", extraPrice: 0 },
                      { name: "Large", extraPrice: 500 },
                    ],
                  },
                },
                {
                  name: "온도",
                  isRequired: true,
                  maxSelect: 1,
                  choices: {
                    create: [
                      { name: "Hot", extraPrice: 0 },
                      { name: "Iced", extraPrice: 0 },
                    ],
                  },
                },
              ],
            },
          },
          {
            categoryId: catBakery.id,
            name: "크로아상",
            description: "버터 향 가득한 겹겹이 바삭한 크로아상",
            price: 4000,
            prepTimeSec: 60,
            sortOrder: 2,
          },
        ],
      },
    },
  });

  const seongsu = await prisma.store.create({
    data: {
      name: "성수점",
      address: "서울 성동구 성수이로 456",
      phone: "02-9876-5432",
      openAt: "09:00",
      closeAt: "21:00",
      etaConfig: {
        create: { baseBufferSec: 90, perOrderSec: 100, maxCapacity: 15 },
      },
      menus: {
        create: [
          {
            categoryId: catDrink.id,
            name: "콜드브루",
            description: "12시간 냉침 추출 콜드브루",
            price: 5000,
            prepTimeSec: 90,
            sortOrder: 0,
            options: {
              create: [
                {
                  name: "사이즈",
                  isRequired: true,
                  maxSelect: 1,
                  choices: {
                    create: [
                      { name: "Regular", extraPrice: 0 },
                      { name: "Large", extraPrice: 500 },
                    ],
                  },
                },
              ],
            },
          },
          {
            categoryId: catBakery.id,
            name: "스콘",
            description: "촉촉한 플레인 스콘",
            price: 3500,
            prepTimeSec: 60,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  // ── 오늘부터 7일치 픽업 슬롯 (10분 단위) ────────────────────────────────────
  // production: 실제 영업시간 기준 / 그 외: 00:00~24:00 (시연 목적)
  const isProd = process.env.NODE_ENV === "production";
  const gangnamHours: [number, number] = isProd ? [8, 24] : [0, 24];
  const seongsuHours: [number, number] = isProd ? [9, 21] : [0, 24];

  const now = new Date();
  const SLOT_DAYS = 7;

  const gangnamSlots = Array.from({ length: SLOT_DAYS }, (_, i) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + i));
    return buildSlotTimes(...gangnamHours).map((s) => ({
      storeId: gangnam.id,
      date,
      ...s,
      capacity: 5,
    }));
  }).flat();

  const seongsuSlots = Array.from({ length: SLOT_DAYS }, (_, i) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + i));
    return buildSlotTimes(...seongsuHours).map((s) => ({
      storeId: seongsu.id,
      date,
      ...s,
      capacity: 4,
    }));
  }).flat();

  await prisma.pickupSlot.createMany({ data: [...gangnamSlots, ...seongsuSlots] });

  // ── 결과 요약 ─────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    prisma.store.count(),
    prisma.category.count(),
    prisma.menu.count(),
    prisma.menuOption.count(),
    prisma.menuOptionChoice.count(),
    prisma.etaConfig.count(),
    prisma.pickupSlot.count(),
  ]);

  console.log(`✅ Seed 완료 [${isProd ? "production" : "dev — 00:00~24:00 슬롯"}]`);
  console.log(`   Store           : ${counts[0]}`);
  console.log(`   Category        : ${counts[1]}`);
  console.log(`   Menu            : ${counts[2]}`);
  console.log(`   MenuOption      : ${counts[3]}`);
  console.log(`   MenuOptionChoice: ${counts[4]}`);
  console.log(`   EtaConfig       : ${counts[5]}`);
  console.log(`   PickupSlot      : ${counts[6]}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
