import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobError } from "../job";
import { S3Client } from "../s3";
import { choosePartSize, MAX_PART_BYTES, MIN_PART_BYTES, uploadStream } from "../upload";
import { startFakeS3, type FakeS3 } from "./helpers/fake-s3";

const MiB = 1024 * 1024;

async function* chunks(totalBytes: number, chunkBytes: number): AsyncGenerator<Uint8Array> {
  let sent = 0;
  while (sent < totalBytes) {
    const size = Math.min(chunkBytes, totalBytes - sent);
    yield Uint8Array.from({ length: size }, (_, i) => (sent + i) % 251);
    sent += size;
  }
}

describe("choosePartSize", () => {
  it("keeps the requested 32 MiB for databases up to about 237 GiB", () => {
    expect(choosePartSize(32 * MiB, 0)).toBe(32 * MiB);
    expect(choosePartSize(32 * MiB, 1024 ** 3)).toBe(32 * MiB);
    expect(choosePartSize(32 * MiB, 200 * 1024 ** 3)).toBe(32 * MiB);
  });

  it("grows the part size so the dump needs fewer than 10,000 parts", () => {
    const size = choosePartSize(32 * MiB, 800 * 1024 ** 3);
    expect(size).toBeGreaterThan(32 * MiB);
    expect(size % MiB).toBe(0);
    expect(Math.ceil((800 * 1024 ** 3 * 1.25) / size)).toBeLessThan(10_000);
  });

  it("never goes below the S3 minimum, and refuses sizes the container cannot buffer", () => {
    expect(choosePartSize(1, 0)).toBe(MIN_PART_BYTES);
    expect(() => choosePartSize(32 * MiB, 5 * 1024 ** 4)).toThrow(JobError);
    expect(MAX_PART_BYTES).toBe(128 * MiB);
  });
});

describe("uploadStream", () => {
  let s3: FakeS3;
  let client: S3Client;

  beforeEach(async () => {
    s3 = await startFakeS3();
    client = new S3Client({ endpoint: s3.endpoint, bucket: "cellar", region: "auto", accessKeyId: "AKIATEST", secretAccessKey: "secret-key" }, async () => {});
  });
  afterEach(() => s3.close());

  const puts = () => s3.requests.filter((request) => request.method === "PUT");

  it("splits into equal parts, reports size, sha256 and part count, and uploads sequentially", async () => {
    const total = 10 * MiB + 123;
    const result = await uploadStream(chunks(total, 300_000), client, "k", 4 * MiB);
    const expected = createHash("sha256");
    for await (const chunk of chunks(total, 300_000)) expected.update(chunk);

    expect(result).toEqual({ sizeBytes: total, sha256: expected.digest("hex"), partCount: 3 });
    expect(puts().map((request) => request.bodyBytes)).toEqual([4 * MiB, 4 * MiB, 2 * MiB + 123]);
    expect(s3.requests.map((request) => request.method)).toEqual(["POST", "PUT", "PUT", "PUT", "POST"]);
  });

  it("handles a source whose chunks are larger than a part and an exact multiple of the part size", async () => {
    const result = await uploadStream(chunks(8 * MiB, 6 * MiB), client, "k", 4 * MiB);
    expect(result.partCount).toBe(2);
    expect(puts().map((request) => request.bodyBytes)).toEqual([4 * MiB, 4 * MiB]);
  });

  it("aborts and never completes when the source fails midway", async () => {
    async function* failing() {
      yield new Uint8Array(5 * MiB);
      throw new Error("pipe broke");
    }
    await expect(uploadStream(failing(), client, "k", 4 * MiB)).rejects.toThrow("pipe broke");
    const methods = s3.requests.map((request) => request.method);
    expect(methods).toContain("DELETE");
    expect(s3.requests.some((request) => request.method === "POST" && request.query.has("uploadId"))).toBe(false);
  });

  it("aborts when beforeComplete throws, before the last part is sent", async () => {
    const failure = new JobError("DUMP_FAILED", "pg_dump exited with code 1");
    await expect(
      uploadStream(chunks(5 * MiB, MiB), client, "k", 4 * MiB, { beforeComplete: async () => { throw failure; } }),
    ).rejects.toBe(failure);
    expect(puts()).toHaveLength(1);
    expect(s3.requests.at(-1)?.method).toBe("DELETE");
  });

  it("aborts an empty dump", async () => {
    await expect(uploadStream(chunks(0, 1), client, "k", 4 * MiB)).rejects.toThrow("no data");
    expect(s3.requests.at(-1)?.method).toBe("DELETE");
  });

  it("aborts when a part upload fails permanently and keeps the original error", async () => {
    s3.failWith((request) => (request.method === "PUT" ? 403 : null));
    await expect(uploadStream(chunks(5 * MiB, MiB), client, "k", 4 * MiB)).rejects.toMatchObject({ status: 403 });
    expect(s3.requests.at(-1)?.method).toBe("DELETE");
  });
});
