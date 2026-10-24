import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCallback } from "../hmac";
import { S3Client } from "../s3";

export const COMPOSE_FILE = "test/docker-compose.test.yml";
export const BUCKET = "cellar-test";
export const S3_REGION = process.env.S3_REGION ?? "us-east-1";
export const PG_PASSWORD = "cellar-test-pw";
const CALLBACK_PORT = 18080;
const PROJECT = "cellar-e2e";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function sh(command: string[], env: Record<string, string> = {}, stdin?: string): Promise<CommandResult> {
  const proc = Bun.spawn(command, { env: { ...process.env, ...env }, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

export const compose = (args: string[], env: Record<string, string> = {}, stdin?: string) =>
  sh(["docker", "compose", "-p", PROJECT, "-f", COMPOSE_FILE, ...args], env, stdin);

export function check(condition: boolean, message: string): void {
  console.log(`${condition ? "PASS" : "FAIL"} ${message}`);
  if (!condition) process.exitCode = 1;
}

/** Runs SQL in a database container as the seeded superuser and returns trimmed psql -At output. */
export async function psql(service: "pg14" | "pg17", database: string, sql: string): Promise<string> {
  const result = await compose(["exec", "-T", service, "psql", "-U", "cellar", "-d", database, "-At", "-c", sql]);
  if (result.code !== 0) throw new Error(`psql failed on ${service}: ${result.stderr}`);
  return result.stdout.trim();
}

export async function waitFor(what: string, probe: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const s3Client = () =>
  new S3Client({ endpoint: "http://127.0.0.1:19000", bucket: BUCKET, region: S3_REGION, accessKeyId: "cellar-test-access", secretAccessKey: "cellar-test-secret" });

export async function startStack(services: string[]): Promise<void> {
  const up = await compose(["up", "-d", ...services]);
  if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
  for (const service of services.filter((name) => name.startsWith("pg"))) {
    await waitFor(`${service} to accept connections`, async () => (await compose(["exec", "-T", service, "pg_isready", "-U", "cellar", "-d", "shop"])).code === 0);
  }
  await waitFor("the S3 stand-in", async () => (await fetch("http://127.0.0.1:19000/health")).status < 500);
  try {
    await s3Client().send({ method: "PUT" });
  } catch (error) {
    if (!(error instanceof Error && /BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(error.message))) throw error;
  }
}

export interface CallbackEvent {
  jobId: string;
  event: "started" | "progress" | "succeeded" | "failed";
  seq: number;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

/** Local HTTP listener that verifies the HMAC of every callback, like the Worker will. */
export function startCallbackListener() {
  const jobKey = randomBytes(32).toString("base64");
  const events: CallbackEvent[] = [];
  let invalid = 0;
  const server = Bun.serve({
    port: CALLBACK_PORT,
    hostname: "0.0.0.0",
    async fetch(request) {
      const body = await request.text();
      const parsed = JSON.parse(body) as CallbackEvent;
      const verdict = await verifyCallback({
        jobKeyBase64: jobKey,
        timestamp: request.headers.get("x-cellar-timestamp") ?? "",
        signatureHex: request.headers.get("x-cellar-signature") ?? "",
        jobId: parsed.jobId,
        rawBody: body,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      if (verdict !== "ok") {
        invalid++;
        return new Response("bad signature", { status: 401 });
      }
      events.push(parsed);
      return new Response("ok");
    },
  });
  return {
    jobKey,
    callbackUrl: `http://host.docker.internal:${CALLBACK_PORT}/internal/jobs/callback`,
    eventsFor: (jobId: string) => events.filter((event) => event.jobId === jobId),
    invalidCount: () => invalid,
    stop: () => server.stop(true),
  };
}

export interface RunOptions {
  jobId: string;
  job: Record<string, unknown>;
  containerName?: string;
}

/** Writes the job JSON to a temp dir, runs the runner image on it, and returns the exit code and output. */
export async function runRunner(options: RunOptions, env: Record<string, string> = {}): Promise<CommandResult> {
  const dir = await mkdtemp(join(tmpdir(), "cellar-job-"));
  await writeFile(join(dir, "job.json"), JSON.stringify(options.job), { mode: 0o600 });
  const args = ["--profile", "runner", "run", "-T", ...(options.containerName ? ["--name", options.containerName] : ["--rm"]), "runner-local", "/job/job.json"];
  return compose(args, { JOB_DIR: dir, ...env });
}

/** Every job has a tunnel block (no direct mode). Locally the fake cloudflared forwards to the URL's host. */
export function baseJob(listener: ReturnType<typeof startCallbackListener>, jobId: string, type: "test" | "backup" | "restore", dbUrl: string, extra: Record<string, unknown> = {}) {
  const tunnel = { hostname: new URL(dbUrl).hostname, tokenId: "local-test-token-id", tokenSecret: "local-test-token-secret", localPort: 15432 };
  return {
    jobId,
    type,
    callbackUrl: listener.callbackUrl,
    jobKey: listener.jobKey,
    deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    db: { url: dbUrl, name: "shop" },
    tunnel,
    ...extra,
  };
}

export const r2Block = (extra: Record<string, unknown> = {}) => ({
  endpoint: "http://s3:9000",
  bucket: BUCKET,
  region: S3_REGION,
  accessKeyId: "cellar-test-access",
  secretAccessKey: "cellar-test-secret",
  ...extra,
});

/** sha256 and byte count of a stored object, computed by reading it back as a stream. */
export async function objectDigest(key: string): Promise<{ sha256: string; bytes: number }> {
  const response = await s3Client().getObject(key);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest("hex"), bytes };
}
