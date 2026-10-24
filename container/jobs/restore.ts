import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { JobError } from "../job";
import { MAX_PG_MAJOR, pgBinary, pgEnv } from "../pg";
import { childEnv, startChild } from "../process";
import { S3Error } from "../s3";
import { connectionFor, s3For, toolFailure, type JobContext } from "./context";

/**
 * Streams the dump from R2 into pg_restore. The newest pg_restore is used because it reads every
 * older archive format. The destination is the database named in the job's connection URL.
 */
export async function runRestore(ctx: JobContext): Promise<Record<string, unknown>> {
  const { job, signal } = ctx;
  if (!job.restore) throw new JobError("INVALID_JOB", "Invalid job: restore is required");
  const startedAt = Date.now();
  const connection = connectionFor(job);

  let object: Response;
  try {
    object = await s3For(job).getObject(job.restore.sourceKey, signal);
  } catch (error) {
    throw error instanceof S3Error ? new JobError("DOWNLOAD_FAILED", ctx.scrub(error.message)) : error;
  }
  if (!object.body) throw new JobError("DOWNLOAD_FAILED", "The backup object has no body");

  const restore = startChild(
    pgBinary(MAX_PG_MAJOR, "pg_restore"),
    ["--clean", "--if-exists", "--no-owner", "--no-password", "--dbname", connection.database],
    { env: childEnv(pgEnv(connection)), signal },
  );
  const piped = pipeline(Readable.fromWeb(object.body as WebReadableStream), restore.stdin).then(
    () => null,
    (error: NodeJS.ErrnoException) => error,
  );
  const exit = await restore.exit;
  const pipeError = await piped;

  if (pipeError && pipeError.code !== "EPIPE") throw new JobError("DOWNLOAD_FAILED", ctx.scrub(`Download failed: ${pipeError.message}`));
  if (exit.spawnError) throw new JobError("RESTORE_FAILED", `Could not start pg_restore: ${exit.spawnError.message}`);
  if (exit.code !== 0) throw toolFailure(ctx, restore.stderrTail(), "RESTORE_FAILED", `pg_restore exited with code ${exit.code ?? exit.signal}`);
  return { durationMs: Date.now() - startedAt };
}
