import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

type TenantDbContext = {
  tenantId: string;
  userId?: string | null;
};

const tenantDbStorage = new AsyncLocalStorage<Db>();

export function createRequestScopedDb(baseDb: Db): Db {
  return new Proxy(baseDb as object, {
    get(target, prop, receiver) {
      const activeDb = tenantDbStorage.getStore() as unknown as Record<PropertyKey, unknown> | undefined;
      const source = activeDb ?? target;
      const value = Reflect.get(source, prop, receiver);
      return typeof value === "function" ? value.bind(source) : value;
    },
  }) as Db;
}

export async function runWithTenantDbContext<T>(
  baseDb: Db,
  context: TenantDbContext | null,
  action: () => Promise<T>,
): Promise<T> {
  if (!context?.tenantId) {
    return action();
  }

  return baseDb.transaction(async (tx) => {
    await tx.execute(sql`
      select paperclip_app.set_request_context(${context.tenantId}::uuid, ${context.userId ?? null})
    `);
    return tenantDbStorage.run(tx as unknown as Db, action);
  });
}
