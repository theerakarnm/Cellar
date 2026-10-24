import { Hono } from "hono";
import { createTargetSchema } from "../../shared/target-schema";
import { paginationQuery } from "../lib/pagination";
import { parseBody, parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, getTarget, listTargets } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.get("/", async (c) => c.json(await listTargets(c.env, parseQuery(c, paginationQuery))));

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
