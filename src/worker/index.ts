import { app } from "./app";
import type { Env } from "./env";
import { handleJobMessage } from "./jobs/consumer";
import { runCronTick } from "./jobs/cron";
import { startJob } from "./jobs/runner-client";
import type { JobMessage } from "./jobs/types";

export { CallbackEntrypoint, JobRunner } from "./container/job-runner";

export default {
  fetch: app.fetch,

  async scheduled(controller, env) {
    await runCronTick(env, new Date(controller.scheduledTime));
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      await handleJobMessage(env, message, { startJob: (payload) => startJob(env, payload), now: () => new Date() });
    }
  },
} satisfies ExportedHandler<Env, JobMessage>;
