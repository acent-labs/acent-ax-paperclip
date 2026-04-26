import * as p from "@clack/prompts";
import pc from "picocolors";
import { and, eq, sql } from "drizzle-orm";
import {
  authUsers,
  companies,
  companyMemberships,
  createDb,
  environments,
  tenantDomains,
  tenantMemberships,
  tenants,
} from "@paperclipai/db";
import { loadPaperclipEnvFile } from "../config/env.js";
import { readConfig, resolveConfigPath } from "../config/store.js";
import { printPaperclipCliBanner } from "../utils/banner.js";

type TenantProvisionOptions = {
  config?: string;
  dbUrl?: string;
  slug: string;
  name?: string;
  domain: string;
  plan?: string;
  companyId?: string;
  companyName?: string;
  ownerUserId?: string;
  ownerEmail?: string;
  json?: boolean;
};

type ClosableDb = ReturnType<typeof createDb> & {
  $client?: {
    end?: (options?: { timeout?: number }) => Promise<void>;
  };
};

const ISSUE_PREFIX_FALLBACK = "CMP";

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error("Invalid tenant slug. Use 1-63 lowercase letters, numbers, and hyphens.");
  }
  return slug;
}

function normalizeDomain(value: string): string {
  const raw = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+$/.test(raw) || raw.includes("..") || raw.startsWith(".") || raw.endsWith(".")) {
    throw new Error("Invalid tenant domain. Use a hostname such as acme.ax.acent.com.");
  }
  return raw;
}

function resolveDbUrl(configPath?: string, explicitDbUrl?: string): string | null {
  if (nonEmpty(explicitDbUrl)) return nonEmpty(explicitDbUrl);
  const config = readConfig(configPath);
  if (nonEmpty(process.env.DATABASE_URL)) return nonEmpty(process.env.DATABASE_URL);
  if (config?.database.mode === "postgres" && nonEmpty(config.database.connectionString)) {
    return nonEmpty(config.database.connectionString);
  }
  if (config?.database.mode === "embedded-postgres") {
    const port = config.database.embeddedPostgresPort ?? 54329;
    return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  }
  return null;
}

function deriveIssuePrefixBase(name: string): string {
  const normalized = name.toUpperCase().replace(/[^A-Z]/g, "");
  return normalized.slice(0, 3) || ISSUE_PREFIX_FALLBACK;
}

function suffixForAttempt(attempt: number): string {
  if (attempt <= 1) return "";
  return "A".repeat(attempt - 1);
}

async function allocateIssuePrefix(
  db: Pick<ReturnType<typeof createDb>, "select">,
  companyName: string,
): Promise<string> {
  const base = deriveIssuePrefixBase(companyName);
  const rows = await db.select({ issuePrefix: companies.issuePrefix }).from(companies);
  const existing = new Set(rows.map((row) => row.issuePrefix));
  for (let attempt = 1; attempt < 10000; attempt += 1) {
    const candidate = `${base}${suffixForAttempt(attempt)}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate unique issue prefix");
}

async function resolveOwnerUserId(
  db: ReturnType<typeof createDb>,
  ownerUserId: string | null,
  ownerEmail: string | null,
): Promise<string | null> {
  if (ownerUserId) return ownerUserId;
  if (!ownerEmail) return null;
  const row = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(sql`lower(${authUsers.email}) = lower(${ownerEmail})`)
    .then((rows) => rows[0] ?? null);
  if (!row) {
    throw new Error(`No auth user found for owner email '${ownerEmail}'. Use --owner-user-id after signup.`);
  }
  return row.id;
}

export async function tenantProvisionCommand(opts: TenantProvisionOptions): Promise<void> {
  const configPath = resolveConfigPath(opts.config);
  loadPaperclipEnvFile(configPath);

  const slug = normalizeSlug(opts.slug);
  const requestedDisplayName = nonEmpty(opts.name);
  const displayName = requestedDisplayName ?? slug;
  const domain = normalizeDomain(opts.domain);
  const companyName = nonEmpty(opts.companyName) ?? displayName;
  const plan = nonEmpty(opts.plan);
  const ownerUserIdInput = nonEmpty(opts.ownerUserId);
  const ownerEmail = nonEmpty(opts.ownerEmail);
  const companyIdInput = nonEmpty(opts.companyId);

  if (ownerUserIdInput && ownerEmail) {
    throw new Error("Use either --owner-user-id or --owner-email, not both.");
  }

  const dbUrl = resolveDbUrl(configPath, opts.dbUrl);
  if (!dbUrl) {
    throw new Error("Could not resolve database connection. Set DATABASE_URL or configure Postgres.");
  }

  if (!opts.json) {
    printPaperclipCliBanner();
    p.intro(pc.bgCyan(pc.black(" paperclip tenant:provision ")));
  }

  const db = createDb(dbUrl) as ClosableDb;
  try {
    const ownerUserId = await resolveOwnerUserId(db, ownerUserIdInput, ownerEmail);
    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const existingTenant = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .then((rows) => rows[0] ?? null);

      const tenant = existingTenant
        ? await tx
            .update(tenants)
            .set({
              ...(requestedDisplayName ? { displayName: requestedDisplayName } : {}),
              ...(plan ? { plan } : {}),
              status: "active",
              updatedAt: now,
            })
            .where(eq(tenants.id, existingTenant.id))
            .returning()
            .then((rows) => rows[0])
        : await tx
            .insert(tenants)
            .values({ slug, displayName, plan, status: "active", createdAt: now, updatedAt: now })
            .returning()
            .then((rows) => rows[0]);

      const existingDomain = await tx
        .select()
        .from(tenantDomains)
        .where(eq(tenantDomains.domain, domain))
        .then((rows) => rows[0] ?? null);
      if (existingDomain && existingDomain.tenantId !== tenant.id) {
        throw new Error(`Domain '${domain}' is already assigned to another tenant.`);
      }
      if (existingDomain) {
        await tx
          .update(tenantDomains)
          .set({ status: "active", updatedAt: now })
          .where(and(eq(tenantDomains.tenantId, tenant.id), eq(tenantDomains.domain, domain)));
      } else {
        await tx
          .insert(tenantDomains)
          .values({ tenantId: tenant.id, domain, status: "active", createdAt: now, updatedAt: now });
      }

      let company = null as typeof companies.$inferSelect | null;
      if (companyIdInput) {
        company = await tx
          .select()
          .from(companies)
          .where(eq(companies.id, companyIdInput))
          .then((rows) => rows[0] ?? null);
        if (!company) throw new Error(`Company '${companyIdInput}' was not found.`);
        if (company.tenantId && company.tenantId !== tenant.id) {
          throw new Error(`Company '${companyIdInput}' already belongs to another tenant.`);
        }
        company = await tx
          .update(companies)
          .set({ tenantId: tenant.id, updatedAt: now })
          .where(eq(companies.id, company.id))
          .returning()
          .then((rows) => rows[0]);
      } else {
        company = await tx
          .select()
          .from(companies)
          .where(eq(companies.tenantId, tenant.id))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        if (!company) {
          const issuePrefix = await allocateIssuePrefix(tx, companyName);
          company = await tx
            .insert(companies)
            .values({
              tenantId: tenant.id,
              name: companyName,
              description: "Primary Paperclip company for this tenant.",
              status: "active",
              issuePrefix,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .then((rows) => rows[0]);
        }
      }

      const provisionedCompany = company;
      if (!provisionedCompany) {
        throw new Error("Failed to resolve tenant company.");
      }

      await tx
        .insert(environments)
        .values({
          companyId: provisionedCompany.id,
          name: "Local",
          description: "Default execution environment for Paperclip runs on this machine.",
          driver: "local",
          status: "active",
          config: {},
          metadata: {
            managedByPaperclip: true,
            defaultForCompany: true,
          },
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [environments.companyId, environments.driver],
          where: sql`${environments.driver} = 'local'`,
        });

      if (ownerUserId) {
        await tx
          .insert(tenantMemberships)
          .values({
            tenantId: tenant.id,
            userId: ownerUserId,
            role: "owner",
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [tenantMemberships.tenantId, tenantMemberships.userId],
            set: { role: "owner", status: "active", updatedAt: now },
          });

        await tx
          .insert(companyMemberships)
          .values({
            companyId: provisionedCompany.id,
            principalType: "user",
            principalId: ownerUserId,
            membershipRole: "owner",
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              companyMemberships.companyId,
              companyMemberships.principalType,
              companyMemberships.principalId,
            ],
            set: { membershipRole: "owner", status: "active", updatedAt: now },
          });
      }

      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        domain,
        companyId: provisionedCompany.id,
        companyName: provisionedCompany.name,
        ownerUserId,
      };
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      p.log.success("Provisioned tenant runtime records.");
      p.log.message(`Tenant: ${pc.cyan(result.tenantSlug)} ${pc.dim(result.tenantId)}`);
      p.log.message(`Domain: ${pc.cyan(result.domain)}`);
      p.log.message(`Company: ${pc.cyan(result.companyName)} ${pc.dim(result.companyId)}`);
      if (result.ownerUserId) {
        p.log.message(`Owner: ${pc.cyan(result.ownerUserId)}`);
      } else {
        p.log.warning("No owner membership was created. Run again with --owner-user-id after the owner signs up.");
      }
      p.outro(pc.green("Tenant provision completed."));
    }
  } finally {
    await db.$client?.end?.({ timeout: 5 }).catch(() => undefined);
  }
}
