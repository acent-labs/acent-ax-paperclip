import { index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const tenantDomains = pgTable(
  "tenant_domains",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.domain] }),
    domainUniqueIdx: uniqueIndex("tenant_domains_domain_unique_idx").on(table.domain),
    domainStatusIdx: index("tenant_domains_domain_status_idx").on(table.domain, table.status),
  }),
);
