import { z } from "zod";
import { askAIConsultant } from "../services/assistant.service.js";

const assistantSchema = z.object({
  message: z
    .string()
    .min(1, "Pertanyaan wajib diisi.")
    .max(2000, "Pertanyaan terlalu panjang."),

  farmer: z
    .object({
      name: z.string().optional(),
      location: z.string().optional(),
      landArea: z.number().optional(),
      budget: z.number().optional(),
    })
    .optional(),

  crop: z
    .object({
      name: z.string().optional(),
      variety: z.string().optional(),
      ageDays: z.number().optional(),
      growthStage: z.string().optional(),
    })
    .optional(),

  environment: z
    .object({
      temperature: z.number().optional(),
      humidity: z.number().optional(),
      soilMoisture: z.number().optional(),
      rainLast3Days: z.boolean().optional(),
    })
    .optional(),
});

export async function chatAssistant(req, res, next) {
  try {
    const result = assistantSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Data request tidak valid.",
        errors: result.error.flatten(),
      });
    }

    const aiResponse = await askAIConsultant(result.data);

    return res.status(200).json({
      success: true,
      data: aiResponse,
    });
  } catch (error) {
    next(error);
  }
}