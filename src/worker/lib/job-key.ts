function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/**
 * Per-job callback key: HMAC(HMAC(ENCRYPTION_KEY, "cellar-job-signing-v1"), jobId), base64 of 32 bytes.
 * The intermediate step keeps the signing key separate from the AES key use of ENCRYPTION_KEY.
 * Nothing is stored: the Worker recomputes it from the job id when a callback arrives.
 */
export async function deriveJobKey(encryptionKeyBase64: string, jobId: string): Promise<string> {
  const signingKey = await hmacSha256(fromBase64(encryptionKeyBase64), "cellar-job-signing-v1");
  return toBase64(await hmacSha256(signingKey, jobId));
}
