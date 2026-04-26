import { describe, expect, it, vi } from "vitest";
import { createRequestScopedDb, runWithTenantDbContext } from "../db/request-context.js";

describe("tenant DB context", () => {
  it("delegates request-scoped queries to the active transaction", async () => {
    const baseSelect = vi.fn(() => "base");
    const txSelect = vi.fn(() => "tx");
    const txExecute = vi.fn();
    const tx = {
      execute: txExecute,
      select: txSelect,
    };
    const baseDb = {
      select: baseSelect,
      transaction: async (action: (tx: unknown) => Promise<unknown>) => action(tx),
    };
    const scopedDb = createRequestScopedDb(baseDb as never) as unknown as {
      select(): string;
    };

    expect(scopedDb.select()).toBe("base");

    const result = await runWithTenantDbContext(
      baseDb as never,
      { tenantId: "11111111-1111-4111-8111-111111111111" },
      async () => scopedDb.select(),
    );

    expect(result).toBe("tx");
    expect(baseSelect).toHaveBeenCalledTimes(1);
    expect(txExecute).toHaveBeenCalledTimes(1);
    expect(txSelect).toHaveBeenCalledTimes(1);
  });
});
