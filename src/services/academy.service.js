import { getPrisma } from "../config/database.js";

// These scoring rules intentionally live on the server so clients cannot post arbitrary XP.
// If the IDs in the Phaser frontend differ, update this catalog to match its missions.js.
export const MISSION_CATALOG = {
  "rain-before-planting": {
    title: "Hujan Sebelum Tanam",
    category: "Farm Intelligence",
    decisions: {
      "inspect-drainage": { score: 100, xp: 30 },
      "plant-now": { score: 30, xp: 12 },
      "fertilize-first": { score: 20, xp: 10 }
    }
  },
  "budget-challenge": {
    title: "Modal Tinggal Sejuta",
    category: "Farm Business",
    decisions: {
      "prioritize-budget": { score: 100, xp: 30 },
      "priority-budget": { score: 100, xp: 30 },
      "spend-all": { score: 25, xp: 12 },
      "equal-allocation": { score: 45, xp: 18 }
    }
  },
  "harvest-grading": {
    title: "Panen 30 Kilogram",
    category: "Smart Marketing",
    decisions: {
      "sort-by-grade": { score: 100, xp: 30 },
      "mix-harvest": { score: 20, xp: 10 },
      "wait-premium": { score: 45, xp: 18 }
    }
  }
};

const LEVELS = [
  { level: 1, title: "Penjelajah", threshold: 0 },
  { level: 2, title: "Pengamat Kebun", threshold: 30 },
  { level: 3, title: "Perencana Budidaya", threshold: 70 },
  { level: 4, title: "Pengelola Usaha", threshold: 120 }
];

export function levelForXp(totalXp) {
  let currentIndex = 0;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (totalXp >= LEVELS[i].threshold) currentIndex = i;
  }
  const current = LEVELS[currentIndex];
  const next = LEVELS[currentIndex + 1] || null;
  const progressPct = next
    ? Math.min(100, Math.max(0, Math.round(((totalXp - current.threshold) / (next.threshold - current.threshold)) * 100)))
    : 100;
  return { ...current, currentXp: totalXp, nextLevelXp: next?.threshold ?? null, nextLevelTitle: next?.title ?? null, progressPct };
}

export async function getAcademySummary(userId) {
  const prisma = getPrisma();
  const progress = await prisma.academyProgress.findMany({
    where: { userId },
    orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }]
  });
  const totalXp = progress.reduce((sum, item) => sum + item.xpAwarded, 0);
  const completedIds = new Set(progress.filter((item) => item.status === "COMPLETED").map((item) => item.missionId));
  const nextMissionEntry = Object.entries(MISSION_CATALOG).find(([missionId]) => !completedIds.has(missionId));
  const nextMission = nextMissionEntry
    ? { id: nextMissionEntry[0], title: nextMissionEntry[1].title, category: nextMissionEntry[1].category }
    : null;

  return {
    totalXp,
    level: levelForXp(totalXp),
    progressPct: levelForXp(totalXp).progressPct,
    completedMissions: progress.filter((item) => item.status === "COMPLETED").length,
    totalMissions: Object.keys(MISSION_CATALOG).length,
    nextMission,
    missions: progress.map((item) => ({
      missionId: item.missionId,
      title: item.title,
      status: item.status,
      bestScore: item.bestScore,
      xpAwarded: item.xpAwarded,
      attemptCount: item.attemptCount,
      completedAt: item.completedAt
    }))
  };
}

export async function completeMission(userId, missionId, decisionId) {
  const mission = MISSION_CATALOG[missionId];
  if (!mission) {
    const error = new Error("Misi Smart Academy tidak dikenali.");
    error.statusCode = 404;
    error.code = "MISSION_NOT_FOUND";
    throw error;
  }
  const decision = mission.decisions[decisionId];
  if (!decision) {
    const error = new Error("Keputusan tidak valid untuk misi tersebut.");
    error.statusCode = 400;
    error.code = "INVALID_MISSION_DECISION";
    throw error;
  }

  const prisma = getPrisma();
  const result = await prisma.$transaction(async (tx) => {
    const where = { userId_missionId: { userId, missionId } };
    const existing = await tx.academyProgress.findUnique({ where });
    const firstCompletion = !existing || existing.status !== "COMPLETED";

    let progress;
    if (!existing) {
      progress = await tx.academyProgress.create({
        data: {
          userId,
          missionId,
          title: mission.title,
          status: "COMPLETED",
          bestScore: decision.score,
          xpAwarded: decision.xp,
          attemptCount: 1,
          completedAt: new Date()
        }
      });
    } else {
      progress = await tx.academyProgress.update({
        where: { id: existing.id },
        data: {
          title: mission.title,
          status: "COMPLETED",
          bestScore: Math.max(existing.bestScore, decision.score),
          xpAwarded: firstCompletion ? decision.xp : existing.xpAwarded,
          attemptCount: { increment: 1 },
          completedAt: existing.completedAt || new Date()
        }
      });
    }
    return { progress, firstCompletion, xpEarnedNow: firstCompletion ? decision.xp : 0 };
  });

  return result;
}
