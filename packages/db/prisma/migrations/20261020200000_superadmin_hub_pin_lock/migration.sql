-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "pinFailures" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suspendReason" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "googleReviewUrl" TEXT,
ADD COLUMN     "wifiPassword" TEXT,
ADD COLUMN     "wifiSsid" TEXT;

-- El tenant de la plataforma es único
CREATE UNIQUE INDEX "Tenant_one_platform" ON "Tenant" ("isPlatform") WHERE "isPlatform" = true;
