import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { JobError } from "../job";
import { childEnv, startChild, type StartOptions } from "../process";
import { createScrubber } from "../redact";
import { startTunnel, waitForPort } from "../tunnel";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const input = (localPort: number) => ({ hostname: "db.example.com", tokenId: "tid-12345", tokenSecret: "tsecret-6789", localPort });
const scrub = createScrubber(["tid-12345", "tsecret-6789"]);

/** Runs `script` with node in place of cloudflared and records what the tunnel passed to it. */
function fakeCloudflared(script: string) {
  const calls: { command: string; args: string[]; options: StartOptions }[] = [];
  const start = (command: string, args: string[], options: StartOptions) => {
    calls.push({ command, args, options });
    return startChild(process.execPath, ["-e", script], { ...options, env: childEnv({}) });
  };
  return { calls, start };
}

describe("waitForPort", () => {
  it("resolves once the port opens", async () => {
    const port = await freePort();
    const server = createServer();
    setTimeout(() => server.listen(port, "127.0.0.1"), 250);
    await waitForPort(port, { timeoutMs: 5000, intervalMs: 50 });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects on timeout", async () => {
    await expect(waitForPort(await freePort(), { timeoutMs: 200, intervalMs: 50 })).rejects.toThrow("did not open within 200 ms");
  });

  it("stops early when failFast returns an error", async () => {
    const started = Date.now();
    await expect(waitForPort(await freePort(), { timeoutMs: 10_000, intervalMs: 50, failFast: () => new Error("tunnel died") })).rejects.toThrow("tunnel died");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("startTunnel", () => {
  it("passes the token in env only, and is ready when the local port accepts connections", async () => {
    const port = await freePort();
    const fake = fakeCloudflared(`require('net').createServer().listen(${port}, '127.0.0.1'); setInterval(() => {}, 1000)`);
    const tunnel = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 5000 });
    const call = fake.calls[0];
    expect(call?.command).toBe("cloudflared");
    expect(call?.args).toEqual(["access", "tcp", "--hostname", "db.example.com", "--url", `127.0.0.1:${port}`, "--loglevel", "info"]);
    expect(call?.args.join(" ")).not.toMatch(/tid-12345|tsecret-6789/);
    expect(call?.options.env).toMatchObject({ TUNNEL_SERVICE_TOKEN_ID: "tid-12345", TUNNEL_SERVICE_TOKEN_SECRET: "tsecret-6789" });
    await tunnel.stop();
  });

  it("fails fast with TUNNEL_FAILED and a scrubbed log when cloudflared exits", async () => {
    const port = await freePort();
    const fake = fakeCloudflared(`console.error('ERR failed to connect with tsecret-6789'); process.exitCode = 1`);
    const error = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 5000 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobError);
    expect((error as JobError).code).toBe("TUNNEL_FAILED");
    expect((error as JobError).message).toContain("cloudflared exited with code 1");
    expect((error as JobError).message).not.toContain("tsecret-6789");
  });

  it("reports AUTH_FAILED when the log shows the token was refused", async () => {
    const port = await freePort();
    const fake = fakeCloudflared(`console.error('failed to connect to origin: 403 Forbidden'); process.exitCode = 1`);
    const error = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 5000 }).catch((caught: unknown) => caught);
    expect((error as JobError).code).toBe("AUTH_FAILED");
  });

  it("times out, kills the process, and reports TUNNEL_FAILED when the port never opens", async () => {
    const port = await freePort();
    const fake = fakeCloudflared(`setInterval(() => {}, 1000)`);
    const error = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 300 }).catch((caught: unknown) => caught);
    expect((error as JobError).code).toBe("TUNNEL_FAILED");
    expect((error as JobError).message).toContain("did not open");
  });
});
