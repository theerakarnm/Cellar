import { z } from "zod";
import type { getDb } from "../db/client";

export type Db = ReturnType<typeof getDb>;

export const jobMessageSchema = z
  .object({
    jobId: z.string().min(1),
    type: z.enum(["backup", "test", "restore"]),
    targetId: z.string().min(1),
  })
  .strict();
export type JobMessage = z.infer<typeof jobMessageSchema>;
export type JobType = JobMessage["type"];

/** Virtual host the container calls; the JobRunner intercepts it and forwards to the Worker. */
export const CALLBACK_HOST = "cellar-callback.internal";
export const CALLBACK_PATH = "/internal/jobs/callback";

export const TUNNEL_LOCAL_PORT = 15432;
export const PART_SIZE_BYTES = 33_554_432;
export const TEST_DEADLINE_MINUTES = 5;
export const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;
export const QUEUE_TIMEOUT_MS = 60 * 60 * 1000;
export const CONNECTION_TEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CALLBACK_WINDOW_SECONDS = 300;
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;
export const QUEUE_RETRY_DELAY_SECONDS = 30;
export const DUE_BATCH_LIMIT = 50;
