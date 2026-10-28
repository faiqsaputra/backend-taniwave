-- Baseline: original core TANIWAVE schema before the dashboard foundation.
-- On a brand-new database this creates the original models. On an existing database
-- created with `prisma db push`, mark this migration as applied instead of running it.

CREATE TYPE "UserRole" AS ENUM ('FARMER', 'BUYER', 'ADMIN');
CREATE TYPE "CropStatus" AS ENUM ('PLANNED', 'PLANTED', 'GROWING', 'HARVESTED');
CREATE TYPE "QualityGrade" AS ENUM ('A', 'B', 'C');
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'CLOSED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'FARMER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Farm" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "location" TEXT,
  "area" DOUBLE PRECISION,
  "unit" TEXT DEFAULT 'm2',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Crop" (
  "id" TEXT NOT NULL,
  "farmId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "variety" TEXT,
  "plantedAt" TIMESTAMP(3),
  "expectedHarvest" TIMESTAMP(3),
  "status" "CropStatus" NOT NULL DEFAULT 'PLANTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Crop_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Crop" ADD CONSTRAINT "Crop_farmId_fkey"
  FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Harvest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "cropName" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "quality" "QualityGrade",
  "harvestDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Harvest_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Harvest" ADD CONSTRAINT "Harvest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Diagnosis" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "crop" TEXT NOT NULL,
  "imageUrl" TEXT,
  "result" TEXT,
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Diagnosis" ADD CONSTRAINT "Diagnosis_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketplaceListing" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "commodity" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "price" DOUBLE PRECISION,
  "location" TEXT,
  "description" TEXT,
  "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
