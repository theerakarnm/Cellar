import type { Env } from "../../src/worker/env";
import { app } from "../../src/worker/app";

export const SECRETS = ["s3cret-pw", "restore-pw", "token-id-123", "token-secret-456"] as const;

export function api(env: Env, hono: Pick<typeof app, "request"> = app) {
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await hono.request(
      `http://localhost${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) },
      env,
    );
    const text = await response.text();
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as any };
  };
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown) => call("POST", path, body),
    patch: (path: string, body?: unknown) => call("PATCH", path, body),
    delete: (path: string) => call("DELETE", path),
  };
}

/** A valid POST /api/targets body for a tunnel target. Every secret is one of SECRETS. */
export function tunnelBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Shop DB",
    projectTag: "shop",
    connectionUrl: "postgres://backup:s3cret-pw@db.example.com:5432/shop",
    restoreUrl: "postgres://restore:restore-pw@db.example.com:5432/shop",
    tunnel: { hostname: "db.example.com", tokenId: "token-id-123", tokenSecret: "token-secret-456" },
    ...overrides,
  };
}
