import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshdeskProvisioningRoutes } from "../routes/freshdesk-provisioning.js";
import { errorHandler } from "../middleware/error-handler.js";

const mockCompanyService = {
  list: vi.fn(),
  create: vi.fn(),
};

const mockAgentService = {
  list: vi.fn(),
  create: vi.fn(),
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations/freshdesk", freshdeskProvisioningRoutes({} as any, {
    publicBaseUrl: "https://acent-ax-engine.fly.dev",
    companies: mockCompanyService as any,
    agents: mockAgentService as any,
  }));
  app.use(errorHandler);
  return app;
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
  });

  it("ensures a company and default Freshdesk agent with a server token", async () => {
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
    });
    expect(mockCompanyService.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "11111111-1111-4111-8111-111111111111",
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
