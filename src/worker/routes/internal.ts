import { Hono } from "hono";
import type { Env } from "../env";
import { handleCallback } from "../jobs/callback";
import { triggerRetentionAfterBackup } from "../retention/triggers";

/** Mounted at `/internal`, outside `/api/*`, so the Access middleware does not apply. HMAC is the only gate. */
export const internal = new Hono<{ Bindings: Env }>();

internal.post("/jobs/callback", async (c) => {
  const outcome = await handleCallback(
    c.env,
    await c.req.text(),
    { timestamp: c.req.header("X-Cellar-Timestamp"), signature: c.req.header("X-Cellar-Signature") },
    new Date(),
  );
  if (outcome.applied && outcome.type === "backup" && outcome.event === "succeeded") {
    c.executionCtx.waitUntil(triggerRetentionAfterBackup(c.env, outcome.targetId));
  }
  return c.json({ ok: true, applied: outcome.applied });
});

