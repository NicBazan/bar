import { describe, expect, it, vi } from "vitest";
import { assertTenantCanOpenSession } from "../src/modules/billing/billing.guard.js";

describe("Freemium Billing Guard", () => {
  it("creates default FREE subscription if not present", async () => {
    const mockTx: any = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "sub-1", ...data })),
        update: vi.fn(),
      },
    };

    const sub = await assertTenantCanOpenSession(mockTx, "tenant-1");
    expect(sub.plan).toBe("FREE");
    expect(sub.tableSessionLimit).toBe(50);
    expect(sub.tableSessionsThisMonth).toBe(0);
  });

  it("throws 402 if monthly limit of 50 is reached on FREE plan", async () => {
    const mockTx: any = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sub-1",
          tenantId: "tenant-1",
          plan: "FREE",
          currentPeriodEnd: new Date(Date.now() + 1000000),
          tableSessionsThisMonth: 50,
          tableSessionLimit: 50,
        }),
      },
    };

    await expect(assertTenantCanOpenSession(mockTx, "tenant-1")).rejects.toMatchObject({
      status: 402,
      code: "PLAN_LIMIT_REACHED",
    });
  });

  it("throws 402 if subscription is CANCELED", async () => {
    const mockTx: any = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sub-1",
          tenantId: "tenant-1",
          plan: "CANCELED",
          currentPeriodEnd: new Date(Date.now() + 1000000),
          tableSessionsThisMonth: 10,
          tableSessionLimit: 50,
        }),
      },
    };

    await expect(assertTenantCanOpenSession(mockTx, "tenant-1")).rejects.toMatchObject({
      status: 402,
      code: "SUBSCRIPTION_CANCELED",
    });
  });

  it("allows unlimited sessions for PRO plan", async () => {
    const mockTx: any = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sub-1",
          tenantId: "tenant-1",
          plan: "PRO",
          currentPeriodEnd: new Date(Date.now() + 1000000),
          tableSessionsThisMonth: 500,
          tableSessionLimit: 50,
        }),
      },
    };

    const sub = await assertTenantCanOpenSession(mockTx, "tenant-1");
    expect(sub.plan).toBe("PRO");
  });

  it("resets monthly counter automatically if billing period has ended", async () => {
    const expiredPeriod = new Date(Date.now() - 10000);
    const mockTx: any = {
      subscription: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sub-1",
          tenantId: "tenant-1",
          plan: "FREE",
          currentPeriodEnd: expiredPeriod,
          tableSessionsThisMonth: 50,
          tableSessionLimit: 50,
        }),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "sub-1",
            tenantId: "tenant-1",
            plan: "FREE",
            currentPeriodEnd: data.currentPeriodEnd,
            tableSessionsThisMonth: data.tableSessionsThisMonth,
            tableSessionLimit: 50,
          }),
        ),
      },
    };

    const sub = await assertTenantCanOpenSession(mockTx, "tenant-1");
    expect(sub.tableSessionsThisMonth).toBe(0);
    expect(mockTx.subscription.update).toHaveBeenCalled();
  });
});
