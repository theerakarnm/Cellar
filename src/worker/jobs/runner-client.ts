import type { Env } from "../env";
import type { JobPayload } from "./payload";

/** Starts the job's container through its Durable Object. Returns once the runner has its input. */
export async function startJob(env: Env, payload: JobPayload): Promise<void> {
  const stub = env.JOB_RUNNER.getByName(payload.jobId);
  await stub.run({ payloadJson: JSON.stringify(payload), deadlineMs: Date.parse(payload.deadlineAt) });
}

/** Best effort: stops the job's container. A missing or already stopped container is not an error. */
export async function stopJob(env: Env, jobId: string): Promise<void> {
  try {
    await env.JOB_RUNNER.getByName(jobId).stop();
  } catch {
    console.warn(`jobs: could not stop container for ${jobId}`);
  }
}
