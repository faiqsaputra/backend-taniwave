import { z } from "zod";
import { getPrisma } from "../config/database.js";

const startSchema = z.object({
  practiceId: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(120)
}).strict();

const updateSchema = z.object({
  status: z.enum(["COMPLETED", "CANCELLED"])
}).strict();

export async function startPracticeSession(req, res) {
  const input = startSchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const existing = await prisma.practiceSession.findFirst({
    where: { userId: user.id, practiceId: input.practiceId, status: "STARTED" },
    orderBy: { startedAt: "desc" }
  });
  if (existing) return res.json({ success: true, data: existing, resumed: true });

  const data = await prisma.practiceSession.create({
    data: { userId: user.id, practiceId: input.practiceId, title: input.title, status: "STARTED" }
  });
  return res.status(201).json({ success: true, data, resumed: false });
}

export async function updatePracticeSession(req, res) {
  const input = updateSchema.parse(req.body);
  const prisma = getPrisma();
  const user = res.locals.auth.user;
  const session = await prisma.practiceSession.findFirst({ where: { id: req.params.sessionId, userId: user.id } });
  if (!session) {
    return res.status(404).json({ success: false, error: { code: "PRACTICE_SESSION_NOT_FOUND", message: "Sesi praktik tidak ditemukan." } });
  }

  const data = await prisma.practiceSession.update({
    where: { id: session.id },
    data: {
      status: input.status,
      completedAt: input.status === "COMPLETED" ? (session.completedAt || new Date()) : null
    }
  });
  return res.json({ success: true, data });
}
