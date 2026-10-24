import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_ENTRYPOINT, jobShape, SAMPLE_JOBS, SIGNATURE_VECTOR } from "../contract";
import { SIGNATURE_HEADER, signCallback, TIMESTAMP_HEADER, verifyCallback } from "../hmac";
import { JobError, loadJobText, parseJob } from "../job";

describe("runner contract", () => {
  it("accepts every sample job as stdin JSON, and requires the tunnel block", async () => {
    for (const sample of Object.values(SAMPLE_JOBS)) {
      const text = JSON.stringify(sample);
      const read = await loadJobText([], { readFile: async () => "", readStdin: async () => text });
      expect(parseJob(read).type).toBe(sample.type);
      expect(jobShape(sample)).toContain("tunnel.tokenSecret");
      expect(() => parseJob(JSON.stringify({ ...sample, tunnel: undefined }))).toThrow(JobError);
    }
  });

  it("signs callbacks in the agreed format", async () => {
    const v = SIGNATURE_VECTOR;
    expect([TIMESTAMP_HEADER, SIGNATURE_HEADER]).toEqual(["X-Cellar-Timestamp", "X-Cellar-Signature"]);
    expect(await signCallback(v.jobKeyBase64, v.timestamp, v.jobId, v.rawBody)).toBe(v.signatureHex);
    const verdict = await verifyCallback({ jobKeyBase64: v.jobKeyBase64, timestamp: v.timestamp, signatureHex: v.signatureHex, jobId: v.jobId, rawBody: v.rawBody, nowSeconds: Number(v.timestamp) });
    expect(verdict).toBe("ok");
  });

  it("starts the image with bun run /app/entrypoint.ts", () => {
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
    const line = dockerfile.match(/^ENTRYPOINT (.+)$/m)?.[1];
    expect(JSON.parse(line ?? "null")).toEqual([...CONTRACT_ENTRYPOINT]);
  });
});
