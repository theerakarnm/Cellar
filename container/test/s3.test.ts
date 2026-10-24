import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S3Client, S3Error, signRequest } from "../s3";
import { startFakeS3, type FakeS3 } from "./helpers/fake-s3";

// AWS documentation example credentials (public test vectors, not secrets).
const vector = { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") };
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("signRequest (AWS SigV4 for S3 test vectors)", () => {
  it("signs GET Object with a Range header", async () => {
    const headers = await signRequest({ ...vector, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), headers: { Range: "bytes=0-9" }, payloadSha256: EMPTY });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("signs GET Bucket (List Objects) with sorted query parameters", async () => {
    const headers = await signRequest({ ...vector, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2"), payloadSha256: EMPTY });
    expect(headers.authorization).toContain("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("S3Client multipart", () => {
  let s3: FakeS3;
  let client: S3Client;
  const noSleep = async () => {};

  beforeEach(async () => {
    s3 = await startFakeS3();
    client = new S3Client({ endpoint: s3.endpoint, bucket: "cellar", region: "auto", accessKeyId: "AKIATEST", secretAccessKey: "secret-key" }, noSleep);
  });
  afterEach(() => s3.close());

  it("creates, uploads, and completes with ordered parts and the part payload hash", async () => {
    const key = "backups/t1/2026/10/24/2026-10-24T02:00:00.000Z_shop.dump";
    const uploadId = await client.createMultipart(key);
    const part = await client.uploadPart(key, uploadId, 1, new Uint8Array(1024).fill(1));
    await client.completeMultipart(key, uploadId, [part]);

    const [create, put, complete] = s3.requests;
    expect(create?.path).toBe("/cellar/backups/t1/2026/10/24/2026-10-24T02%3A00%3A00.000Z_shop.dump");
    expect(create?.query.has("uploads")).toBe(true);
    expect(put?.query.get("partNumber")).toBe("1");
    expect(put?.bodyBytes).toBe(1024);
    expect(put?.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(put?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request/);
    expect(complete?.body.toString()).toBe('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag></Part></CompleteMultipartUpload>');
  });

  it("retries a 503 on a part and then succeeds", async () => {
    const uploadId = await client.createMultipart("k");
    let failures = 1;
    s3.failWith((request) => (request.method === "PUT" && failures-- > 0 ? 503 : null));
    await expect(client.uploadPart("k", uploadId, 1, new Uint8Array(8))).resolves.toEqual({ partNumber: 1, etag: '"etag-1"' });
    expect(s3.requests.filter((request) => request.method === "PUT")).toHaveLength(2);
  });

  it("does not retry a 403 and surfaces the S3 error code without secrets", async () => {
    s3.failWith(() => 403);
    const error = await client.createMultipart("k").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(S3Error);
    expect((error as S3Error).status).toBe(403);
    expect((error as S3Error).message).not.toContain("secret-key");
    expect(s3.requests).toHaveLength(1);
  });

  it("gives up after three attempts on persistent 500s", async () => {
    s3.failWith(() => 500);
    await expect(client.createMultipart("k")).rejects.toBeInstanceOf(S3Error);
    expect(s3.requests).toHaveLength(3);
  });

  it("treats a 200 response with an <Error> body on Complete as a failure", async () => {
    const uploadId = await client.createMultipart("k");
    s3.failWith((request) => (request.method === "POST" && request.query.has("uploadId") ? "ok-with-error" : null));
    await expect(client.completeMultipart("k", uploadId, [{ partNumber: 1, etag: '"e"' }])).rejects.toMatchObject({ code: "InjectedError" });
  });

  it("aborts with DELETE ?uploadId and streams GET objects", async () => {
    await client.abortMultipart("k", "upload-9");
    expect(s3.requests[0]).toMatchObject({ method: "DELETE" });
    expect(s3.requests[0]?.query.get("uploadId")).toBe("upload-9");
    expect(await (await client.getObject("k")).text()).toBe("object-bytes");
  });
});
