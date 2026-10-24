import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDiscord } from "../../../src/worker/alerts/discord";
import { sendLine } from "../../../src/worker/alerts/line";

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL";

afterEach(() => vi.restoreAllMocks());

function mockFetch(response: Response | Error) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("sendLine", () => {
  it("posts the LINE push payload", async () => {
    const spy = mockFetch(new Response("{}", { status: 200 }));
    const result = await sendLine({ token: "line-token-xyz", to: "U1234567890" }, "hello");
    expect(result).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer line-token-xyz", "content-type": "application/json" });
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body as string)).toEqual({ to: "U1234567890", messages: [{ type: "text", text: "hello" }] });
  });

  it("caps the text at 5000 UTF-16 units", async () => {
    const spy = mockFetch(new Response("{}", { status: 200 }));
    await sendLine({ token: "t", to: "U1" }, "x".repeat(9000));
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages[0].text.length).toBe(5000);
  });

  it("treats a redirect as a failure", async () => {
    mockFetch(new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } }));
    const result = await sendLine({ token: "t", to: "U1" }, "hi");
    expect(result).toEqual({ ok: false, error: "LINE API returned HTTP 302" });
  });

  it("returns an error without the token on HTTP failure and on network failure", async () => {
    mockFetch(new Response(JSON.stringify({ message: "Authentication failed" }), { status: 401 }));
    const http = await sendLine({ token: "line-token-xyz", to: "U1" }, "hi");
    expect(http).toEqual({ ok: false, error: "LINE API returned HTTP 401" });
    vi.restoreAllMocks();
    mockFetch(new Error("connect failed to api.line.me with line-token-xyz"));
    const net = await sendLine({ token: "line-token-xyz", to: "U1" }, "hi");
    expect(net).toEqual({ ok: false, error: "LINE request failed (network error)" });
    expect(JSON.stringify(net)).not.toContain("line-token-xyz");
  });
});

describe("sendDiscord", () => {
  it("posts the webhook payload and suppresses mentions", async () => {
    const spy = mockFetch(new Response(null, { status: 204 }));
    const result = await sendDiscord({ webhookUrl: WEBHOOK }, "hello");
    expect(result).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeDefined();
    expect(JSON.parse(init.body as string)).toEqual({ content: "hello", allowed_mentions: { parse: [] } });
  });

  it("caps the content at 2000", async () => {
    const spy = mockFetch(new Response(null, { status: 204 }));
    await sendDiscord({ webhookUrl: WEBHOOK }, "x".repeat(9000));
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.content.length).toBe(2000);
  });

  it("refuses a URL outside the Discord allowlist without calling fetch", async () => {
    const spy = mockFetch(new Response(null, { status: 204 }));
    const result = await sendDiscord({ webhookUrl: "https://discord.com.evil.example.com/api/webhooks/1/tok" }, "hi");
    expect(result).toEqual({ ok: false, error: "Discord webhook URL is not allowed" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns an error without the webhook URL on HTTP failure and on network failure", async () => {
    mockFetch(new Response(JSON.stringify({ message: "Unknown Webhook" }), { status: 404 }));
    const http = await sendDiscord({ webhookUrl: WEBHOOK }, "hi");
    expect(http).toEqual({ ok: false, error: "Discord webhook returned HTTP 404" });
    vi.restoreAllMocks();
    mockFetch(new Error(`failed ${WEBHOOK}`));
    const net = await sendDiscord({ webhookUrl: WEBHOOK }, "hi");
    expect(net).toEqual({ ok: false, error: "Discord request failed (network error)" });
    expect(JSON.stringify(net)).not.toContain("abcDEF");
  });
});
