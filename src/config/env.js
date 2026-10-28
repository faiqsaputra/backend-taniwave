import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(5000),

  FRONTEND_URL: z
    .string()
    .default("http://localhost:5173"),

  AI_SERVICE_URL: z
    .string()
    .url()
    .optional(),

  ADMIN_API_KEY: z
    .string()
    .min(1)
    .optional(),

  // Gemini
  GEMINI_API_KEY: z
    .string()
    .min(1)
    .optional(),

  GEMINI_MODEL: z
    .string()
    .default("gemini-3.8-flash"),

  GEMINI_EMBEDDING_MODEL: z
    .string()
    .default("gemini-embedding-2"),

  // OpenWeather
  OPENWEATHER_API_KEY: z
    .string()
    .min(1)
    .optional(),

  WEATHER_TIMEOUT_MS: z
    .coerce
    .number()
    .int()
    .min(1000)
    .max(20000)
    .default(5000),

  // RAG
  ENABLE_GOOGLE_SEARCH_GROUNDING: z
    .coerce
    .boolean()
    .default(false),

  CHROMA_PATH: z
    .string()
    .default("./python-ai/data/chroma"),

  RAG_TOP_K: z
    .coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .default(5),

  RAG_MIN_SCORE: z
    .coerce
    .number()
    .min(0)
    .max(1)
    .default(0.2),

  // Supabase
  SUPABASE_URL: z
    .string()
    .url()
    .optional(),

  SUPABASE_ANON_KEY: z
    .string()
    .min(1)
    .optional(),

  // Prisma
  DATABASE_URL: z
    .string()
    .min(1)
    .optional(),

  DIRECT_URL: z
    .string()
    .min(1)
    .optional(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );

  throw new Error(
    `Invalid environment configuration:\n- ${issues.join("\n- ")}`
  );
}

export const env = result.data;

export const allowedOrigins = env.FRONTEND_URL
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);