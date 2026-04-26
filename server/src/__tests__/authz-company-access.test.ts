import { describe, expect, it } from "vitest";
import { assertBoardOrgAccess, assertCompanyAccess, hasBoardOrgAccess } from "../routes/authz.js";

function makeReq(input: {
  method?: string;
  actor: Express.Request["actor"];
  tenantContext?: Express.Request["tenantContext"];
}) {
  return {
    method: input.method ?? "GET",
    actor: input.actor,
    tenantContext: input.tenantContext,
  } as Express.Request;
}

describe("assertCompanyAccess", () => {
  it("allows viewer memberships to read", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          { companyId: "company-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).not.toThrow();
  });

  it("rejects viewer memberships for writes", () => {
    const req = makeReq({
      method: "PATCH",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          { companyId: "company-1", membershipRole: "viewer", status: "active" },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("Viewer access is read-only");
  });

  it("rejects writes when membership details are present but omit the target company", () => {
    const req = makeReq({
      method: "POST",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("User does not have active company access");
  });

  it("allows legacy board actors that only provide company ids", () => {
    const req = makeReq({
      method: "POST",
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).not.toThrow();
  });

  it("rejects signed-in instance admins without explicit company access", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: true,
        companyIds: [],
        memberships: [],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("User does not have access to this company");
  });

  it("allows local trusted board access without explicit membership", () => {
    const req = makeReq({
      method: "GET",
      actor: {
        type: "board",
        userId: "local-board",
        source: "local_implicit",
        isInstanceAdmin: true,
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).not.toThrow();
  });

  it("rejects a board request when the host tenant and company membership tenant differ", () => {
    const req = makeReq({
      method: "GET",
      tenantContext: {
        enforced: true,
        host: "acme.ax.acent.com",
        tenantId: "tenant-acme",
        slug: "acme",
        status: "resolved",
      },
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          {
            companyId: "company-1",
            tenantId: "tenant-other",
            membershipRole: "operator",
            status: "active",
          },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("Company does not belong to the request tenant");
  });

  it("allows a board request when the host tenant and company membership tenant match", () => {
    const req = makeReq({
      method: "GET",
      tenantContext: {
        enforced: true,
        host: "acme.ax.acent.com",
        tenantId: "tenant-acme",
        slug: "acme",
        status: "resolved",
      },
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          {
            companyId: "company-1",
            tenantId: "tenant-acme",
            membershipRole: "operator",
            status: "active",
          },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).not.toThrow();
  });

  it("rejects unresolved tenant hosts before company access is granted", () => {
    const req = makeReq({
      method: "GET",
      tenantContext: {
        enforced: true,
        host: "unknown.ax.acent.com",
        tenantId: null,
        slug: null,
        status: "unresolved",
      },
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [
          {
            companyId: "company-1",
            tenantId: "tenant-acme",
            membershipRole: "operator",
            status: "active",
          },
        ],
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("Request host is not mapped to an active tenant");
  });

  it("rejects an agent request when its company tenant differs from the host tenant", () => {
    const req = makeReq({
      method: "GET",
      tenantContext: {
        enforced: true,
        host: "acme.ax.acent.com",
        tenantId: "tenant-acme",
        slug: "acme",
        status: "resolved",
      },
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        tenantId: "tenant-other",
        source: "agent_key",
      },
    });

    expect(() => assertCompanyAccess(req, "company-1")).toThrow("Company does not belong to the request tenant");
  });
});

describe("assertBoardOrgAccess", () => {
  it("allows signed-in board users with active company access", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        companyIds: ["company-1"],
        memberships: [{ companyId: "company-1", membershipRole: "operator", status: "active" }],
        isInstanceAdmin: false,
      },
    });

    expect(hasBoardOrgAccess(req)).toBe(true);
    expect(() => assertBoardOrgAccess(req)).not.toThrow();
  });

  it("allows instance admins without company memberships", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: "admin-1",
        source: "session",
        companyIds: [],
        memberships: [],
        isInstanceAdmin: true,
      },
    });

    expect(hasBoardOrgAccess(req)).toBe(true);
    expect(() => assertBoardOrgAccess(req)).not.toThrow();
  });

  it("rejects signed-in users without company access or instance admin rights", () => {
    const req = makeReq({
      actor: {
        type: "board",
        userId: "outsider-1",
        source: "session",
        companyIds: [],
        memberships: [],
        isInstanceAdmin: false,
      },
    });

    expect(hasBoardOrgAccess(req)).toBe(false);
    expect(() => assertBoardOrgAccess(req)).toThrow("Company membership or instance admin access required");
  });
});
