import { checkStaleness } from "./alerts/staleness";
import { app } from "./app";
import type { Env } from "./env";
import { handleJobMessage } from "./jobs/consumer";
import { runCronTick } from "./jobs/cron";
import { startJob, stopJob } from "./jobs/runner-client";
import type { JobMessage } from "./jobs/types";
import { triggerDailyRetention } from "./retention/triggers";

export { CallbackEntrypoint, JobRunner } from "./container/job-runner";

export default {
  fetch: app.fetch,

  async scheduled(controller, env, ctx) {
    await runCronTick(env, new Date(controller.scheduledTime));
    await checkStaleness(env, new Date(controller.scheduledTime));
    ctx.waitUntil(triggerDailyRetention(env, new Date(controller.scheduledTime)));
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      await handleJobMessage(env, message, {
        startJob: (payload) => startJob(env, payload),
        stopJob: (jobId) => stopJob(env, jobId),
        now: () => new Date(),
      });
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;
