-- Identidad del local en la carta: logo, direccion e Instagram
ALTER TABLE "Venue" ADD COLUMN     "address" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "logoUrl" TEXT;
