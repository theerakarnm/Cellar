import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../../../src/worker/lib/crypto";

const keyA = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const keyB = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));

describe("crypto", () => {
  it("roundtrips, including unicode and empty strings", async () => {
    for (const text of ["postgres://u:p@h:5432/db", "", "รหัสผ่าน-🔑"]) {
      expect(await decrypt(await encrypt(text, keyA), keyA)).toBe(text);
    }
  });

  it("uses the v1:<iv>:<ciphertext> format with a 12-byte IV", async () => {
    const [version, iv, ciphertext, extra] = (await encrypt("secret", keyA)).split(":");
    expect(version).toBe("v1");
    expect(atob(iv ?? "").length).toBe(12);
    expect(ciphertext).toBeTruthy();
    expect(extra).toBeUndefined();
  });

  it("uses a different IV and ciphertext every time", async () => {
    const first = await encrypt("same", keyA);
    const second = await encrypt("same", keyA);
    expect(first).not.toBe(second);
    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
  });

  it("does not contain the plaintext", async () => {
    expect(await encrypt("super-secret-value", keyA)).not.toContain("super-secret-value");
  });

  it("rejects tampered ciphertext", async () => {
    const [version, iv, ciphertext] = (await encrypt("secret", keyA)).split(":");
    const bytes = Uint8Array.from(atob(ciphertext ?? ""), (c) => c.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = `${version}:${iv}:${btoa(String.fromCharCode(...bytes))}`;
    await expect(decrypt(tampered, keyA)).rejects.toThrow("Decryption failed");
  });

  it("rejects the wrong key", async () => {
    await expect(decrypt(await encrypt("secret", keyA), keyB)).rejects.toThrow("Decryption failed");
  });

  it("rejects unknown versions and malformed payloads", async () => {
    await expect(decrypt("v2:AAAA:AAAA", keyA)).rejects.toThrow("Decryption failed");
    await expect(decrypt("garbage", keyA)).rejects.toThrow("Decryption failed");
    await expect(decrypt("v1:!!!:!!!", keyA)).rejects.toThrow("Decryption failed");
  });

  it("rejects keys that are not 32 bytes of base64 without echoing the key", async () => {
    const shortKey = btoa("short");
    await expect(encrypt("x", shortKey)).rejects.toThrow("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
    await expect(encrypt("x", "not base64 !!")).rejects.toThrow("ENCRYPTION_KEY");
  });
});
