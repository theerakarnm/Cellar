import { constants } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobError } from "../job";
import { assertSupportedMajor, pgBinary, pgEnv } from "../pg";
import { childEnv, runCapture, startChild, type Child, type ExitInfo } from "../process";
import { S3Error } from "../s3";
import { choosePartSize, uploadStream } from "../upload";
import { connectionFor, probeServer, s3For, toolFailure, type JobContext } from "./context";

const CHUNK_BYTES = 1024 * 1024;

/**
 * Yields the dump from a FIFO that pg_dump writes to. Bun does not apply backpressure to child stdout,
 * so reads are pulled one chunk at a time: the kernel pipe then blocks pg_dump while an upload part is pending.
 * The chunk is reused, which is safe because uploadStream copies and hashes each chunk before it pulls the next one.
 * If pg_dump exits before it opens the FIFO, the source ends empty and beforeComplete reports the exit.
 */
export async function* readFifo(fifo: string, dumpExit: Promise<ExitInfo>): AsyncGenerator<Uint8Array> {
  const opening = open(fifo, "r");
  const handle = await Promise.race([opening, dumpExit.then(() => null)]);
  if (!handle) {
    await releaseOpen(fifo, opening);
    return;
  }
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, null);
      if (bytesRead === 0) return;
      yield chunk.subarray(0, bytesRead);
    }
  } finally {
    await handle.close();
  }
}

/**
 * Unblocks a read-open that no writer will match. A non-blocking write-open succeeds only while a reader is
 * pending, and ENXIO means the reader has not started yet, so it retries until one of the two happens.
 */
async function releaseOpen(fifo: string, opening: Promise<FileHandle>): Promise<void> {
  let settled = false;
  void opening.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).then(
      (handle) => handle,
      (error: NodeJS.ErrnoException) => (error.code === "ENXIO" ? undefined : Promise.reject(error)),
    );
    if (writer) {
      await writer.close();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const handle = await opening.catch(() => undefined);
  await handle?.close();
}

export async function runBackup(ctx: JobContext): Promise<Record<string, unknown>> {
  const { job, signal } = ctx;
  if (!job.r2?.key || !job.r2.partSizeBytes) throw new JobError("INVALID_JOB", "Invalid job: r2.key and r2.partSizeBytes are required");
  const startedAt = Date.now();
  const connection = connectionFor(job);

  const probe = await probeServer(ctx, connection);
  assertSupportedMajor(probe.major);
  const partSize = choosePartSize(job.r2.partSizeBytes, probe.dbSizeBytes);

  const workDir = await mkdtemp(join(tmpdir(), "cellar-dump-"));
  const fifo = join(workDir, "dump.fifo");
  let dump: Child | undefined;
  try {
    const made = await runCapture("mkfifo", ["-m", "600", fifo], { env: childEnv({}), signal });
    if (made.exit.spawnError || made.exit.code !== 0) throw new JobError("DUMP_FAILED", `Could not create the dump FIFO: ${made.stderr.trim()}`);

    dump = startChild(pgBinary(probe.major, "pg_dump"), ["--format=custom", "--no-password", "--no-sync", `--file=${fifo}`], {
      env: childEnv(pgEnv(connection)),
      signal,
    });
    const dumpChild = dump;
    dumpChild.stdin.end();
    const upload = await uploadStream(readFifo(fifo, dumpChild.exit), s3For(job), job.r2.key, partSize, {
      signal,
      beforeComplete: async () => {
        const exit = await dumpChild.exit;
        if (exit.spawnError) throw new JobError("DUMP_FAILED", `Could not start pg_dump: ${exit.spawnError.message}`);
        if (exit.code !== 0) throw toolFailure(ctx, dumpChild.stderrTail(), "DUMP_FAILED", `pg_dump exited with code ${exit.code ?? exit.signal}`);
      },
    });
    return { ...upload, pgServerVersion: probe.pgServerVersion, durationMs: Date.now() - startedAt };
  } catch (error) {
    throw error instanceof S3Error ? new JobError("UPLOAD_FAILED", ctx.scrub(error.message)) : error;
  } finally {
    dump?.kill();
    await rm(workDir, { recursive: true, force: true });
  }
}
