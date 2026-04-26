import type { Request, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function extractHostname(req: Request): string | null {
  const forwardedHost = req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = req.header("host")?.trim();
  const raw = forwardedHost || hostHeader;
  if (!raw) return null;

  try {
    return new URL(`http://${raw}`).hostname.trim().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export function tenantResolverMiddleware(db: Db, opts: { enabled: boolean }): RequestHandler {
  if (!opts.enabled) {
    return (_req, _res, next) => next();
  }

  return async (req, _res, next) => {
    try {
      const host = extractHostname(req);
      if (!host || isLoopbackHostname(host)) {
        next();
        return;
      }

      const tenant = await db
        .execute(sql<{ tenantId: string; slug: string }>`
          select
            tenant_id as "tenantId",
            slug
          from paperclip_app.resolve_tenant_by_domain(${host})
        `)
        .then((rows) => (rows[0] as { tenantId: string; slug: string } | undefined) ?? null);

      req.tenantContext = tenant
        ? {
            enforced: true,
            host,
            tenantId: tenant.tenantId,
            slug: tenant.slug,
            status: "resolved",
          }
        : {
            enforced: true,
            host,
            tenantId: null,
            slug: null,
            status: "unresolved",
          };
      next();
    } catch (err) {
      next(err);
    }
  };
}
