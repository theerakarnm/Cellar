import { readFile } from "node:fs/promises";
import { CallbackClient, startHeartbeat } from "./callback";
import { runBackup } from "./jobs/backup";
import { connectionFor, type JobContext } from "./jobs/context";
import { runRestore } from "./jobs/restore";
import { runTest } from "./jobs/test-connection";
import { JobError, loadJobText, parseJob, type Job } from "./job";
import { createScrubber, jobSecrets } from "./redact";
import { startTunnel } from "./tunnel";

const EXIT_FAILED = 1;
const EXIT_INVALID_JOB = 2;
const MAX_TIMER_MS = 2 ** 31 - 1;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function runJob(ctx: JobContext): Promise<Record<string, unknown>> {
  const { job } = ctx;
  connectionFor(job);
  const tunnel = await startTunnel(job.tunnel, { signal: ctx.signal, scrub: ctx.scrub });
  try {
    if (job.type === "test") return await runTest(ctx);
    if (job.type === "backup") return await runBackup(ctx);
    return await runRestore(ctx);
  } finally {
    await tunnel.stop();
  }
}

/** The deadline and SIGTERM abort the controller with a JobError; that reason wins over whatever the abort broke. */
function toJobError(error: unknown, signal: AbortSignal, scrub: (text: string) => string): JobError {
  if (signal.aborted && signal.reason instanceof JobError) return signal.reason;
  if (error instanceof JobError) return new JobError(error.code, scrub(error.message));
  return new JobError("UNKNOWN", scrub(error instanceof Error ? error.message : String(error)));
}

async function main(): Promise<number> {
  let job: Job;
  try {
    const text = await loadJobText(process.argv.slice(2), { readFile: (path) => readFile(path, "utf8"), readStdin });
    job = parseJob(text);
  } catch (error) {
    console.error(error instanceof JobError ? error.message : "Invalid job: could not read the job input");
    return EXIT_INVALID_JOB;
  }

  const scrub = createScrubber(jobSecrets(job));
  const log = (message: string) => console.log(scrub(`[${new Date().toISOString()}] job ${job.jobId} ${message}`));
  const client = new CallbackClient({ url: job.callbackUrl, jobId: job.jobId, jobKeyBase64: job.jobKey });

  const controller = new AbortController();
  const deadlineTimer = setTimeout(
    () => controller.abort(new JobError("TIMEOUT", "The job passed its deadline")),
    Math.min(Math.max(0, job.deadlineAt.getTime() - Date.now()), MAX_TIMER_MS),
  );
  process.once("SIGTERM", () => controller.abort(new JobError("UNKNOWN", "The container was stopped before the job finished")));

  await client.send("started");
  const stopHeartbeat = startHeartbeat(client);
  log(`${job.type} started`);

  let exitCode = 0;
  try {
    const result = await runJob({ job, signal: controller.signal, scrub });
    stopHeartbeat();
    log(`${job.type} succeeded`);
    if (!(await client.send("succeeded", { result }))) {
      log("the success callback was not accepted");
      exitCode = EXIT_FAILED;
    }
  } catch (caught) {
    stopHeartbeat();
    const error = toJobError(caught, controller.signal, scrub);
    log(`${job.type} failed: ${error.code}: ${error.message}`);
    await client.send("failed", { error: { code: error.code, message: error.message } });
    exitCode = EXIT_FAILED;
  }
  clearTimeout(deadlineTimer);
  return exitCode;
}

process.exit(await main());
