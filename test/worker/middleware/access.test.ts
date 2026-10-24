import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { access, type AppEnv } from "../../../src/worker/middleware/access";
import { app } from "../../../src/worker/app";
import pkg from "../../../package.json";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const KID = "kid-1";
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(
  claims: Record<string, unknown>,
  key: CryptoKeyPair = signingKey,
  header: Record<string, unknown> = { alg: "RS256", kid: KID },
): Promise<string> {
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(body));
  return `${body}.${b64url(signature)}`;
}

const validClaims = () => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  email: "ops@example.com",
  exp: Math.floor(Date.now() / 1000) + 300,
});

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as AppEnv["Bindings"];

function makeApp() {
  const test = new Hono<AppEnv>();
  test.use("/api/*", access());
  test.get("/api/me", (c) => c.json({ email: c.get("actorEmail") }));
  return test;
}

function request(test: Hono<AppEnv>, token?: string, bindings = env, url = "https://cellar.example.com/api/me") {
  return test.request(url, token ? { headers: { "Cf-Access-Jwt-Assertion": token } } : {}, bindings);
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  signingKey = (await crypto.subtle.generateKey(RS256, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKey = (await crypto.subtle.generateKey(RS256, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = { ...((await crypto.subtle.exportKey("jwk", signingKey.publicKey)) as JsonWebKey), kid: KID, alg: "RS256" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubJwks() {
  const fetchMock = vi.fn(async () => Response.json({ keys: [publicJwk] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("access middleware", () => {
  it("rejects a missing header", async () => {
    stubJwks();
    expect((await request(makeApp())).status).toBe(401);
  });

  it("rejects a malformed token", async () => {
    stubJwks();
    expect((await request(makeApp(), "not-a-jwt")).status).toBe(401);
  });

  it("rejects a bad signature", async () => {
    stubJwks();
    const token = await sign(validClaims(), otherKey);
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects a wrong audience", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), aud: ["someone-else"] });
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 120 });
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects a wrong issuer, a missing email, and a non-RS256 header", async () => {
    stubJwks();
    const test = makeApp();
    expect((await request(test, await sign({ ...validClaims(), iss: "https://evil.example.com" }))).status).toBe(401);
    expect((await request(test, await sign({ ...validClaims(), email: undefined }))).status).toBe(401);
    expect((await request(test, await sign(validClaims(), signingKey, { alg: "HS256", kid: KID }))).status).toBe(401);
  });

  it("rejects an unknown kid", async () => {
    stubJwks();
    const token = await sign(validClaims(), signingKey, { alg: "RS256", kid: "other-kid" });
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects everything when Access is not configured", async () => {
    stubJwks();
    const token = await sign(validClaims());
    const unconfigured = { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" } as AppEnv["Bindings"];
    expect((await request(makeApp(), token, unconfigured)).status).toBe(401);
  });

  it("accepts a valid token and exposes the email", async () => {
    stubJwks();
    const response = await request(makeApp(), await sign(validClaims()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: "ops@example.com" });
  });

  it("accepts aud given as a plain string", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), aud: AUD });
    expect((await request(makeApp(), token)).status).toBe(200);
  });

  it("caches the JWKS across requests", async () => {
    const fetchMock = stubJwks();
    const test = makeApp();
    await request(test, await sign(validClaims()));
    await request(test, await sign(validClaims()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`https://${TEAM}/cdn-cgi/access/certs`);
  });

  it("does not refetch the JWKS on every unknown kid", async () => {
    const fetchMock = stubJwks();
    const test = makeApp();
    const unknown = await sign(validClaims(), signingKey, { alg: "RS256", kid: "nope" });
    await request(test, unknown);
    await request(test, unknown);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when the JWKS endpoint fails, and does not hammer it", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const test = makeApp();
    expect((await request(test, await sign(validClaims()))).status).toBe(401);
    expect((await request(test, await sign(validClaims()))).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one JWKS fetch between concurrent cold-start requests", async () => {
    const fetchMock = stubJwks();
    const test = makeApp();
    const [a, b] = await Promise.all([
      request(test, await sign(validClaims())),
      request(test, await sign(validClaims())),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps using cached keys when a later refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const test = makeApp();
      stubJwks();
      expect((await request(test, await sign(validClaims()))).status).toBe(200);
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
      expect((await request(test, await sign(validClaims()))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a token that expired a few seconds ago (clock leeway)", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 5 });
    expect((await request(makeApp(), token)).status).toBe(200);
  });
});

describe("DEV_BYPASS", () => {
  const bypass = { ...env, DEV_BYPASS: "true" } as AppEnv["Bindings"];

  it("skips verification only when DEV_BYPASS is true and the host is local", async () => {
    stubJwks();
    const local = await request(makeApp(), undefined, bypass, "http://localhost:8787/api/me");
    expect(local.status).toBe(200);
    expect(await local.json()).toEqual({ email: "dev@localhost" });
  });

  it("is ignored on non-local hosts", async () => {
    stubJwks();
    expect((await request(makeApp(), undefined, bypass)).status).toBe(401);
  });

  it.each([undefined, "", "false", "1", "TRUE"])("is ignored when DEV_BYPASS is %j", async (value) => {
    stubJwks();
    const bindings = { ...env, DEV_BYPASS: value } as AppEnv["Bindings"];
    expect((await request(makeApp(), undefined, bindings, "http://localhost:8787/api/me")).status).toBe(401);
  });
});

describe("app", () => {
  it("serves /api/health without authentication", async () => {
    const response = await app.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: pkg.version });
  });

  it("protects every other /api route, including unknown ones", async () => {
    stubJwks();
    expect((await app.request("/api/targets", {}, env)).status).toBe(401);
    expect((await app.request("/api/does-not-exist", {}, env)).status).toBe(401);
  });
});
