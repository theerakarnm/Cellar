import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { app } from "../../../src/worker/app";
import type { Env } from "../../../src/worker/env";
import { decrypt } from "../../../src/worker/lib/crypto";
import { seedChannel, seedTarget, WEBHOOK } from "../../helpers/alerts-seed";
import { createTestEnv, resetDb } from "../../helpers/env";

const LINE_TOKEN = "line-token-REALLOOKING-0123456789abcdef";
const SECRETS = [LINE_TOKEN, "U1234567890abcdef", "abcDEF_ghi-JKL"];

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(async () => {
  await resetDb(env);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const call = (method: string, path: string, body?: unknown) =>
  app.request(
    `http://localhost${path}`,
    { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );

const lineBody = { type: "line", name: "Ops LINE", credential: { token: LINE_TOKEN, to: "U1234567890abcdef" } };
const discordBody = { type: "discord", name: "Ops Discord", credential: { webhookUrl: WEBHOOK } };

describe("POST /api/alert-channels", () => {
  it("creates a channel, masks the credential, stores it encrypted, and audits it", async () => {
    const res = await call("POST", "/api/alert-channels", lineBody);
    expect(res.status).toBe(201);
    const text = await res.text();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    const json = JSON.parse(text);
    expect(json).toMatchObject({ type: "line", name: "Ops LINE", enabled: true, hasCredential: true });
    expect(json.events).toEqual(["backup_failed", "backup_stale", "backup_consecutive_failures"]);

    const stored = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(json.id).first<{ credential_enc: string }>();
    expect(stored?.credential_enc.startsWith("v1:")).toBe(true);
    for (const secret of SECRETS) expect(stored?.credential_enc).not.toContain(secret);

    const audit = await env.DB.prepare("SELECT actor, action, details FROM audit_logs WHERE entity_id = ?").bind(json.id).first<{ actor: string; action: string; details: string }>();
    expect(audit?.action).toBe("alert_channel.create");
    expect(audit?.actor).toBe("dev@localhost");
    for (const secret of SECRETS) expect(audit?.details).not.toContain(secret);
  });

  it("rejects a bad Discord host, a non-prefix Discord path, a mismatched credential, and unknown events with 400", async () => {
    for (const body of [
      { ...discordBody, credential: { webhookUrl: "https://evil.example.com/api/webhooks/1/tok" } },
      { ...discordBody, credential: { webhookUrl: "https://discord.com/api/v10/webhooks/1/tok" } },
      { ...discordBody, credential: { webhookUrl: "https://discord.com:8443/api/webhooks/1/tok" } },
      { ...lineBody, credential: { webhookUrl: WEBHOOK } },
      { ...lineBody, events: ["nope"] },
    ]) {
      const res = await call("POST", "/api/alert-channels", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
    }
  });
});

describe("GET /api/alert-channels", () => {
  it("lists with pagination and never returns credentials", async () => {
    for (const name of ["a", "b", "c"]) await call("POST", "/api/alert-channels", { ...discordBody, name });
    const first = await call("GET", "/api/alert-channels?limit=2");
    const firstText = await first.text();
    expect(firstText).not.toContain("abcDEF");
    const page1 = JSON.parse(firstText) as { items: { name: string }[]; nextCursor: string | null };
    expect(page1.items.map((i) => i.name)).toEqual(["a", "b"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await (await call("GET", `/api/alert-channels?limit=2&cursor=${page1.nextCursor}`)).json()) as { items: { name: string }[]; nextCursor: string | null };
    expect(page2.items.map((i) => i.name)).toEqual(["c"]);
    expect(page2.nextCursor).toBeNull();
  });
});

describe("PATCH /api/alert-channels/:id", () => {
  it("updates fields, keeps the credential when omitted, and replaces it when sent", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const before = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();

    const res = await call("PATCH", `/api/alert-channels/${created.id}`, { enabled: false, events: ["backup_failed"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, events: ["backup_failed"] });
    const same = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();
    expect(same?.credential_enc).toBe(before?.credential_enc);

    const newUrl = "https://discord.com/api/webhooks/987654321098765432/NEWtoken_123";
    await call("PATCH", `/api/alert-channels/${created.id}`, { credential: { webhookUrl: newUrl } });
    const after = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();
    expect(after?.credential_enc).not.toBe(before?.credential_enc);
  });

  it("stores a Discord credential as the normalized href", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const res = await call("PATCH", `/api/alert-channels/${created.id}`, { credential: { webhookUrl: "HTTPS://DISCORD.COM\\api\\webhooks\\123456789012345678\\abcDEF_ghi-JKL" } });
    expect(res.status).toBe(200);
    const stored = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();
    const credential = JSON.parse(await decrypt(stored?.credential_enc ?? "", env.ENCRYPTION_KEY)) as { webhookUrl: string };
    expect(credential.webhookUrl).toBe(WEBHOOK);
  });

  it("rejects a credential of the wrong shape for the stored type and an unknown id", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const bad = await call("PATCH", `/api/alert-channels/${created.id}`, { credential: { token: "t", to: "U" } });
    expect(bad.status).toBe(400);
    expect((await call("PATCH", "/api/alert-channels/missing", { enabled: true })).status).toBe(404);
  });
});

describe("DELETE /api/alert-channels/:id", () => {
  it("removes the channel and its target links", async () => {
    await seedTarget(env, "t1");
    await seedChannel(env, "c1", "t1");
    expect((await call("DELETE", "/api/alert-channels/c1")).status).toBe(204);
    const channels = await env.DB.prepare("SELECT count(*) AS n FROM alert_channels").first<{ n: number }>();
    const links = await env.DB.prepare("SELECT count(*) AS n FROM target_alert_channels").first<{ n: number }>();
    expect([channels?.n, links?.n]).toEqual([0, 0]);
    expect((await call("DELETE", "/api/alert-channels/c1")).status).toBe(404);
  });
});

describe("POST /api/alert-channels/:id/test", () => {
  it("sends a test message and reports ok", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const res = await call("POST", `/api/alert-channels/${created.id}/test`);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string).content).toContain("[Cellar] Test message");
  });

  it("reports a failed delivery without leaking the credential", async () => {
    const created = (await (await call("POST", "/api/alert-channels", lineBody)).json()) as { id: string };
    fetchSpy.mockImplementation(async () => new Response("{}", { status: 401 }));
    const res = await call("POST", `/api/alert-channels/${created.id}/test`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "LINE API returned HTTP 401" });
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("returns 404 for an unknown channel", async () => {
    expect((await call("POST", "/api/alert-channels/missing/test")).status).toBe(404);
  });
});
