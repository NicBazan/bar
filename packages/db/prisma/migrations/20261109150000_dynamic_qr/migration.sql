-- QR dinámico: conteo de escaneos
-- AlterTable
ALTER TABLE "TableTag" ADD COLUMN     "lastScanAt" TIMESTAMP(3),
ADD COLUMN     "scanCount" INTEGER NOT NULL DEFAULT 0;

