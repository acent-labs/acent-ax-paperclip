import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { agentService, companyService } from "../services/index.js";

const provisionFreshdeskSchema = z.object({
  acent_tenant_id: z.string().trim().min(1),
  freshdesk_domain: z.string().trim().min(1),
  display_name: z.string().trim().min(1).optional(),
});

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

export function freshdeskProvisioningRoutes(
  db: Db,
  opts?: {
    publicBaseUrl?: string;
    companies?: Pick<ReturnType<typeof companyService>, "list" | "create">;
    agents?: Pick<ReturnType<typeof agentService>, "list" | "create">;
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
    const existingCompanies = await companies.list();
    let company = existingCompanies.find((entry) => entry.name === companyName);
    if (!company) {
      company = await companies.create({
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

    const baseUrl = (opts?.publicBaseUrl || process.env.PAPERCLIP_PUBLIC_URL || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, "");
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
    });
  });

  return router;
}
