export type JobType = "test" | "backup" | "restore";

export type ErrorCode =
  | "TUNNEL_FAILED"
  | "AUTH_FAILED"
  | "DUMP_FAILED"
  | "UPLOAD_FAILED"
  | "DOWNLOAD_FAILED"
  | "RESTORE_FAILED"
  | "TIMEOUT"
  | "INVALID_JOB"
  | "UNKNOWN";

export class JobError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export interface TunnelInput {
  hostname: string;
  tokenId: string;
  tokenSecret: string;
  localPort: number;
}

export interface R2Input {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  key?: string;
  partSizeBytes?: number;
}

export interface Job {
  jobId: string;
  type: JobType;
  callbackUrl: string;
  jobKey: string;
  deadlineAt: Date;
  db: { url: string; name: string };
  tunnel: TunnelInput;
  r2?: R2Input;
  restore?: { sourceKey: string; targetDbName: string };
}

type Obj = Record<string, unknown>;

function invalid(path: string, expected: string): never {
  throw new JobError("INVALID_JOB", `Invalid job: ${path} must be ${expected}`);
}

function obj(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "an object");
  return value as Obj;
}

function str(parent: Obj, key: string, path: string): string {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) invalid(`${path}${key}`, "a non-empty string");
  return value as string;
}

function optStr(parent: Obj, key: string, path: string): string | undefined {
  return parent[key] === undefined ? undefined : str(parent, key, path);
}

function int(parent: Obj, key: string, path: string, min: number, max: number): number {
  const value = parent[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    invalid(`${path}${key}`, `an integer between ${min} and ${max}`);
  }
  return value as number;
}

/** Canonical base64 of exactly 32 bytes: the HMAC key size the Worker derives from ENCRYPTION_KEY. */
const JOB_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

function base64Key(value: string): string {
  if (!JOB_KEY_PATTERN.test(value)) invalid("jobKey", "base64 of exactly 32 bytes");
  return value;
}

function httpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid("callbackUrl", "an http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") invalid("callbackUrl", "an http or https URL");
  return value;
}

/** Parses the job JSON. Error messages name the bad field only, never its value. */
export function parseJob(text: string): Job {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new JobError("INVALID_JOB", "Invalid job: not valid JSON");
  }
  const root = obj(raw, "job");
  const type = str(root, "type", "");
  if (type !== "test" && type !== "backup" && type !== "restore") invalid("type", "test, backup or restore");

  const deadlineAt = new Date(str(root, "deadlineAt", ""));
  if (Number.isNaN(deadlineAt.getTime())) invalid("deadlineAt", "an ISO date");

  const db = obj(root.db, "db");
  const tunnel = obj(root.tunnel, "tunnel");
  const job: Job = {
    jobId: str(root, "jobId", ""),
    type: type as JobType,
    callbackUrl: httpUrl(str(root, "callbackUrl", "")),
    jobKey: base64Key(str(root, "jobKey", "")),
    deadlineAt,
    db: { url: str(db, "url", "db."), name: str(db, "name", "db.") },
    tunnel: {
      hostname: str(tunnel, "hostname", "tunnel."),
      tokenId: str(tunnel, "tokenId", "tunnel."),
      tokenSecret: str(tunnel, "tokenSecret", "tunnel."),
      localPort: int(tunnel, "localPort", "tunnel.", 1024, 65535),
    },
  };

  if (type !== "test") {
    const r2 = obj(root.r2, "r2");
    job.r2 = {
      endpoint: str(r2, "endpoint", "r2."),
      bucket: str(r2, "bucket", "r2."),
      accessKeyId: str(r2, "accessKeyId", "r2."),
      secretAccessKey: str(r2, "secretAccessKey", "r2."),
      region: optStr(r2, "region", "r2.") ?? "auto",
    };
    if (type === "backup") {
      job.r2.key = str(r2, "key", "r2.");
      job.r2.partSizeBytes = int(r2, "partSizeBytes", "r2.", 5 * 1024 * 1024, 5 * 1024 * 1024 * 1024);
    } else {
      const restore = obj(root.restore, "restore");
      job.restore = { sourceKey: str(restore, "sourceKey", "restore."), targetDbName: str(restore, "targetDbName", "restore.") };
    }
  }
  return job;
}

/** Job JSON from stdin. A file path argument is for the local e2e harness only; argv never holds secrets. */
export async function loadJobText(
  args: string[],
  io: { readFile(path: string): Promise<string>; readStdin(): Promise<string> },
): Promise<string> {
  const path = args[0];
  if (path !== undefined && path !== "-") return io.readFile(path);
  return io.readStdin();
}
