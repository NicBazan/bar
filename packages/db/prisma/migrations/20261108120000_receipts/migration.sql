-- Comprobante de consumo: número correlativo por local y copia fija al cerrar la mesa
-- AlterTable
ALTER TABLE "TableSession" ADD COLUMN     "receipt" JSONB,
ADD COLUMN     "receiptNumber" INTEGER;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "receiptSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "TableSession_venueId_receiptNumber_key" ON "TableSession"("venueId", "receiptNumber");

