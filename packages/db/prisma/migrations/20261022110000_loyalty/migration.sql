-- CreateEnum
CREATE TYPE "LoyaltyMode" AS ENUM ('STAMPS', 'POINTS');

-- CreateEnum
CREATE TYPE "LoyaltyEventKind" AS ENUM ('EARN', 'REDEEM');

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "mode" "LoyaltyMode" NOT NULL DEFAULT 'STAMPS',
    "centsPerPoint" INTEGER NOT NULL DEFAULT 100000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyReward" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "programId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "kind" "LoyaltyEventKind" NOT NULL,
    "mode" "LoyaltyMode" NOT NULL,
    "amount" INTEGER NOT NULL,
    "sessionId" UUID,
    "rewardId" UUID,
    "rewardName" TEXT,
    "staffId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_tenantId_key" ON "LoyaltyProgram"("tenantId");

-- CreateIndex
CREATE INDEX "LoyaltyEvent_customerId_createdAt_idx" ON "LoyaltyEvent"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyEvent_customerId_sessionId_kind_key" ON "LoyaltyEvent"("customerId", "sessionId", "kind");

-- AddForeignKey
ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEvent" ADD CONSTRAINT "LoyaltyEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEvent" ADD CONSTRAINT "LoyaltyEvent_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "LoyaltyReward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

