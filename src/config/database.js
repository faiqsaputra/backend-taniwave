import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

let prismaInstance;

export function getPrisma() {
  if (!process.env.DATABASE_URL) {
    const error = new Error("DATABASE_URL belum dikonfigurasi. Salin .env.example ke .env dan isi kredensial PostgreSQL.");
    error.statusCode = 503;
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }

  if (!prismaInstance) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    prismaInstance = new PrismaClient({ adapter });
  }

  return prismaInstance;
}

export async function disconnectDatabase() {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = undefined;
  }
}
