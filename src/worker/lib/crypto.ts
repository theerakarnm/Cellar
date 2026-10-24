const VERSION = "v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(keyBase64);
  } catch {
    throw new Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns `v1:<base64 iv>:<base64 ciphertext+tag>`. A fresh 12-byte IV is used per call. */
export async function encrypt(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decrypt(payload: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64);
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error("Decryption failed");
  try {
    const iv = fromBase64(parts[1] ?? "");
    const ciphertext = fromBase64(parts[2] ?? "");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Decryption failed");
  }
}
