import type { JobRunner } from "./container/job-runner";
import type { JobMessage } from "./jobs/types";

export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  JOBS: Queue<JobMessage>;
  JOB_RUNNER: DurableObjectNamespace<JobRunner>;
  ENCRYPTION_KEY: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_BYPASS?: string;
  R2_ENDPOINT: string;
  R2_BUCKET: string;
  R2_REGION?: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  /** Public Worker URL. Set only when the outbound-handler spike failed; empty means "use the outbound handler". */
  CALLBACK_BASE_URL?: string;
}
