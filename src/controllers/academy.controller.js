import { z } from "zod";
import { getAcademySummary, completeMission } from "../services/academy.service.js";

const completeSchema = z.object({ decisionId: z.string().trim().min(1).max(80) }).strict();

export async function getProgress(req, res) {
  const data = await getAcademySummary(res.locals.auth.user.id);
  res.json({ success: true, data });
}

export async function postMissionCompletion(req, res) {
  const input = completeSchema.parse(req.body);
  const result = await completeMission(res.locals.auth.user.id, req.params.missionId, input.decisionId);
  const summary = await getAcademySummary(res.locals.auth.user.id);
  res.json({
    success: true,
    data: {
      mission: {
        missionId: result.progress.missionId,
        status: result.progress.status,
        bestScore: result.progress.bestScore,
        xpAwarded: result.progress.xpAwarded,
        attemptCount: result.progress.attemptCount,
        completedAt: result.progress.completedAt
      },
      xpEarnedNow: result.xpEarnedNow,
      firstCompletion: result.firstCompletion,
      summary
    }
  });
}
