import { createHash } from "node:crypto";

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "S3Error";
  }
}

const encoder = new TextEncoder();
const EMPTY_SHA256 = createHash("sha256").digest("hex");

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array<ArrayBuffer> | string, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
}

/** RFC 3986 percent-encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface SignInput {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadSha256: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}

/** Returns the request headers to send, including host, x-amz-date, x-amz-content-sha256 and Authorization. */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value.trim();
  headers.host = input.url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = input.payloadSha256;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalQuery = [...input.url.searchParams]
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const canonicalRequest = [input.method, input.url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadSha256].join("\n");

  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
  const kDate = await hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(kDate, input.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex((await hmac(kSigning, stringToSign)).buffer);

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

interface SendInput {
  method: string;
  key?: string;
  query?: Record<string, string>;
  body?: Uint8Array<ArrayBuffer>;
  signal?: AbortSignal;
}

const RETRY_DELAYS_MS = [500, 2000];

function isRetryable(error: unknown): boolean {
  if (error instanceof S3Error) return error.status === 429 || error.status >= 500;
  return !(error instanceof DOMException && error.name === "AbortError");
}

/** Minimal path-style S3 client for R2 and S3-compatible stand-ins: multipart upload and streaming GET. */
export class S3Client {
  constructor(
    private readonly config: S3Config,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private objectUrl(key?: string, query: Record<string, string> = {}): URL {
    const base = this.config.endpoint.replace(/\/+$/, "");
    const path = key === undefined ? "" : `/${key.split("/").map(encodeRfc3986).join("/")}`;
    const url = new URL(`${base}/${encodeRfc3986(this.config.bucket)}${path}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  }

  /** One signed request. Non-2xx responses and 200 responses carrying an <Error> body throw S3Error. */
  async send(input: SendInput): Promise<Response> {
    const url = this.objectUrl(input.key, input.query);
    const payloadSha256 = input.body ? createHash("sha256").update(input.body).digest("hex") : EMPTY_SHA256;
    const headers = await signRequest({
      method: input.method,
      url,
      payloadSha256,
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      now: new Date(),
    });
    const response = await fetch(url, { method: input.method, headers, body: input.body, signal: input.signal });
    if (!response.ok) throw await toS3Error(response);
    return response;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isRetryable(error)) throw error;
        await this.sleep(delay);
      }
    }
  }

  async createMultipart(key: string, signal?: AbortSignal): Promise<string> {
    return this.withRetry(async () => {
      const text = await (await this.send({ method: "POST", key, query: { uploads: "" }, signal })).text();
      const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1];
      if (!uploadId) throw new S3Error(200, "InvalidResponse", "CreateMultipartUpload returned no UploadId");
      return uploadId;
    });
  }

  async uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<CompletedPart> {
    return this.withRetry(async () => {
      const response = await this.send({ method: "PUT", key, query: { partNumber: String(partNumber), uploadId }, body, signal });
      const etag = response.headers.get("etag");
      if (!etag) throw new S3Error(200, "InvalidResponse", `UploadPart ${partNumber} returned no ETag`);
      return { partNumber, etag };
    });
  }

  async completeMultipart(key: string, uploadId: string, parts: CompletedPart[], signal?: AbortSignal): Promise<void> {
    const xml =
      "<CompleteMultipartUpload>" +
      parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`).join("") +
      "</CompleteMultipartUpload>";
    await this.withRetry(async () => {
      const text = await (await this.send({ method: "POST", key, query: { uploadId }, body: encoder.encode(xml), signal })).text();
      if (/<Error>/.test(text)) throw new S3Error(200, errorCode(text), "CompleteMultipartUpload failed");
    });
  }

  /** Best effort: callers pass no signal so an aborted job can still clean up. */
  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.send({ method: "DELETE", key, query: { uploadId } });
  }

  async getObject(key: string, signal?: AbortSignal): Promise<Response> {
    return this.send({ method: "GET", key, signal });
  }
}

function errorCode(text: string): string {
  return /<Code>([^<]*)<\/Code>/.exec(text)?.[1] ?? "Unknown";
}

async function toS3Error(response: Response): Promise<S3Error> {
  const text = await response.text().catch(() => "");
  const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1] ?? response.statusText;
  return new S3Error(response.status, errorCode(text), `S3 ${response.status} ${errorCode(text)}: ${message}`);
}
