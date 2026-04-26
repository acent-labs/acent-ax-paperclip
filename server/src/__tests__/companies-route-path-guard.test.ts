import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { companyRoutes } from "../routes/companies.js";
import { errorHandler } from "../middleware/error-handler.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  companyService: () => mockCompanyService,
  companyPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewExport: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  accessService: () => ({
    canUser: vi.fn(),
    ensureMembership: vi.fn(),
  }),
  budgetService: () => ({
    upsertPolicy: vi.fn(),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  feedbackService: () => ({
    listIssueVotesForUser: vi.fn(),
    listFeedbackTraces: vi.fn(),
    getFeedbackTraceById: vi.fn(),
    saveIssueVote: vi.fn(),
  }),
  logActivity: vi.fn(),
}));

function createApp(input?: {
  actor?: Express.Request["actor"];
  tenantContext?: Express.Request["tenantContext"];
}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = input?.actor ?? {
      type: "board",
      userId: "user-1",
      source: "session",
      companyIds: ["company-1", "company-2"],
      memberships: [
        { companyId: "company-1", tenantId: "tenant-1", membershipRole: "operator", status: "active" },
        { companyId: "company-2", tenantId: "tenant-2", membershipRole: "operator", status: "active" },
      ],
    };
    if (input?.tenantContext) {
      (req as any).tenantContext = input.tenantContext;
    }
    next();
  });
  app.use("/api/companies", companyRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("company routes malformed issue path guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a clear error when companyId is missing for issues list path", async () => {
    const app = createApp({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      },
    });

    const res = await request(app).get("/api/companies/issues");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });

  it("filters company list by the resolved request tenant", async () => {
    mockCompanyService.list.mockResolvedValue([
      { id: "company-1", tenantId: "tenant-1", name: "Acme" },
      { id: "company-2", tenantId: "tenant-2", name: "Beta" },
    ]);

    const res = await request(createApp({
      tenantContext: {
        enforced: true,
        host: "acme.ax.acent.com",
        tenantId: "tenant-1",
        slug: "acme",
        status: "resolved",
      },
    })).get("/api/companies");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "company-1", tenantId: "tenant-1", name: "Acme" }]);
  });

  it("rejects company list requests for unresolved tenant hosts", async () => {
    const res = await request(createApp({
      tenantContext: {
        enforced: true,
        host: "unknown.ax.acent.com",
        tenantId: null,
        slug: null,
        status: "unresolved",
      },
    })).get("/api/companies");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Request host is not mapped to an active tenant" });
  });
});
