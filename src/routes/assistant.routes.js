import express from "express";
import { chatAssistant } from "../controllers/assistant.controller.js";

const router = express.Router();

router.post("/chat", chatAssistant);

export default router;