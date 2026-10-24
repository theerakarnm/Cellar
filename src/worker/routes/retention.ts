import { Hono } from "hono";
import { getDb } from "../db/client";
import { ApiError } from "../lib/api-error";
import type { AppEnv } from "../middleware/access";
import { getRetentionDryRun } from "../retention/config";
import { loadActiveTarget, planRetention } from "../retention/plan";

export const retentionRoutes = new Hono<AppEnv>();

retentionRoutes.get("/targets/:id/retention-preview", async (c) => {
  const db = getDb(c.env);
  const target = await loadActiveTarget(db, c.req.param("id"));
  if (!target) throw new ApiError(404, "not_found", "Target not found");

  const [plan, dryRun] = await Promise.all([planRetention(db, target, new Date()), getRetentionDryRun(c.env)]);
  return c.json({
    dryRun,
    keep: plan.keep,
    delete: plan.delete.map((d) => ({
      id: d.id,
      startedAt: d.startedAt,
      sizeBytes: d.sizeBytes,
      reason: "no_rule_keeps_it",
    })),
    reasons: plan.reasons,
  });
});
