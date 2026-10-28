import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";

if (!env.GEMINI_API_KEY) {
  console.warn(
    "⚠️ GEMINI_API_KEY belum dikonfigurasi. AI Consultant tidak dapat digunakan."
  );
}

const ai = env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
    })
  : null;

export async function generateGeminiResponse(prompt) {
  if (!ai) {
    throw new Error("GEMINI_API_KEY belum dikonfigurasi.");
  }

  const response = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: prompt,
  });

  return response.text;
}