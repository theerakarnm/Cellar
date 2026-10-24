import { Hono } from "hono";
import { createTargetSchema, updateTargetSchema } from "../../shared/target-schema";
import { paginationQuery } from "../lib/pagination";
import { parseBody, parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, deleteTarget, getTarget, listTargets, updateTarget } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.get("/", async (c) => c.json(await listTargets(c.env, parseQuery(c, paginationQuery))));

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

targetRoutes.patch("/:id", async (c) => {
  const input = await parseBody(c, updateTargetSchema);
  return c.json(await updateTarget(c.env, c.req.param("id"), input, actorOf(c)));
});

targetRoutes.delete("/:id", async (c) => {
  await deleteTarget(c.env, c.req.param("id"), actorOf(c));
  return c.body(null, 204);
});

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
