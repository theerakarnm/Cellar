import type { Env } from "../env";
import { redactError } from "../lib/redact";
import { enqueueDueBackups } from "./dispatch";
import { stopJob } from "./runner-client";
import { sweepStaleJobs } from "./sweeper";

/**
 * One `* * * * *` tick. Steps run in order and one failing step never blocks the next:
 * 1. enqueue due targets, 2. stale sweeper. (Phase 6 appends the daily retention run.)
 */
export async function runCronTick(env: Env, now: Date): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["enqueue", () => enqueueDueBackups(env, now)],
    ["sweep", () => sweepStaleJobs(env, now, (jobId) => stopJob(env, jobId))],
  ];
  for (const [name, run] of steps) {
    try {
      await run();
    } catch (error) {
      console.error(`cron: ${name} failed: ${redactError(error)}`);
    }
  }
}
