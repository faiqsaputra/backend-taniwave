import { Router } from "express";
import { startPracticeSession, updatePracticeSession } from "../controllers/practice-session.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);
router.post("/", startPracticeSession);
router.patch("/:sessionId", updatePracticeSession);

export default router;
