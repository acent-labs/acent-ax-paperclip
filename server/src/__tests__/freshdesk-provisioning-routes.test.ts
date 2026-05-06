import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { createDb, invites } from "@paperclipai/db";
import { freshdeskProvisioningRoutes } from "../routes/freshdesk-provisioning.js";
import { errorHandler } from "../middleware/error-handler.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const mockCompanyService = {
  list: vi.fn(),
  create: vi.fn(),
};

const mockAgentService = {
  list: vi.fn(),
  create: vi.fn(),
};

const mockAdminInviteService = {
  ensure: vi.fn(),
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/freshdesk", freshdeskProvisioningRoutes({} as any, {
    publicBaseUrl: "https://acent-ax-engine.fly.dev",
    companies: mockCompanyService as any,
    agents: mockAgentService as any,
    adminInvites: mockAdminInviteService,
  }));
  app.use(errorHandler);
  return app;
}

function createRealApp(db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/freshdesk", freshdeskProvisioningRoutes(db, {
    publicBaseUrl: "https://acent-ax-engine.fly.dev",
  }));
  app.use(errorHandler);
  return app;
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres Freshdesk provisioning tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("freshdesk provisioning routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AX_ENGINE_PROVISIONING_TOKEN = "provision-token";
    mockCompanyService.list.mockResolvedValue([]);
    mockCompanyService.create.mockResolvedValue({
      id: "company-1",
      name: "ACENT Flow - acme.freshdesk.com",
      issuePrefix: "ACE",
    });
    mockAgentService.list.mockResolvedValue([]);
    mockAgentService.create.mockResolvedValue({
      id: "agent-1",
      name: "Freshdesk Support Agent",
    });
    mockAdminInviteService.ensure.mockResolvedValue({
      status: "created",
      inviteActive: true,
      inviteUrl: "https://acent-ax-engine.fly.dev/invite/redacted-test-token",
      expiresAt: new Date("2026-05-09T00:00:00.000Z"),
    });
  });

  it("ensures a company, default Freshdesk agent, and admin bootstrap invite with a server token", async () => {
    const res = await request(createApp())
      .post("/api/integrations/freshdesk/provision")
      .set("Authorization", "Bearer provision-token")
      .send({
        acent_tenant_id: "11111111-1111-4111-8111-111111111111",
        freshdesk_domain: "https://Acme.freshdesk.com/",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      company: {
        id: "company-1",
        name: "ACENT Flow - acme.freshdesk.com",
        issue_prefix: "ACE",
      },
      agent: {
        id: "agent-1",
        name: "Freshdesk Support Agent",
      },
      workflow_id: null,
      control_panel_url: "https://acent-ax-engine.fly.dev/ACE/dashboard",
      admin_access: {
        status: "created",
        invite_active: true,
        invite_url: "https://acent-ax-engine.fly.dev/invite/redacted-test-token",
        expires_at: "2026-05-09T00:00:00.000Z",
      },
    });
    expect(mockCompanyService.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "11111111-1111-4111-8111-111111111111",
      issuePrefix: "FD111111",
      name: "ACENT Flow - acme.freshdesk.com",
      requireBoardApprovalForNewAgents: false,
    }));
    expect(mockAgentService.create).toHaveBeenCalledWith("company-1", expect.objectContaining({
      adapterType: "http",
      metadata: {
        source: "freshdesk",
        freshdesk_domain: "acme.freshdesk.com",
        acent_tenant_id: "11111111-1111-4111-8111-111111111111",
      },
    }));
    expect(mockAdminInviteService.ensure).toHaveBeenCalledWith({
      tenantId: "11111111-1111-4111-8111-111111111111",
      domain: "acme.freshdesk.com",
      companyId: "company-1",
      companyName: "ACENT Flow - acme.freshdesk.com",
      baseUrl: "https://acent-ax-engine.fly.dev",
    });
  });

  it("rejects requests without the provisioning token", async () => {
    const res = await request(createApp())
      .post("/api/integrations/freshdesk/provision")
      .send({
        acent_tenant_id: "11111111-1111-4111-8111-111111111111",
        freshdesk_domain: "acme.freshdesk.com",
      });

    expect(res.status).toBe(403);
    expect(mockCompanyService.create).not.toHaveBeenCalled();
  });
});

describeEmbeddedPostgres("freshdesk provisioning routes with database", () => {
  it("creates and reissues a company-scoped bootstrap admin invite", async () => {
    process.env.AX_ENGINE_PROVISIONING_TOKEN = "provision-token";
    const tempDb = await startEmbeddedPostgresTestDatabase("paperclip-freshdesk-provisioning-");
    const db = createDb(tempDb.connectionString);
    const closableDb = db as typeof db & {
      $client?: {
        end?: (options?: { timeout?: number }) => Promise<void>;
      };
    };

    try {
      const app = createRealApp(db);
      const body = {
        acent_tenant_id: "22222222-2222-4222-8222-222222222222",
        freshdesk_domain: "acme.freshdesk.com",
      };
      const first = await request(app)
        .post("/api/integrations/freshdesk/provision")
        .set("Authorization", "Bearer provision-token")
        .send(body);

      expect(first.status).toBe(200);
      expect(first.body.admin_access.status).toBe("created");
      expect(first.body.admin_access.invite_active).toBe(true);
      expect(first.body.admin_access.invite_url).toMatch(/^https:\/\/acent-ax-engine\.fly\.dev\/invite\/pcp_freshdesk_bootstrap_/);

      const activeInviteCount = await db
        .select({ count: count() })
        .from(invites)
        .where(
          and(
            eq(invites.companyId, first.body.company.id),
            eq(invites.inviteType, "bootstrap_ceo"),
            isNull(invites.revokedAt),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));
      expect(activeInviteCount).toBe(1);

      const second = await request(app)
        .post("/api/integrations/freshdesk/provision")
        .set("Authorization", "Bearer provision-token")
        .send(body);

      expect(second.status).toBe(200);
      expect(second.body.company.id).toBe(first.body.company.id);
      expect(second.body.admin_access.status).toBe("reissued");
      expect(second.body.admin_access.invite_active).toBe(true);
      expect(second.body.admin_access.invite_url).toMatch(/^https:\/\/acent-ax-engine\.fly\.dev\/invite\/pcp_freshdesk_bootstrap_/);
      expect(second.body.admin_access.invite_url).not.toBe(first.body.admin_access.invite_url);

      const activeInviteCountAfterReissue = await db
        .select({ count: count() })
        .from(invites)
        .where(
          and(
            eq(invites.companyId, first.body.company.id),
            eq(invites.inviteType, "bootstrap_ceo"),
            isNull(invites.revokedAt),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));
      expect(activeInviteCountAfterReissue).toBe(1);
    } finally {
      await closableDb.$client?.end?.({ timeout: 5 }).catch(() => undefined);
      await tempDb.cleanup();
    }
  });
});
