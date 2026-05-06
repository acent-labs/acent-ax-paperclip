import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { invites, tenantDomains, tenants, type Db } from "@paperclipai/db";
import { runWithTenantDbContext } from "../db/request-context.js";
import { agentService, companyService } from "../services/index.js";

const provisionFreshdeskSchema = z.object({
  acent_tenant_id: z.string().trim().uuid(),
  freshdesk_domain: z.string().trim().min(1),
  display_name: z.string().trim().min(1).optional(),
});

const FRESHDESK_BOOTSTRAP_INVITE_TTL_MS = 72 * 60 * 60 * 1000;

function normalizeDomain(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function readBearerToken(header: string | undefined) {
  const value = header?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() ?? "";
}

function requireProvisioningToken() {
  const token = process.env.AX_ENGINE_PROVISIONING_TOKEN?.trim();
  if (!token) {
    throw new Error("AX_ENGINE_PROVISIONING_TOKEN is not configured");
  }
  return token;
}

function tenantSlugForDomain(tenantId: string, domain: string) {
  const normalized = domain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `freshdesk-${normalized || "tenant"}-${tenantId.slice(0, 8)}`;
}

function issuePrefixForFreshdeskTenant(tenantId: string) {
  return `FD${tenantId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createFreshdeskBootstrapInviteToken() {
  return `pcp_freshdesk_bootstrap_${randomBytes(24).toString("hex")}`;
}

function freshdeskBootstrapInviteDefaults(input: {
  tenantId: string;
  domain: string;
  companyId: string;
  companyName: string;
}) {
  return {
    source: "freshdesk",
    acent_tenant_id: input.tenantId,
    freshdesk_domain: input.domain,
    company_id: input.companyId,
    company_name: input.companyName,
    humanRole: "owner",
    inviteMessage: "Freshdesk installer bootstrap invite for Paperclip admin access.",
  };
}

async function ensureFreshdeskTenant(db: Db, input: { tenantId: string; domain: string; displayName: string }) {
  await db
    .insert(tenants)
    .values({
      id: input.tenantId,
      slug: tenantSlugForDomain(input.tenantId, input.domain),
      displayName: input.displayName,
      metadata: {
        source: "freshdesk",
        freshdesk_domain: input.domain,
      },
    })
    .onConflictDoUpdate({
      target: tenants.id,
      set: {
        displayName: input.displayName,
        updatedAt: sql`now()`,
      },
    });

  const existingDomain = await db
    .select({ tenantId: tenantDomains.tenantId })
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, input.domain))
    .then((rows) => rows[0] ?? null);
  if (!existingDomain) {
    await db.insert(tenantDomains).values({
      tenantId: input.tenantId,
      domain: input.domain,
    });
  }
}

async function ensureFreshdeskBootstrapInvite(db: Db, input: {
  tenantId: string;
  domain: string;
  companyId: string;
  companyName: string;
  baseUrl: string;
}) {
  const now = new Date();
  const activeInvites = await db
    .select({ id: invites.id })
    .from(invites)
    .where(
      and(
        eq(invites.companyId, input.companyId),
        eq(invites.inviteType, "bootstrap_ceo"),
        isNull(invites.revokedAt),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, now),
      ),
    );

  if (activeInvites.length > 0) {
    await db
      .update(invites)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(invites.companyId, input.companyId),
          eq(invites.inviteType, "bootstrap_ceo"),
          isNull(invites.revokedAt),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, now),
        ),
      );
  }

  const token = createFreshdeskBootstrapInviteToken();
  const expiresAt = new Date(Date.now() + FRESHDESK_BOOTSTRAP_INVITE_TTL_MS);
  await db.insert(invites).values({
    companyId: input.companyId,
    inviteType: "bootstrap_ceo",
    tokenHash: hashInviteToken(token),
    allowedJoinTypes: "human",
    defaultsPayload: freshdeskBootstrapInviteDefaults(input),
    expiresAt,
    invitedByUserId: "freshdesk-provisioning",
  });

  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  return {
    status: activeInvites.length > 0 ? "reissued" as const : "created" as const,
    inviteActive: true,
    inviteUrl: baseUrl ? `${baseUrl}/invite/${token}` : `/invite/${token}`,
    expiresAt,
  };
}

export function freshdeskProvisioningRoutes(
  db: Db,
  opts?: {
    publicBaseUrl?: string;
    companies?: Pick<ReturnType<typeof companyService>, "list" | "create">;
    agents?: Pick<ReturnType<typeof agentService>, "list" | "create">;
    adminInvites?: {
      ensure: (input: {
        tenantId: string;
        domain: string;
        companyId: string;
        companyName: string;
        baseUrl: string;
      }) => Promise<{
        status: "created" | "reissued";
        inviteActive: boolean;
        inviteUrl: string | null;
        expiresAt: Date | null;
      }>;
    };
  },
) {
  const router = Router();
  const companies = opts?.companies ?? companyService(db);
  const agents = opts?.agents ?? agentService(db);

  router.post("/provision", async (req, res) => {
    let expectedToken: string;
    try {
      expectedToken = requireProvisioningToken();
    } catch {
      res.status(503).json({ error: "Freshdesk provisioning is not configured" });
      return;
    }
    if (readBearerToken(req.header("authorization")) !== expectedToken) {
      res.status(403).json({ error: "Freshdesk provisioning token is invalid" });
      return;
    }

    const input = provisionFreshdeskSchema.parse(req.body);
    const domain = normalizeDomain(input.freshdesk_domain);
    const companyName = input.display_name ?? `ACENT Flow - ${domain}`;

    const provision = async () => {
      if (!opts?.companies && !opts?.agents) {
        await ensureFreshdeskTenant(db, {
          tenantId: input.acent_tenant_id,
          domain,
          displayName: companyName,
        });
      }

      const existingCompanies = await companies.list();
      let company = existingCompanies.find((entry) => entry.name === companyName);
      if (!company) {
        company = await companies.create({
          tenantId: input.acent_tenant_id,
          issuePrefix: issuePrefixForFreshdeskTenant(input.acent_tenant_id),
          name: companyName,
          description: `Freshdesk tenant ${domain}`,
          budgetMonthlyCents: 0,
          requireBoardApprovalForNewAgents: false,
        });
      }

      const existingAgents = await agents.list(company.id, { includeTerminated: false });
      let agent = existingAgents.find((entry) => {
        const metadata = entry.metadata;
        return (
          typeof metadata === "object" &&
          metadata !== null &&
          !Array.isArray(metadata) &&
          metadata.source === "freshdesk" &&
          metadata.freshdesk_domain === domain
        );
      });
      if (!agent) {
        agent = await agents.create(company.id, {
          name: "Freshdesk Support Agent",
          role: "general",
          title: "Freshdesk Support Agent",
          icon: "bot",
          capabilities: "Assist Freshdesk agents with customer-support workflow review and execution.",
          adapterType: "http",
          adapterConfig: {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          permissions: { canCreateAgents: false },
          metadata: {
            source: "freshdesk",
            freshdesk_domain: domain,
            acent_tenant_id: input.acent_tenant_id,
          },
        });
      }

      return { company, agent };
    };

    const { company, agent } = opts?.companies || opts?.agents
      ? await provision()
      : await runWithTenantDbContext(db, { tenantId: input.acent_tenant_id }, provision);

    const baseUrl = (opts?.publicBaseUrl || process.env.PAPERCLIP_PUBLIC_URL || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, "");
    const adminInvite = opts?.adminInvites
      ? await opts.adminInvites.ensure({
          tenantId: input.acent_tenant_id,
          domain,
          companyId: company.id,
          companyName: company.name,
          baseUrl,
        })
      : await ensureFreshdeskBootstrapInvite(db, {
          tenantId: input.acent_tenant_id,
          domain,
          companyId: company.id,
          companyName: company.name,
          baseUrl,
        });
    const companyPath = company.issuePrefix ? `/${company.issuePrefix}/dashboard` : "/dashboard";
    res.status(200).json({
      company: {
        id: company.id,
        name: company.name,
        issue_prefix: company.issuePrefix,
      },
      agent: {
        id: agent.id,
        name: agent.name,
      },
      workflow_id: null,
      control_panel_url: `${baseUrl}${companyPath}`,
      admin_access: {
        status: adminInvite.status,
        invite_active: adminInvite.inviteActive,
        invite_url: adminInvite.inviteUrl,
        expires_at: adminInvite.expiresAt?.toISOString() ?? null,
      },
    });
  });

  return router;
}
