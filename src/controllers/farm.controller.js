import { z } from "zod";
import { getPrisma } from "../config/database.js";

const createFarmSchema = z.object({
  name: z.string().trim().min(2).max(100),
  location: z.string().trim().max(200).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  area: z.coerce.number().positive().nullable().optional(),
  unit: z.string().trim().max(20).default("m2")
}).strict();

const updateFarmSchema = createFarmSchema.partial().strict();
const createCropSchema = z.object({
  name: z.string().trim().min(2).max(100),
  variety: z.string().trim().max(100).nullable().optional(),
  plantedAt: z.coerce.date().nullable().optional(),
  expectedHarvest: z.coerce.date().nullable().optional(),
  budgetAmount: z.coerce.number().min(0).nullable().optional(),
  status: z.enum(["PLANNED", "PLANTED", "GROWING", "HARVESTED"]).default("PLANTED")
}).strict();

const createExpenseSchema = z.object({
  category: z.string().trim().min(2).max(80),
  amount: z.coerce.number().positive().max(1_000_000_000_000),
  note: z.string().trim().max(1000).nullable().optional(),
  cropId: z.string().trim().min(1).nullable().optional(),
  date: z.coerce.date().optional()
}).strict();

const createHarvestSchema = z.object({
  cropId: z.string().trim().min(1).nullable().optional(),
  cropName: z.string().trim().min(2).max(100).optional(),
  quantity: z.coerce.number().positive().max(1_000_000_000),
  unit: z.string().trim().min(1).max(20).default("kg"),
  quality: z.enum(["A", "B", "C"]).nullable().optional(),
  harvestDate: z.coerce.date().optional()
}).strict();

function badRequest(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

async function requireOwnedFarm(prisma, userId, farmId) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) {
    const error = new Error("Kebun tidak ditemukan atau tidak dapat diakses oleh pengguna ini.");
    error.statusCode = 404;
    error.code = "FARM_NOT_FOUND";
    throw error;
  }
  return farm;
}

async function requireCropInFarm(prisma, farmId, cropId) {
  if (!cropId) return null;
  const crop = await prisma.crop.findFirst({ where: { id: cropId, farmId } });
  if (!crop) throw badRequest("CROP_FARM_MISMATCH", "Tanaman tidak termasuk dalam kebun yang dipilih.");
  return crop;
}

export async function listFarms(req, res) {
  const prisma = getPrisma();
  const farms = await prisma.farm.findMany({
    where: { userId: res.locals.auth.user.id },
    include: { crops: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" }
  });
  res.json({ success: true, data: farms });
}

export async function createFarm(req, res) {
  const input = createFarmSchema.parse(req.body);
  if ((input.latitude == null) !== (input.longitude == null)) {
    throw badRequest("INCOMPLETE_COORDINATES", "Latitude dan longitude harus dikirim bersamaan.");
  }
  const prisma = getPrisma();
  const data = await prisma.farm.create({ data: { ...input, userId: res.locals.auth.user.id } });
  res.status(201).json({ success: true, data });
}

export async function updateFarm(req, res) {
  const input = updateFarmSchema.parse(req.body);
  if (!Object.keys(input).length) throw badRequest("EMPTY_UPDATE", "Kirim setidaknya satu field yang ingin diubah.");
  if ((input.latitude === null) !== (input.longitude === null)) {
    throw badRequest("INCOMPLETE_COORDINATES", "Untuk menghapus koordinat, latitude dan longitude harus sama-sama null.");
  }
  if ((input.latitude !== undefined && input.latitude !== null) !== (input.longitude !== undefined && input.longitude !== null)) {
    throw badRequest("INCOMPLETE_COORDINATES", "Latitude dan longitude harus dikirim bersamaan.");
  }

  const prisma = getPrisma();
  const farm = await requireOwnedFarm(prisma, res.locals.auth.user.id, req.params.farmId);
  const data = await prisma.farm.update({ where: { id: farm.id }, data: input });
  res.json({ success: true, data });
}

export async function createCrop(req, res) {
  const input = createCropSchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const farm = await requireOwnedFarm(prisma, user.id, req.params.farmId);
  if (input.plantedAt && input.expectedHarvest && input.expectedHarvest <= input.plantedAt) {
    throw badRequest("INVALID_HARVEST_DATE", "Estimasi panen harus sesudah tanggal tanam.");
  }
  const data = await prisma.crop.create({
    data: {
      farmId: farm.id,
      name: input.name,
      variety: input.variety || null,
      plantedAt: input.plantedAt || null,
      expectedHarvest: input.expectedHarvest || null,
      budgetAmount: input.budgetAmount == null ? null : input.budgetAmount,
      status: input.status
    }
  });
  res.status(201).json({ success: true, data });
}

export async function createExpense(req, res) {
  const input = createExpenseSchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const farm = await requireOwnedFarm(prisma, user.id, req.params.farmId);
  await requireCropInFarm(prisma, farm.id, input.cropId);
  const data = await prisma.expense.create({
    data: {
      userId: user.id,
      farmId: farm.id,
      cropId: input.cropId || null,
      category: input.category,
      amount: input.amount,
      note: input.note || null,
      ...(input.date ? { date: input.date } : {})
    }
  });
  res.status(201).json({ success: true, data });
}

export async function createHarvest(req, res) {
  const input = createHarvestSchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const farm = await requireOwnedFarm(prisma, user.id, req.params.farmId);
  const crop = await requireCropInFarm(prisma, farm.id, input.cropId);
  const cropName = input.cropName || crop?.name;
  if (!cropName) throw badRequest("CROP_NAME_REQUIRED", "cropName wajib diisi jika cropId tidak dikirim.");

  const data = await prisma.harvest.create({
    data: {
      userId: user.id,
      farmId: farm.id,
      cropId: crop?.id || null,
      cropName,
      quantity: input.quantity,
      unit: input.unit,
      quality: input.quality || null,
      harvestDate: input.harvestDate || new Date()
    }
  });
  res.status(201).json({ success: true, data });
}
