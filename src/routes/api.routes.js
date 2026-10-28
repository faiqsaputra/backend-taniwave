import { Router } from "express";
import dashboardRoutes from "./dashboard.routes.js";
import farmRoutes from "./farm.routes.js";
import academyRoutes from "./academy.routes.js";
import practiceRoutes from "./practice.routes.js";
import marketRoutes from "./market.routes.js";
import assistantRoutes from "./assistant.routes.js";
import pythonAiRoutes from "./python-ai.routes.js";

const router = Router();

router.use("/dashboard", dashboardRoutes);
router.use("/farms", farmRoutes);
router.use("/academy", academyRoutes);
router.use("/practice-sessions", practiceRoutes);
router.use("/market", marketRoutes);

router.use("/ai", pythonAiRoutes);
router.use("/assistant", assistantRoutes);

export default router;