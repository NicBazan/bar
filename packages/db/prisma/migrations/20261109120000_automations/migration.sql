-- Avisos automáticos (Te extrañamos, Gracias por venir) con registro único por motivo
-- CreateEnum
CREATE TYPE "AutomationKind" AS ENUM ('WINBACK', 'THANK_YOU');

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "AutomationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "days" INTEGER NOT NULL DEFAULT 30,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationDelivery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "reasonKey" TEXT NOT NULL,
    "pushSent" INTEGER NOT NULL DEFAULT 0,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRule_tenantId_kind_key" ON "AutomationRule"("tenantId", "kind");

-- CreateIndex
CREATE INDEX "AutomationDelivery_customerId_createdAt_idx" ON "AutomationDelivery"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationDelivery_tenantId_createdAt_idx" ON "AutomationDelivery"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationDelivery_ruleId_customerId_reasonKey_key" ON "AutomationDelivery"("ruleId", "customerId", "reasonKey");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationDelivery" ADD CONSTRAINT "AutomationDelivery_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationDelivery" ADD CONSTRAINT "AutomationDelivery_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

