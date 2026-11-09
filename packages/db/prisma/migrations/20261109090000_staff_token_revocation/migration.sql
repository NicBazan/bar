-- Revocación de sesiones del staff: tokens emitidos antes de esta fecha no valen
-- AlterTable
ALTER TABLE "StaffUser" ADD COLUMN     "tokensValidAfter" TIMESTAMP(3);

