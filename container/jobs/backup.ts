import { JobError } from "../job";
import { assertSupportedMajor, pgBinary, pgEnv } from "../pg";
import { childEnv, startChild } from "../process";
import { S3Error } from "../s3";
import { choosePartSize, uploadStream } from "../upload";
import { connectionFor, probeServer, s3For, toolFailure, type JobContext } from "./context";

export async function runBackup(ctx: JobContext): Promise<Record<string, unknown>> {
  const { job, signal } = ctx;
  if (!job.r2?.key || !job.r2.partSizeBytes) throw new JobError("INVALID_JOB", "Invalid job: r2.key and r2.partSizeBytes are required");
  const startedAt = Date.now();
  const connection = connectionFor(job);

  const probe = await probeServer(ctx, connection);
  assertSupportedMajor(probe.major);
  const partSize = choosePartSize(job.r2.partSizeBytes, probe.dbSizeBytes);

  const dump = startChild(pgBinary(probe.major, "pg_dump"), ["--format=custom", "--no-password"], {
    env: childEnv(pgEnv(connection)),
    signal,
  });
  dump.stdin.end();
  try {
    const upload = await uploadStream(dump.stdout, s3For(job), job.r2.key, partSize, {
      signal,
      beforeComplete: async () => {
        const exit = await dump.exit;
        if (exit.spawnError) throw new JobError("DUMP_FAILED", `Could not start pg_dump: ${exit.spawnError.message}`);
        if (exit.code !== 0) throw toolFailure(ctx, dump.stderrTail(), "DUMP_FAILED", `pg_dump exited with code ${exit.code ?? exit.signal}`);
      },
    });
    return { ...upload, pgServerVersion: probe.pgServerVersion, durationMs: Date.now() - startedAt };
  } catch (error) {
    throw error instanceof S3Error ? new JobError("UPLOAD_FAILED", ctx.scrub(error.message)) : error;
  } finally {
    dump.kill();
  }
}
