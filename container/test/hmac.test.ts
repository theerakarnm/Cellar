import { describe, expect, it } from "vitest";
import { MAX_SKEW_SECONDS, signCallback, verifyCallback } from "../hmac";

const jobKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
const body = JSON.stringify({ jobId: "job-1", event: "started", seq: 1 });
const now = 1_800_000_000;

async function signed(timestamp = String(now)) {
  return { timestamp, signatureHex: await signCallback(jobKey, timestamp, "job-1", body) };
}

describe("callback hmac", () => {
  it("produces a stable 64-char hex signature", async () => {
    const first = await signCallback(jobKey, String(now), "job-1", body);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await signCallback(jobKey, String(now), "job-1", body)).toBe(first);
  });

  it("matches an independent HMAC-SHA256 computation", async () => {
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", Buffer.from(jobKey, "base64")).update(`${now}.job-1.${body}`).digest("hex");
    expect(await signCallback(jobKey, String(now), "job-1", body)).toBe(expected);
  });

  it("accepts a valid signature", async () => {
    const { timestamp, signatureHex } = await signed();
    expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("ok");
  });

  it("rejects a changed body, job id, timestamp, or key", async () => {
    const { timestamp, signatureHex } = await signed();
    const base = { jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now };
    expect(await verifyCallback({ ...base, rawBody: body.replace("started", "succeeded") })).toBe("bad_signature");
    expect(await verifyCallback({ ...base, jobId: "job-2" })).toBe("bad_signature");
    expect(await verifyCallback({ ...base, timestamp: String(now + 1) })).toBe("bad_signature");
    expect(await verifyCallback({ ...base, jobKeyBase64: otherKey })).toBe("bad_signature");
  });

  it("rejects malformed signatures", async () => {
    const { timestamp } = await signed();
    for (const signatureHex of ["", "zz", "abc", "00".repeat(32)]) {
      expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("bad_signature");
    }
  });

  it("enforces the 5 minute window on both sides, boundary included", async () => {
    for (const offset of [-MAX_SKEW_SECONDS, MAX_SKEW_SECONDS]) {
      const { timestamp, signatureHex } = await signed(String(now + offset));
      expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("ok");
    }
    for (const offset of [-MAX_SKEW_SECONDS - 1, MAX_SKEW_SECONDS + 1]) {
      const { timestamp, signatureHex } = await signed(String(now + offset));
      expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("bad_timestamp");
    }
  });

  it("rejects non-numeric timestamps", async () => {
    for (const timestamp of ["", "abc", "1.5", "-1", "1e9"]) {
      expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex: "00", jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("bad_timestamp");
    }
  });
});
