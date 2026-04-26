export {};

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "board" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        companyId?: string;
        companyIds?: string[];
        memberships?: Array<{
          companyId: string;
          tenantId?: string | null;
          membershipRole?: string | null;
          status?: string;
        }>;
        tenantId?: string | null;
        isInstanceAdmin?: boolean;
        keyId?: string;
        runId?: string;
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "none";
      };
      tenantContext?: {
        enforced: boolean;
        host: string;
        tenantId: string | null;
        slug: string | null;
        status: "resolved" | "unresolved";
      };
    }
  }
}
