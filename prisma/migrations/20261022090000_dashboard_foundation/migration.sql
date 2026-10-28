-- TANIWAVE dashboard foundation. Additive/backward-compatible migration against
-- the tables described by the previous prisma/schema.prisma.

ALTER TABLE "User"
  ADD COLUMN "supabaseId" TEXT,
  ADD COLUMN "avatarUrl" TEXT,
  ALTER COLUMN "password" DROP NOT NULL;

CREATE UNIQUE INDEX "User_supabaseId_key" ON "User"("supabaseId");
CREATE INDEX "User_role_idx" ON "User"("role");

ALTER TABLE "Farm"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Farm_userId_createdAt_idx" ON "Farm"("userId", "createdAt");

ALTER TABLE "Crop"
  ADD COLUMN "budgetAmount" DECIMAL(14,2),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Crop_farmId_status_idx" ON "Crop"("farmId", "status");
CREATE INDEX "Crop_plantedAt_idx" ON "Crop"("plantedAt");

ALTER TABLE "Expense"
  ADD COLUMN "farmId" TEXT,
  ADD COLUMN "cropId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING "amount"::DECIMAL(14,2);

CREATE INDEX "Expense_userId_date_idx" ON "Expense"("userId", "date");
CREATE INDEX "Expense_farmId_date_idx" ON "Expense"("farmId", "date");
CREATE INDEX "Expense_cropId_date_idx" ON "Expense"("cropId", "date");
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_farmId_fkey"
  FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cropId_fkey"
  FOREIGN KEY ("cropId") REFERENCES "Crop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Harvest"
  ADD COLUMN "farmId" TEXT,
  ADD COLUMN "cropId" TEXT;

CREATE INDEX "Harvest_userId_harvestDate_idx" ON "Harvest"("userId", "harvestDate");
CREATE INDEX "Harvest_farmId_harvestDate_idx" ON "Harvest"("farmId", "harvestDate");
CREATE INDEX "Harvest_cropId_harvestDate_idx" ON "Harvest"("cropId", "harvestDate");
ALTER TABLE "Harvest" ADD CONSTRAINT "Harvest_farmId_fkey"
  FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Harvest" ADD CONSTRAINT "Harvest_cropId_fkey"
  FOREIGN KEY ("cropId") REFERENCES "Crop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MarketplaceListing"
  ADD COLUMN "quality" "QualityGrade",
  ALTER COLUMN "price" TYPE DECIMAL(14,2) USING "price"::DECIMAL(14,2);
CREATE INDEX "MarketplaceListing_userId_status_idx" ON "MarketplaceListing"("userId", "status");
CREATE INDEX "MarketplaceListing_commodity_status_idx" ON "MarketplaceListing"("commodity", "status");

CREATE TYPE "DemandStatus" AS ENUM ('OPEN', 'MATCHED', 'CLOSED', 'CANCELLED');
CREATE TYPE "AcademyProgressStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "PracticeStatus" AS ENUM ('STARTED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "MarketPrice" (
  "id" TEXT NOT NULL,
  "commodity" TEXT NOT NULL,
  "price" DECIMAL(14,2) NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'kg',
  "location" TEXT,
  "source" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketPrice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketPrice_commodity_observedAt_idx" ON "MarketPrice"("commodity", "observedAt");
CREATE INDEX "MarketPrice_location_observedAt_idx" ON "MarketPrice"("location", "observedAt");

CREATE TABLE "MarketDemand" (
  "id" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "commodity" TEXT NOT NULL,
  "minQuantity" DOUBLE PRECISION,
  "maxQuantity" DOUBLE PRECISION,
  "unit" TEXT NOT NULL DEFAULT 'kg',
  "quality" "QualityGrade",
  "maxPrice" DECIMAL(14,2),
  "location" TEXT,
  "needBy" TIMESTAMP(3),
  "status" "DemandStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketDemand_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketDemand_status_commodity_idx" ON "MarketDemand"("status", "commodity");
CREATE INDEX "MarketDemand_buyerId_status_idx" ON "MarketDemand"("buyerId", "status");
CREATE INDEX "MarketDemand_needBy_idx" ON "MarketDemand"("needBy");
ALTER TABLE "MarketDemand" ADD CONSTRAINT "MarketDemand_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FarmActivity" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "farmId" TEXT NOT NULL,
  "cropId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FarmActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FarmActivity_userId_observedAt_idx" ON "FarmActivity"("userId", "observedAt");
CREATE INDEX "FarmActivity_farmId_observedAt_idx" ON "FarmActivity"("farmId", "observedAt");
CREATE INDEX "FarmActivity_cropId_observedAt_idx" ON "FarmActivity"("cropId", "observedAt");
ALTER TABLE "FarmActivity" ADD CONSTRAINT "FarmActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FarmActivity" ADD CONSTRAINT "FarmActivity_farmId_fkey"
  FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FarmActivity" ADD CONSTRAINT "FarmActivity_cropId_fkey"
  FOREIGN KEY ("cropId") REFERENCES "Crop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AcademyProgress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "AcademyProgressStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "bestScore" INTEGER NOT NULL DEFAULT 0,
  "xpAwarded" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademyProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcademyProgress_userId_missionId_key" ON "AcademyProgress"("userId", "missionId");
CREATE INDEX "AcademyProgress_userId_status_idx" ON "AcademyProgress"("userId", "status");
ALTER TABLE "AcademyProgress" ADD CONSTRAINT "AcademyProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PracticeSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "practiceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" "PracticeStatus" NOT NULL DEFAULT 'STARTED',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PracticeSession_userId_status_startedAt_idx" ON "PracticeSession"("userId", "status", "startedAt");
CREATE INDEX "PracticeSession_userId_practiceId_idx" ON "PracticeSession"("userId", "practiceId");
ALTER TABLE "PracticeSession" ADD CONSTRAINT "PracticeSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Diagnosis_userId_createdAt_idx" ON "Diagnosis"("userId", "createdAt");
