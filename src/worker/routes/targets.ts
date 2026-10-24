import { Hono } from "hono";
import { createTargetSchema } from "../../shared/target-schema";
import { parseBody } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, getTarget } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
