import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

export type AppEnv = { Bindings: Env; Variables: { actorEmail: string } };

const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
const CLOCK_LEEWAY_SECONDS = 30;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

class AccessError extends Error {}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
  if (typeof parsed !== "object" || parsed === null) throw new AccessError("malformed token");
  return parsed as Record<string, unknown>;
}

function unauthorized(reason: string): Response {
  console.warn(`access: rejected (${reason})`);
  return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
}

/**
 * Verifies `Cf-Access-Jwt-Assertion` (RS256 signature against the team JWKS, `iss`, `aud`, `exp`, `nbf`)
 * and sets `actorEmail`. Any failure is a 401. Create one instance per app: it owns the JWKS cache.
 *
 * JWKS cache: imported keys are kept by `kid`. Refresh happens when a `kid` is unknown or the keys are
 * older than 10 minutes, at most once per minute (failed attempts count), with one shared in-flight fetch.
 * If a refresh fails, the previously cached keys keep working.
 */
export function access() {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = 0;
  let lastAttemptAt = 0;
  let inflight: Promise<void> | null = null;

  function refresh(domain: string): Promise<void> {
    inflight ??= (async () => {
      lastAttemptAt = Date.now();
      try {
        const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
        if (!response.ok) return;
        const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
        const next = new Map<string, CryptoKey>();
        for (const jwk of body.keys ?? []) {
          if (!jwk.kid) continue;
          try {
            next.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, RS256, false, ["verify"]));
          } catch {
            continue;
          }
        }
        keys = next;
        fetchedAt = Date.now();
      } catch {
        return;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function getKey(domain: string, kid: string): Promise<CryptoKey> {
    const now = Date.now();
    const needsRefresh = !keys.has(kid) || now - fetchedAt >= JWKS_TTL_MS;
    if (needsRefresh && (inflight || now - lastAttemptAt >= JWKS_MIN_REFETCH_MS)) await refresh(domain);
    const key = keys.get(kid);
    if (!key) throw new AccessError("unknown kid or jwks unavailable");
    return key;
  }

  async function verify(token: string, env: Env): Promise<string> {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new AccessError("access not configured");
    const parts = token.split(".");
    if (parts.length !== 3) throw new AccessError("malformed token");
    const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;

    const header = decodeJson(headerPart);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AccessError("unsupported header");

    const key = await getKey(env.ACCESS_TEAM_DOMAIN, header.kid);
    const valid = await crypto.subtle.verify(
      RS256,
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) throw new AccessError("bad signature");

    const claims = decodeJson(payloadPart);
    const nowSeconds = Date.now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_LEEWAY_SECONDS <= nowSeconds) {
      throw new AccessError("expired");
    }
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_LEEWAY_SECONDS > nowSeconds) {
      throw new AccessError("not yet valid");
    }
    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new AccessError("wrong issuer");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.ACCESS_AUD)) throw new AccessError("wrong audience");
    if (typeof claims.email !== "string" || claims.email === "") throw new AccessError("no email claim");
    return claims.email;
  }

  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.env.DEV_BYPASS === "true" && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      c.set("actorEmail", "dev@localhost");
      return next();
    }
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return unauthorized("missing header");
    try {
      c.set("actorEmail", await verify(token, c.env));
    } catch (error) {
      return unauthorized(error instanceof AccessError ? error.message : "verification error");
    }
    return next();
  });
}
