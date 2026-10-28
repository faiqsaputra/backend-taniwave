import "../src/config/env.js";
import { getPrisma, disconnectDatabase } from "../src/config/database.js";

const rows = [
  { commodity: "Cabai", price: 48500, changePct: 8.4, unit: "kg" },
  { commodity: "Tomat", price: 12800, changePct: -2.1, unit: "kg" },
  { commodity: "Bawang", price: 34200, changePct: 4.7, unit: "kg" },
  { commodity: "Jagung", price: 8900, changePct: 1.8, unit: "kg" }
];

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_DATA !== "true") {
  throw new Error("Seed demo dinonaktifkan di production. Set ALLOW_DEMO_DATA=true hanya jika memang disengaja.");
}

const prisma = getPrisma();
try {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await prisma.marketPrice.deleteMany({ where: { source: "TANIWAVE-DEMO" } });

  const data = rows.flatMap((row) => {
    const previousPrice = Math.round((row.price / (1 + row.changePct / 100)) / 100) * 100;
    return [
      {
        commodity: row.commodity, price: previousPrice, unit: row.unit,
        location: "Data simulasi", source: "TANIWAVE-DEMO", isDemo: true, observedAt: yesterday
      },
      {
        commodity: row.commodity, price: row.price, unit: row.unit,
        location: "Data simulasi", source: "TANIWAVE-DEMO", isDemo: true, observedAt: now
      }
    ];
  });

  await prisma.marketPrice.createMany({ data });
  console.log(`Seeded ${data.length} sample market-price snapshots. Semua ditandai isDemo=true.`);
} finally {
  await disconnectDatabase();
}
