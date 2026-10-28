import { env } from "../config/env.js";

export async function askAIConsultant(payload) {
  if (!env.AI_SERVICE_URL) {
    throw new Error("AI_SERVICE_URL belum dikonfigurasi.");
  }

  const response = await fetch(
    `${env.AI_SERVICE_URL}/api/assistant/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `AI service error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}