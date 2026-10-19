export { prisma, Prisma } from "@bar/db";
export type { PrismaClient } from "@bar/db";

/** Cliente dentro de una transacción interactiva */
export type Tx = Parameters<Parameters<typeof import("@bar/db").prisma.$transaction>[0]>[0];
