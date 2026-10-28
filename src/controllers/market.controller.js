import { z } from "zod";
import { getPrisma } from "../config/database.js";
import { buildMarketPrices } from "../services/market.service.js";

const listingCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  commodity: z.string().trim().min(2).max(80),
  quantity: z.coerce.number().positive().max(1_000_000_000),
  unit: z.string().trim().min(1).max(20).default("kg"),
  price: z.coerce.number().positive().nullable().optional(),
  quality: z.enum(["A", "B", "C"]).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional()
}).strict();

const listingUpdateSchema = listingCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "CLOSED"]).optional()
}).strict();

const demandCreateSchema = z.object({
  commodity: z.string().trim().min(2).max(80),
  minQuantity: z.coerce.number().positive().optional(),
  maxQuantity: z.coerce.number().positive().optional(),
  unit: z.string().trim().min(1).max(20).default("kg"),
  quality: z.enum(["A", "B", "C"]).nullable().optional(),
  maxPrice: z.coerce.number().positive().nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  needBy: z.coerce.date().nullable().optional()
}).strict();

const demandUpdateSchema = z.object({ status: z.enum(["OPEN", "MATCHED", "CLOSED", "CANCELLED"]) }).strict();

function invalid(code, message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

export async function listMarketPrices(req, res) {
  const prisma = getPrisma();
  const snapshots = await prisma.marketPrice.findMany({ orderBy: { observedAt: "desc" }, take: 200 });
  res.json({ success: true, data: buildMarketPrices(snapshots) });
}

export async function listListings(req, res) {
  const prisma = getPrisma();
  const status = req.query.status === "CLOSED" ? "CLOSED" : "ACTIVE";
  const commodity = typeof req.query.commodity === "string" ? req.query.commodity.trim() : "";
  const data = await prisma.marketplaceListing.findMany({
    where: {
      status,
      ...(commodity ? { commodity: { contains: commodity, mode: "insensitive" } } : {})
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ success: true, data });
}

export async function createListing(req, res) {
  const input = listingCreateSchema.parse(req.body);
  const user = res.locals.auth.user;
  const prisma = getPrisma();
  const data = await prisma.marketplaceListing.create({
    data: {
      ...input,
      userId: user.id,
      price: input.price ?? null,
      quality: input.quality ?? null,
      location: input.location || null,
      description: input.description || null,
      status: "ACTIVE"
    }
  });
  res.status(201).json({ success: true, data });
}

export async function updateListing(req, res) {
  const input = listingUpdateSchema.parse(req.body);
  if (!Object.keys(input).length) throw invalid("EMPTY_UPDATE", "Kirim setidaknya satu field yang ingin diubah.");
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const own = await prisma.marketplaceListing.findFirst({ where: { id: req.params.listingId, userId: user.id } });
  if (!own) return res.status(404).json({ success: false, error: { code: "LISTING_NOT_FOUND", message: "Listing tidak ditemukan." } });

  const data = await prisma.marketplaceListing.update({
    where: { id: own.id },
    data: {
      ...input,
      ...(Object.hasOwn(input, "price") ? { price: input.price ?? null } : {}),
      ...(Object.hasOwn(input, "quality") ? { quality: input.quality ?? null } : {}),
      ...(Object.hasOwn(input, "location") ? { location: input.location || null } : {}),
      ...(Object.hasOwn(input, "description") ? { description: input.description || null } : {})
    }
  });
  res.json({ success: true, data });
}

export async function listDemands(req, res) {
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const data = await prisma.marketDemand.findMany({
    where: { status: "OPEN", buyerId: { not: user.id } },
    include: { buyer: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json({ success: true, data });
}

export async function createDemand(req, res) {
  const input = demandCreateSchema.parse(req.body);
  if (input.minQuantity != null && input.maxQuantity != null && input.maxQuantity < input.minQuantity) {
    throw invalid("INVALID_QUANTITY_RANGE", "maxQuantity tidak boleh lebih kecil daripada minQuantity.");
  }
  if (input.needBy && input.needBy.getTime() < Date.now()) {
    throw invalid("INVALID_DEADLINE", "needBy tidak boleh berada di masa lalu.");
  }

  const prisma = getPrisma();
  const data = await prisma.marketDemand.create({
    data: {
      buyerId: res.locals.auth.user.id,
      commodity: input.commodity,
      minQuantity: input.minQuantity ?? null,
      maxQuantity: input.maxQuantity ?? null,
      unit: input.unit,
      quality: input.quality ?? null,
      maxPrice: input.maxPrice ?? null,
      location: input.location || null,
      needBy: input.needBy ?? null,
      status: "OPEN"
    }
  });
  res.status(201).json({ success: true, data });
}

export async function updateDemandStatus(req, res) {
  const input = demandUpdateSchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const own = await prisma.marketDemand.findFirst({ where: { id: req.params.demandId, buyerId: user.id } });
  if (!own) return res.status(404).json({ success: false, error: { code: "DEMAND_NOT_FOUND", message: "Permintaan tidak ditemukan." } });
  const data = await prisma.marketDemand.update({ where: { id: own.id }, data: { status: input.status } });
  res.json({ success: true, data });
}
