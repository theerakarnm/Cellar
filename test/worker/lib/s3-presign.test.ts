import { describe, expect, it } from "vitest";
import { presignGetObject, presignUrl } from "../../../src/worker/lib/s3-presign";

const KEY = "backups/t-1/2026/10/24/2026-10-24T02:00:00.000Z_appdb.dump";
const NOW = new Date("2026-10-24T02:05:07.123Z");

describe("presignUrl", () => {
  it("matches the AWS documented SigV4 query-string example", async () => {
    const url = await presignUrl({
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
});

// Expected URLs below were produced by botocore S3SigV4QueryAuth with the same inputs (see "Scratch runs").
describe("presignGetObject", () => {
  it("matches botocore for an R2-style endpoint, region auto, and a key with a space", async () => {
    const url = await presignGetObject({
      endpoint: "https://acct123.r2.cloudflarestorage.com",
      bucket: "cellar-backups",
      key: "backups/t-1/2026/10/24/2026-10-24T02:00:00.000Z_my db.dump",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      region: "auto",
      expiresInSeconds: 900,
      now: NOW,
    });
    expect(url).toBe(
      "https://acct123.r2.cloudflarestorage.com/cellar-backups/backups/t-1/2026/10/24/2026-10-24T02%3A00%3A00.000Z_my%20db.dump?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKID%2F20261024%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261024T020507Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=27d0d554156d51d2504bf7b8c17e76b313a85b82dfaf157ee87061e6eab3ed0b",
    );
  });

  it("matches botocore for a path-style endpoint with a port (local RustFS)", async () => {
    const input = {
      bucket: "cellar-test",
      key: KEY,
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      region: "us-east-1",
      expiresInSeconds: 900,
      now: NOW,
    };
    const expected =
      "http://localhost:9000/cellar-test/backups/t-1/2026/10/24/2026-10-24T02%3A00%3A00.000Z_appdb.dump?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20261024%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261024T020507Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=49b6aebffb625c1b2cbc009e6ca1168693b4a3ccdae9d4238d79fa4eea9839e9";
    expect(await presignGetObject({ ...input, endpoint: "http://localhost:9000" })).toBe(expected);
    expect(await presignGetObject({ ...input, endpoint: "http://localhost:9000/" })).toBe(expected);
  });

  it("signs only the host header and carries the requested expiry", async () => {
    const url = new URL(
      await presignGetObject({ endpoint: "https://acct123.r2.cloudflarestorage.com", bucket: "b", key: KEY, accessKeyId: "A", secretAccessKey: "S", region: "auto", expiresInSeconds: 300, now: NOW }),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261024T020507Z");
  });
});
