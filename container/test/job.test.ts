import { describe, expect, it } from "vitest";
import { JobError, loadJobText, parseJob } from "../job";

const base = {
  jobId: "job-1",
  type: "test",
  callbackUrl: "http://127.0.0.1:18080/internal/jobs/callback",
  jobKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=",
  deadlineAt: "2026-10-24T04:00:00.000Z",
  db: { url: "postgres://app:s3cretpw@db:5432/shop", name: "shop" },
  tunnel: { hostname: "db.example.com", tokenId: "id-1234", tokenSecret: "tok-secret", localPort: 15432 },
};
const r2 = { endpoint: "http://s3:9000", bucket: "cellar", accessKeyId: "AKIA1234", secretAccessKey: "sup3rsecret" };
const { tunnel } = base;

function expectInvalid(input: unknown, field: string, secret?: string) {
  try {
    parseJob(typeof input === "string" ? input : JSON.stringify(input));
    throw new Error("expected parseJob to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(JobError);
    expect((error as JobError).code).toBe("INVALID_JOB");
    expect((error as JobError).message).toContain(field);
    if (secret) expect((error as JobError).message).not.toContain(secret);
  }
}

describe("parseJob", () => {
  it("parses a test job; the tunnel block is required", () => {
    const job = parseJob(JSON.stringify(base));
    expect(job.type).toBe("test");
    expect(job.tunnel.hostname).toBe("db.example.com");
    expect(job.deadlineAt.toISOString()).toBe("2026-10-24T04:00:00.000Z");
  });

  it("parses a backup job and defaults the region to auto", () => {
    const job = parseJob(JSON.stringify({ ...base, type: "backup", r2: { ...r2, key: "backups/t/k.dump", partSizeBytes: 33554432 } }));
    expect(job.tunnel.localPort).toBe(15432);
    expect(job.r2).toMatchObject({ key: "backups/t/k.dump", partSizeBytes: 33554432, region: "auto" });
  });

  it("parses a restore job", () => {
    const job = parseJob(JSON.stringify({ ...base, type: "restore", r2, restore: { sourceKey: "backups/t/k.dump", targetDbName: "scratch" } }));
    expect(job.restore).toEqual({ sourceKey: "backups/t/k.dump", targetDbName: "scratch" });
    expect(job.r2?.key).toBeUndefined();
  });

  it("names the bad field and never echoes values", () => {
    expectInvalid("{not json", "not valid JSON");
    expectInvalid({ ...base, type: "explode" }, "type");
    expectInvalid({ ...base, deadlineAt: "tomorrow" }, "deadlineAt");
    expectInvalid({ ...base, db: { url: 5, name: "shop" } }, "db.url");
    expectInvalid({ ...base, type: "backup", r2 }, "r2.key");
    expectInvalid({ ...base, type: "backup", r2: { ...r2, key: "k", partSizeBytes: 100 } }, "r2.partSizeBytes");
    expectInvalid({ ...base, tunnel: undefined }, "tunnel");
    expectInvalid({ ...base, type: "backup", r2: { ...r2, key: "k", partSizeBytes: 33554432 }, tunnel: { ...tunnel, localPort: 80 } }, "tunnel.localPort");
    expectInvalid({ ...base, type: "restore", r2 }, "restore");
    expectInvalid({ ...base, type: "backup", r2: { ...r2, secretAccessKey: "" , key: "k", partSizeBytes: 33554432 } }, "r2.secretAccessKey", "sup3rsecret");
  });

  it("requires jobKey to be base64 of exactly 32 bytes and never echoes it", () => {
    expectInvalid({ ...base, jobKey: "a2V5" }, "jobKey", "a2V5");
    expectInvalid({ ...base, jobKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHy" }, "jobKey");
    expectInvalid({ ...base, jobKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eH_A=" }, "jobKey", "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eH_A=");
  });

  it("requires callbackUrl to be an http or https URL and never echoes it", () => {
    expectInvalid({ ...base, callbackUrl: "" }, "callbackUrl");
    expectInvalid({ ...base, callbackUrl: "worker.internal/callback" }, "callbackUrl", "worker.internal/callback");
    expectInvalid({ ...base, callbackUrl: "ftp://worker.internal/callback" }, "callbackUrl", "ftp://worker.internal/callback");
  });
});

describe("loadJobText", () => {
  const io = {
    readFile: async (path: string) => `file:${path}`,
    readStdin: async () => "stdin",
  };

  it("reads a file path argument (local e2e only)", async () => {
    expect(await loadJobText(["/job/job.json"], io)).toBe("file:/job/job.json");
  });

  it("reads stdin for '-' or when no argument is given", async () => {
    expect(await loadJobText(["-"], io)).toBe("stdin");
    expect(await loadJobText([], io)).toBe("stdin");
  });
});
