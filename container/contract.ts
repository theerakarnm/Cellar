// The runner contract shared with the Worker (owner answer 13). Phase 5 imports this file in its own tests.
// Change it only together with the Worker side.

/** The image ENTRYPOINT. The job JSON arrives on stdin. */
export const CONTRACT_ENTRYPOINT = ["bun", "run", "/app/entrypoint.ts"] as const;

const common = {
  jobId: "0192f5a0-0000-7000-8000-000000000001",
  callbackUrl: "https://cellar.example.com/internal/jobs/callback",
  jobKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  deadlineAt: "2026-10-24T06:00:00.000Z",
  db: { url: "postgres://cellar_backup:example-pw@db.example.com:5432/shop?sslmode=disable", name: "shop" },
  tunnel: { hostname: "db.example.com", tokenId: "example-token-id", tokenSecret: "example-token-secret", localPort: 15432 },
};
const r2 = { endpoint: "https://example-account.r2.cloudflarestorage.com", bucket: "cellar-backups", accessKeyId: "example-access-key", secretAccessKey: "example-secret-key" };

/** One valid stdin job per type. Field names and nesting are the contract; values are examples. */
export const SAMPLE_JOBS = {
  test: { ...common, type: "test" },
  backup: { ...common, type: "backup", r2: { ...r2, key: "backups/0192f5a0-0000-7000-8000-0000000000aa/2026/10/24/2026-10-24T03:00:00.000Z_shop.dump", partSizeBytes: 33554432 } },
  restore: { ...common, type: "restore", r2, restore: { sourceKey: "backups/0192f5a0-0000-7000-8000-0000000000aa/2026/10/24/2026-10-24T03:00:00.000Z_shop.dump", targetDbName: "shop" } },
} as const;

/** Known-answer vector: hex HMAC-SHA256(base64-decoded jobKey, timestamp + "." + jobId + "." + rawBody). Computed independently (Python hmac) at planning time. */
export const SIGNATURE_VECTOR = {
  jobKeyBase64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  timestamp: "1792814400",
  jobId: "0192f5a0-0000-7000-8000-000000000001",
  rawBody: '{"jobId":"0192f5a0-0000-7000-8000-000000000001","event":"started","at":"2026-10-24T03:00:00.000Z","seq":1}',
  signatureHex: "e308588ec7c6843905b822f135def5d1cedcd350bbb9e7f09f01c6bb7554c57c",
} as const;

/** Sorted dotted key paths of a JSON object, for comparing a built job with a sample. */
export function jobShape(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => jobShape(child, prefix ? `${prefix}.${key}` : key)).sort();
}
