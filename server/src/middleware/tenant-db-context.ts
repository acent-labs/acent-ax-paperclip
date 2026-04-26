import type { RequestHandler } from "express";
import type { Db } from "@paperclipai/db";
import { runWithTenantDbContext } from "../db/request-context.js";

function waitForResponse(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      res.off("finish", onFinish);
      res.off("close", onClose);
      res.off("error", onError);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onFinish = () => settle(resolve);
    const onClose = () => settle(resolve);
    const onError = (error: Error) => settle(() => reject(error));
    res.on("finish", onFinish);
    res.on("close", onClose);
    res.on("error", onError);
    try {
      next();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function tenantDbContextMiddleware(db: Db): RequestHandler {
  return (req, res, next) => {
    const tenantId = req.tenantContext?.status === "resolved" ? req.tenantContext.tenantId : null;
    if (!tenantId) {
      next();
      return;
    }

    runWithTenantDbContext(db, { tenantId }, () => waitForResponse(req, res, next))
      .catch(next);
  };
}
