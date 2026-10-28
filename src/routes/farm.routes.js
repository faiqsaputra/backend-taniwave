import { Router } from "express";
import {
  listFarms, createFarm, updateFarm, createCrop, createExpense, createHarvest
} from "../controllers/farm.controller.js";
import { createFarmActivity } from "../controllers/farm-activity.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);
router.get("/", listFarms);
router.post("/", createFarm);
router.patch("/:farmId", updateFarm);
router.post("/:farmId/crops", createCrop);
router.post("/:farmId/expenses", createExpense);
router.post("/:farmId/harvests", createHarvest);
router.post("/:farmId/activities", createFarmActivity);

export default router;
