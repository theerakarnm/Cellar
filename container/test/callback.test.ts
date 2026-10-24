import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CallbackClient, startHeartbeat } from "../callback";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyCallback } from "../hmac";

const jobKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

interface Received {
  body: string;
  timestamp: string;
  signature: string;
  verdict: string;
}

describe("CallbackClient", () => {
  let server: Server;
  let url: string;
  let received: Received[];
  let statuses: number[];

  beforeEach(async () => {
    received = [];
    statuses = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        const body = Buffer.concat(chunks).toString();
        const timestamp = String(req.headers[TIMESTAMP_HEADER.toLowerCase()]);
        const signature = String(req.headers[SIGNATURE_HEADER.toLowerCase()]);
        const verdict = await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex: signature, jobId: "job-1", rawBody: body, nowSeconds: Math.floor(Date.now() / 1000) });
        received.push({ body, timestamp, signature, verdict });
        res.writeHead(statuses.shift() ?? 200);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/jobs/callback`;
  });
  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const client = () => new CallbackClient({ url, jobId: "job-1", jobKeyBase64: jobKey, sleep: async () => {} });

  it("sends signed events in call order with increasing seq", async () => {
    const c = client();
    await Promise.all([c.send("started"), c.send("progress"), c.send("succeeded", { result: { sizeBytes: 5 } })]);
    const bodies = received.map((r) => JSON.parse(r.body));
    expect(bodies.map((b) => [b.event, b.seq])).toEqual([["started", 1], ["progress", 2], ["succeeded", 3]]);
    expect(bodies[2].result).toEqual({ sizeBytes: 5 });
    expect(received.every((r) => r.verdict === "ok")).toBe(true);
  });

  it("includes a redacted error object for failed events", async () => {
    await client().send("failed", { error: { code: "DUMP_FAILED", message: "pg_dump exited with code 1" } });
    expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({ event: "failed", error: { code: "DUMP_FAILED" } });
  });

  it("retries 5xx with the same body and a verifiable signature", async () => {
    statuses.push(503, 502);
    expect(await client().send("succeeded")).toBe(true);
    expect(received).toHaveLength(3);
    expect(new Set(received.map((r) => r.body)).size).toBe(1);
    expect(received.every((r) => r.verdict === "ok")).toBe(true);
  });

  it("does not retry a 4xx and reports false", async () => {
    statuses.push(401);
    expect(await client().send("started")).toBe(false);
    expect(received).toHaveLength(1);
  });

  it("gives up after the retry budget: 1 try + 4 retries for terminal events, 1 + 1 for progress", async () => {
    statuses.push(500, 500, 500, 500, 500);
    expect(await client().send("failed")).toBe(false);
    expect(received).toHaveLength(5);
    received.length = 0;
    statuses.push(500, 500, 500);
    expect(await client().send("progress")).toBe(false);
    expect(received).toHaveLength(2);
  });

  it("returns false when the Worker is unreachable", async () => {
    const dead = new CallbackClient({ url: "http://127.0.0.1:1/cb", jobId: "job-1", jobKeyBase64: jobKey, sleep: async () => {} });
    expect(await dead.send("progress")).toBe(false);
  });

  it("aborts a hung request after timeoutMs: a terminal event resolves false after 5 attempts", async () => {
    let attempts = 0;
    // Aborted requests leave half-open sockets the plain close() waits on, so track and destroy them.
    const sockets = new Set<import("node:net").Socket>();
    const hung = createServer(() => {
      attempts += 1; // headers received, never answered
    });
    hung.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => hung.listen(0, "127.0.0.1", resolve));
    const hungUrl = `http://127.0.0.1:${(hung.address() as AddressInfo).port}/cb`;
    try {
      const started = Date.now();
      const c = new CallbackClient({ url: hungUrl, jobId: "job-1", jobKeyBase64: jobKey, timeoutMs: 50, sleep: async () => {} });
      expect(await c.send("failed")).toBe(false);
      expect(attempts).toBe(5);
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      hung.close();
      for (const socket of sockets) socket.destroy();
    }
  });

  it("heartbeat sends progress events until stopped", async () => {
    const c = client();
    const stop = startHeartbeat(c, 20);
    await new Promise((resolve) => setTimeout(resolve, 130));
    stop();
    await c.send("succeeded");
    const events = received.map((r) => JSON.parse(r.body).event);
    expect(events.filter((e) => e === "progress").length).toBeGreaterThanOrEqual(3);
    expect(events.at(-1)).toBe("succeeded");
    const after = received.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(received.length).toBe(after);
  });

  it("heartbeat skips a tick while the previous progress call is still pending", async () => {
    let calls = 0;
    const hangFetch = Object.assign(
      async (): Promise<Response> => {
        calls += 1;
        return new Promise<Response>(() => {});
      },
      { preconnect: () => {} },
    );
    const c = new CallbackClient({
      url: "http://callback.invalid/cb",
      jobId: "job-1",
      jobKeyBase64: jobKey,
      fetchFn: hangFetch,
      timeoutMs: 50,
      sleep: async () => {},
    });
    const stop = startHeartbeat(c, 20);
    await new Promise((resolve) => setTimeout(resolve, 150));
    stop();
    expect(calls).toBe(1);
  });
});
