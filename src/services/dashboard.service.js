import { getPrisma } from "../config/database.js";
import { getWeatherSummary } from "./weather.service.js";
import { buildMarketPrices, findMatchingDemands } from "./market.service.js";
import { getAcademySummary } from "./academy.service.js";

const ACTIVE_CROP_STATUSES = ["PLANTED", "GROWING"];
const DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(value) {
  if (value == null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function daysBetween(start, end = new Date()) {
  if (!start) return null;
  return Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS));
}

function calculateProgressPct(crop, now = new Date()) {
  if (!crop?.plantedAt || !crop?.expectedHarvest) return null;
  const start = new Date(crop.plantedAt).getTime();
  const end = new Date(crop.expectedHarvest).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.min(100, Math.max(0, Math.round(((now.getTime() - start) / (end - start)) * 100)));
}

function chooseActiveCrop(crops = []) {
  const sorted = [...crops].sort((a, b) => {
    const statusPriority = (status) => status === "GROWING" ? 0 : status === "PLANTED" ? 1 : status === "PLANNED" ? 2 : 3;
    const priority = statusPriority(a.status) - statusPriority(b.status);
    if (priority !== 0) return priority;
    return new Date(b.plantedAt || b.createdAt) - new Date(a.plantedAt || a.createdAt);
  });
  return sorted.find((crop) => crop.status !== "HARVESTED") || null;
}

function aggregateHarvestsByUnit(harvests) {
  const totals = new Map();
  for (const harvest of harvests) {
    const unit = harvest.unit || "unit";
    totals.set(unit, (totals.get(unit) || 0) + Number(harvest.quantity || 0));
  }
  const byUnit = [...totals.entries()].map(([unit, quantity]) => ({ unit, quantity: Number(quantity.toFixed(3)) }));
  return {
    harvestedQuantity: byUnit.length === 1 ? byUnit[0].quantity : null,
    harvestUnit: byUnit.length === 1 ? byUnit[0].unit : null,
    harvestByUnit: byUnit
  };
}

async function getOwnedFarm(prisma, userId, farmId) {
  const farms = await prisma.farm.findMany({
    where: { userId },
    include: { crops: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" }
  });

  if (farmId) {
    const farm = farms.find((item) => item.id === farmId);
    if (!farm) {
      const error = new Error("Kebun tidak ditemukan atau tidak dapat diakses oleh pengguna ini.");
      error.statusCode = 404;
      error.code = "FARM_NOT_FOUND";
      throw error;
    }
    return farm;
  }

  // Prefer the newest farm containing a crop that has not been harvested.
  return farms.find((farm) => farm.crops.some((crop) => crop.status !== "HARVESTED")) || farms[0] || null;
}

async function getFarmProgress(prisma, user, farm) {
  if (!farm) {
    return {
      farmId: null,
      farmName: null,
      activeCropCycle: null,
      ageDays: null,
      progressPct: null,
      expectedHarvestAt: null,
      daysToHarvest: null,
      capitalAmount: null,
      expensesAmount: null,
      harvestedQuantity: null,
      harvestUnit: null,
      harvestByUnit: [],
      lastObservedAt: null,
      hasRecentObservation: false,
      dataQuality: { unallocatedExpenseRecords: 0, unallocatedHarvestRecords: 0 }
    };
  }

  const activeCrop = chooseActiveCrop(farm.crops);
  const metricScope = [{ farmId: farm.id }];
  if (activeCrop) metricScope.push({ cropId: activeCrop.id });
  const financialWhere = { userId: user.id, OR: metricScope };

  const [expenseRows, harvestRows, latestActivity, unallocatedExpenseRecords, unallocatedHarvestRecords] = await Promise.all([
    prisma.expense.findMany({ where: financialWhere, select: { amount: true } }),
    prisma.harvest.findMany({ where: financialWhere, select: { quantity: true, unit: true, quality: true, harvestDate: true } }),
    prisma.farmActivity.findFirst({
      where: { userId: user.id, farmId: farm.id },
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, type: true, title: true, observedAt: true }
    }),
    prisma.expense.count({ where: { userId: user.id, farmId: null, cropId: null } }),
    prisma.harvest.count({ where: { userId: user.id, farmId: null, cropId: null } })
  ]);

  const expensesAmount = expenseRows.length
    ? Number(expenseRows.reduce((total, row) => total + Number(row.amount), 0).toFixed(2))
    : unallocatedExpenseRecords > 0 ? null : 0;
  const harvestStats = aggregateHarvestsByUnit(harvestRows);
  const ageDays = activeCrop?.plantedAt ? daysBetween(activeCrop.plantedAt) : null;
  const daysToHarvest = activeCrop?.expectedHarvest
    ? Math.max(0, Math.ceil((new Date(activeCrop.expectedHarvest).getTime() - Date.now()) / DAY_MS))
    : null;
  const hasRecentObservation = Boolean(latestActivity && Date.now() - new Date(latestActivity.observedAt).getTime() <= 7 * DAY_MS);

  return {
    farmId: farm.id,
    farmName: farm.name,
    location: farm.location,
    activeCropCycle: activeCrop ? {
      id: activeCrop.id,
      name: activeCrop.name,
      variety: activeCrop.variety,
      status: activeCrop.status,
      plantedAt: activeCrop.plantedAt,
      expectedHarvestAt: activeCrop.expectedHarvest
    } : null,
    ageDays,
    progressPct: calculateProgressPct(activeCrop),
    expectedHarvestAt: activeCrop?.expectedHarvest || null,
    daysToHarvest,
    capitalAmount: asNumber(activeCrop?.budgetAmount),
    expensesAmount,
    expenseRecordsCount: expenseRows.length,
    harvestedQuantity: harvestStats.harvestedQuantity,
    harvestUnit: harvestStats.harvestUnit,
    harvestByUnit: harvestStats.harvestByUnit,
    harvestRecordsCount: harvestRows.length,
    lastObservedAt: latestActivity?.observedAt || null,
    lastActivity: latestActivity ? {
      type: latestActivity.type,
      title: latestActivity.title,
      observedAt: latestActivity.observedAt
    } : null,
    hasRecentObservation,
    dataQuality: { unallocatedExpenseRecords, unallocatedHarvestRecords }
  };
}

async function getMarketSummary(prisma, user) {
  const [snapshots, listings, demands] = await Promise.all([
    prisma.marketPrice.findMany({ orderBy: { observedAt: "desc" }, take: 120 }),
    prisma.marketplaceListing.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, commodity: true, quantity: true, unit: true, price: true, quality: true, location: true }
    }),
    prisma.marketDemand.findMany({
      where: { status: "OPEN", buyerId: { not: user.id } },
      include: { buyer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    })
  ]);

  const prices = buildMarketPrices(snapshots);
  const matches = findMatchingDemands({ listings, demands });
  return {
    prices,
    opportunities: {
      matchingDemandCount: matches.length,
      matches: matches.slice(0, 3),
      activeListingCount: listings.length,
      openDemandCount: demands.length
    },
    dataMode: prices.some((item) => item.isDemo) ? "demo" : prices.length ? "partial" : "unavailable"
  };
}

function buildPulse({ weather, farmProgress, market }) {
  const items = [];
  const today = weather.forecast?.[0];
  const rainPct = weather.current?.rainProbabilityPct ?? today?.rainProbabilityPct;
  if (weather.current && rainPct != null && rainPct >= 60) {
    items.push({
      id: "weather-rain",
      type: "weather",
      priority: "warning",
      title: "Cuaca",
      text: `Peluang hujan mencapai ${rainPct}% di lokasi kebun.`,
      action: "Lihat prakiraan",
      path: "/weather"
    });
  }

  if (farmProgress.farmId && farmProgress.activeCropCycle && !farmProgress.hasRecentObservation) {
    items.push({
      id: "farm-observation",
      type: "farm",
      priority: "info",
      title: "Tanaman",
      text: "Pengamatan kebun belum diperbarui dalam 7 hari terakhir.",
      action: "Periksa tanaman",
      path: "/diagnosis"
    });
  }

  if (market.opportunities.matchingDemandCount > 0) {
    items.push({
      id: "market-opportunity",
      type: "market",
      priority: "opportunity",
      title: "Pasar",
      text: `${market.opportunities.matchingDemandCount} permintaan pembeli cocok dengan listing aktifmu.`,
      action: "Lihat peluang",
      path: "/marketplace"
    });
  }

  if (!items.length) {
    items.push({
      id: "dashboard-start",
      type: "info",
      priority: "normal",
      title: "TANIWAVE",
      text: farmProgress.farmId
        ? "Belum ada peringatan atau permintaan yang cocok. Perbarui pengamatan kebunmu secara rutin."
        : "Tambahkan kebun untuk mulai mendapatkan ringkasan cuaca dan perkembangan usaha tani.",
      action: farmProgress.farmId ? "Lihat kebun" : "Kelola kebun",
      path: "/smart-farming"
    });
  }
  return items;
}

export async function getDashboardSummary(user, requestedFarmId) {
  const prisma = getPrisma();
  const farm = await getOwnedFarm(prisma, user.id, requestedFarmId);
  const farmProgressPromise = getFarmProgress(prisma, user, farm);
  const weatherPromise = getWeatherSummary(farm);
  const marketPromise = getMarketSummary(prisma, user);
  const academyPromise = getAcademySummary(user.id);
  const [farmProgress, weather, market, learning, activePractice] = await Promise.all([
    farmProgressPromise,
    weatherPromise,
    marketPromise,
    academyPromise,
    prisma.practiceSession.findFirst({
      where: { userId: user.id, status: "STARTED" },
      orderBy: { startedAt: "desc" },
      select: { id: true, practiceId: true, title: true, status: true, startedAt: true }
    })
  ]);

  const pulse = buildPulse({ weather, farmProgress, market });
  const hasDemoData = market.dataMode === "demo";
  const dataMode = hasDemoData ? "demo" : weather.current && market.prices.length ? "live" : "partial";

  return {
    generatedAt: new Date().toISOString(),
    dataMode,
    profile: {
      id: user.id,
      displayName: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl || null,
      role: user.role
    },
    farmLocation: farm ? {
      farmId: farm.id,
      label: farm.location || farm.name,
      latitude: farm.latitude,
      longitude: farm.longitude
    } : null,
    pulse,
    weather: {
      status: weather.status,
      timezone: weather.timezone || null,
      current: weather.current,
      forecast: weather.forecast,
      source: weather.source,
      updatedAt: weather.updatedAt,
      isStale: weather.isStale,
      detail: weather.detail || null
    },
    market,
    farmProgress,
    learning,
    practice: activePractice ? {
      status: "started",
      activeSessionId: activePractice.id,
      practiceId: activePractice.practiceId,
      title: activePractice.title,
      startedAt: activePractice.startedAt
    } : {
      status: "not_started",
      activeSessionId: null,
      practiceId: null,
      title: null,
      startedAt: null
    }
  };
}
