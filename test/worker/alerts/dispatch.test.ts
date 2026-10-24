import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { deliverAlert, sendToChannel } from "../../../src/worker/alerts/dispatch";
import type { Env } from "../../../src/worker/env";
import { encrypt } from "../../../src/worker/lib/crypto";
import { createTestEnv } from "../../helpers/env";
import { seedChannel, seedTarget, WEBHOOK } from "../../helpers/alerts-seed";

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
  await seedTarget(env, "t1");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

describe("deliverAlert", () => {
  it("uses only enabled, linked channels that subscribe to the event", async () => {
    await seedChannel(env, "ok", "t1");
    await seedChannel(env, "off", "t1", { enabled: false });
    await seedChannel(env, "other-event", "t1", { events: ["backup_stale"] });
    await seedChannel(env, "unlinked", null);
    await seedTarget(env, "t2");
    await seedChannel(env, "other-target", "t2");
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends to LINE and Discord channels in the same call", async () => {
    await seedChannel(env, "d", "t1");
    await seedChannel(env, "l", "t1", { type: "line" });
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy.mock.calls.map((c: Parameters<typeof fetch>) => String(c[0])).sort()).toEqual(["https://api.line.me/v2/bot/message/push", WEBHOOK]);
  });

  it("skips a channel whose events JSON is malformed", async () => {
    await seedChannel(env, "bad", "t1");
    await env.DB.prepare("UPDATE alert_channels SET events = 'not json' WHERE id = 'bad'").run();
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("one failing channel does not stop the others, and the log has no credential", async () => {
    await seedChannel(env, "d", "t1");
    await seedChannel(env, "l", "t1", { type: "line", credential: { token: "line-token-xyz", to: "U1234567890" } });
    fetchSpy.mockImplementation(async (url) => (String(url).includes("line.me") ? new Response("{}", { status: 401 }) : new Response(null, { status: 204 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("alert delivery failed");
    expect(logged).toContain("LINE API returned HTTP 401");
    expect(logged).not.toContain("line-token-xyz");
  });
});

describe("sendToChannel", () => {
  it("reports an undecryptable or invalid stored credential without sending", async () => {
    const garbage = await sendToChannel(env, { type: "line", credentialEnc: "v1:AAAA:BBBB" }, "hi");
    expect(garbage).toEqual({ ok: false, error: "stored credential could not be decrypted" });
    const wrongShape = await encrypt(JSON.stringify({ webhookUrl: "https://evil.example.com/x" }), env.ENCRYPTION_KEY);
    const invalid = await sendToChannel(env, { type: "discord", credentialEnc: wrongShape }, "hi");
    expect(invalid).toEqual({ ok: false, error: "stored credential is invalid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
