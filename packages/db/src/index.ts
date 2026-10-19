import { PrismaClient } from "./client/index.js";

export * from "./client/index.js";

// Una sola instancia por proceso (evita agotar conexiones con hot reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
