import { Hono } from "hono";
import { getDb } from "../db/client";
import { writeAudit } from "../lib/audit";
import { getSettings, settingsInputSchema, updateSettings } from "../lib/settings";
import { parseBody } from "../lib/validate";
import type { AppEnv } from "../middleware/access";

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.get("/", async (c) => c.json(await getSettings(getDb(c.env))));

settingsRoutes.put("/", async (c) => {
  const db = getDb(c.env);
  const patch = await parseBody(c, settingsInputSchema);
  const updated = await updateSettings(db, patch, new Date());
  await writeAudit(db, { actor: c.get("actorEmail"), action: "settings.update", entityType: "settings", details: patch });
  return c.json(updated);
});
