import { JobError, type ErrorCode, type Job } from "../job";
import { classifyConnectionFailure, MAX_PG_MAJOR, parsePgUrl, parseProbe, pgBinary, pgEnv, PROBE_SQL, type PgConnection, type ServerProbe } from "../pg";
import { childEnv, runCapture } from "../process";
import { S3Client } from "../s3";

export interface JobContext {
  job: Job;
  signal: AbortSignal;
  scrub: (text: string) => string;
}

/** Database connection for the job. The host and port are always the local tunnel listener. */
export function connectionFor(job: Job): PgConnection {
  return { ...parsePgUrl(job.db.url), host: "127.0.0.1", port: job.tunnel.localPort };
}

export function s3For(job: Job): S3Client {
  if (!job.r2) throw new JobError("INVALID_JOB", "Invalid job: r2 is required");
  return new S3Client({
    endpoint: job.r2.endpoint,
    bucket: job.r2.bucket,
    region: job.r2.region,
    accessKeyId: job.r2.accessKeyId,
    secretAccessKey: job.r2.secretAccessKey,
  });
}

/** Builds a JobError from a failed Postgres tool: connection problems get their own code. */
export function toolFailure(ctx: JobContext, stderr: string, fallback: ErrorCode, summary: string): JobError {
  const text = ctx.scrub(stderr).trim();
  const code = classifyConnectionFailure(text) ?? fallback;
  return new JobError(code, `${summary}: ${text.slice(-800)}`);
}

/** One psql round trip: server version, database size, and whether the role can read everything. */
export async function probeServer(ctx: JobContext, connection: PgConnection): Promise<ServerProbe> {
  const result = await runCapture(
    pgBinary(MAX_PG_MAJOR, "psql"),
    ["-X", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1", "--no-password", "-c", PROBE_SQL],
    { env: childEnv(pgEnv(connection)), signal: ctx.signal },
  );
  if (result.exit.spawnError) throw new JobError("UNKNOWN", `Could not start psql: ${result.exit.spawnError.message}`);
  if (result.exit.code !== 0) throw toolFailure(ctx, result.stderr, "UNKNOWN", "Could not connect to the database");
  return parseProbe(result.stdout);
}
