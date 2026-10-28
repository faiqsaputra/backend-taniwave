import { z } from "zod";
import { getPrisma } from "../config/database.js";

const activitySchema = z.object({
  type: z.string().trim().min(2).max(40).default("OBSERVATION"),
  title: z.string().trim().min(3).max(120).default("Pengamatan kebun diperbarui"),
  description: z.string().trim().max(2000).nullable().optional(),
  cropId: z.string().trim().min(1).nullable().optional(),
  observedAt: z.coerce.date().optional()
}).strict();

export async function createFarmActivity(req, res) {
  const input = activitySchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const farm = await prisma.farm.findFirst({ where: { id: req.params.farmId, userId: user.id }, select: { id: true } });
  if (!farm) {
    return res.status(404).json({ success: false, error: { code: "FARM_NOT_FOUND", message: "Kebun tidak ditemukan atau tidak dapat diakses." } });
  }

  if (input.cropId) {
    const crop = await prisma.crop.findFirst({ where: { id: input.cropId, farmId: farm.id }, select: { id: true } });
    if (!crop) {
      return res.status(400).json({ success: false, error: { code: "CROP_FARM_MISMATCH", message: "Tanaman tidak termasuk dalam kebun yang dipilih." } });
    }
  }

  const activity = await prisma.farmActivity.create({
    data: {
      userId: user.id,
      farmId: farm.id,
      cropId: input.cropId || null,
      type: input.type,
      title: input.title,
      description: input.description || null,
      ...(input.observedAt ? { observedAt: input.observedAt } : {})
    }
  });
  return res.status(201).json({ success: true, data: activity });
}
