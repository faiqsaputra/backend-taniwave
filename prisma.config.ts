import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  // Use a direct Postgres URL for migrations when provided; the application
  // may use a pooled DATABASE_URL at runtime.
  datasource: {
    url: process.env.DIRECT_URL || env("DATABASE_URL")
  }
});
