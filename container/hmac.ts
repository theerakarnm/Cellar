export const TIMESTAMP_HEADER = "X-Cellar-Timestamp";
export const SIGNATURE_HEADER = "X-Cellar-Signature";
export const MAX_SKEW_SECONDS = 300;

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function importKey(jobKeyBase64: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64ToBytes(jobKeyBase64), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function signedMessage(timestamp: string, jobId: string, rawBody: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`${timestamp}.${jobId}.${rawBody}`));
}

/** Hex HMAC-SHA256(jobKey, timestamp + "." + jobId + "." + rawBody). `timestamp` is unix seconds as a string. */
export async function signCallback(
  jobKeyBase64: string,
  timestamp: string,
  jobId: string,
  rawBody: string,
): Promise<string> {
  const key = await importKey(jobKeyBase64, "sign");
  const signature = await crypto.subtle.sign("HMAC", key, signedMessage(timestamp, jobId, rawBody));
  return bytesToHex(new Uint8Array(signature));
}

export interface VerifyCallbackInput {
  jobKeyBase64: string;
  timestamp: string;
  signatureHex: string;
  jobId: string;
  rawBody: string;
  nowSeconds: number;
}

/** Checks the timestamp window first, then the signature with WebCrypto's constant-time `verify`. */
export async function verifyCallback(input: VerifyCallbackInput): Promise<"ok" | "bad_timestamp" | "bad_signature"> {
  if (!/^\d{1,12}$/.test(input.timestamp)) return "bad_timestamp";
  if (Math.abs(input.nowSeconds - Number(input.timestamp)) > MAX_SKEW_SECONDS) return "bad_timestamp";
  const signature = hexToBytes(input.signatureHex);
  if (!signature) return "bad_signature";
  const key = await importKey(input.jobKeyBase64, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    signedMessage(input.timestamp, input.jobId, input.rawBody),
  );
  return valid ? "ok" : "bad_signature";
}
