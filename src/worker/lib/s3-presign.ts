export interface PresignInput {
  /** Full URL with the final, already-encoded path. Query string must be empty. */
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for R2. */
  region: string;
  expiresInSeconds: number;
  now: Date;
}

const encoder = new TextEncoder();

/** RFC 3986 unreserved set, as SigV4 requires. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(data)));
}

/** AWS Signature Version 4 query-string signing for a GET with an unsigned payload. */
export async function presignUrl(input: PresignInput): Promise<string> {
  const { url, accessKeyId, secretAccessKey, region, expiresInSeconds, now } = input;
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  query.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = query.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");

  const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export interface PresignGetObjectInput {
  /** Path-style endpoint, for example the R2 S3 endpoint or a local RustFS URL. No trailing slash needed. */
  endpoint: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds: number;
  now: Date;
}

export async function presignGetObject(input: PresignGetObjectInput): Promise<string> {
  const base = new URL(input.endpoint);
  const basePath = base.pathname.replace(/\/+$/, "");
  const path = [input.bucket, ...input.key.split("/")].map(uriEncode).join("/");
  const url = new URL(`${base.origin}${basePath}/${path}`);
  return presignUrl({ ...input, url });
}
