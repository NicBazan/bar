import type { PrismaClient } from "./client/index.js";

/**
 * Borra un tenant y TODO lo que cuelga de él, en orden inverso a las FKs.
 * Uso: seed (recrear el bar demo) y tests (limpiar bares temporales). Nunca desde la API.
 */
export async function purgeTenant(prisma: PrismaClient, tenantId: string) {
  const t = { tenantId };
  await prisma.$transaction([
    prisma.outboxEvent.deleteMany({ where: t }),
    prisma.auditLog.deleteMany({ where: t }),
    prisma.orderItem.deleteMany({ where: t }),
    prisma.order.deleteMany({ where: t }),
    prisma.serviceCall.deleteMany({ where: t }),
    prisma.guestDevice.deleteMany({ where: t }),
    prisma.loyaltyEvent.deleteMany({ where: t }),
    prisma.loyaltyReward.deleteMany({ where: t }),
    prisma.loyaltyProgram.deleteMany({ where: t }),
    prisma.customerLoginCode.deleteMany({ where: t }),
    prisma.customer.deleteMany({ where: t }),
    prisma.tableSession.deleteMany({ where: t }),
    prisma.tableTag.deleteMany({ where: t }),
    prisma.diningTable.deleteMany({ where: t }),
    prisma.area.deleteMany({ where: t }),
    prisma.dishOverride.deleteMany({ where: t }),
    prisma.dishAsset.deleteMany({ where: t }),
    prisma.modifier.deleteMany({ where: t }),
    prisma.modifierGroup.deleteMany({ where: t }),
    prisma.dishVariant.deleteMany({ where: t }),
    prisma.dish.deleteMany({ where: t }),
    prisma.category.deleteMany({ where: t }),
    prisma.venueMenu.deleteMany({ where: t }),
    prisma.menu.deleteMany({ where: t }),
    prisma.kitchenStation.deleteMany({ where: t }),
    prisma.staffUser.deleteMany({ where: t }),
    prisma.venue.deleteMany({ where: t }),
    prisma.subscription.deleteMany({ where: t }),
    prisma.tenant.deleteMany({ where: { id: tenantId } }),
  ]);
}
