import { Router } from "express";
import { getProgress, postMissionCompletion } from "../controllers/academy.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);
router.get("/progress", getProgress);
router.post("/missions/:missionId/complete", postMissionCompletion);

export default router;
