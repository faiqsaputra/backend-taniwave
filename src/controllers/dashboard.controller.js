import { z } from "zod";
import { getDashboardSummary } from "../services/dashboard.service.js";

const querySchema = z.object({
  farmId: z.string().trim().min(1).optional()
});

export async function getSummary(req, res) {
  const query = querySchema.parse(req.query);
  const data = await getDashboardSummary(res.locals.auth.user, query.farmId);
  res.json({ success: true, data });
}
