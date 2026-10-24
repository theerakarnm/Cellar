import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { restores } from "../db/schema";
import { redactSecrets } from "../lib/redact";

type Db = ReturnType<typeof getDb>;

/** The verified callback body (PLAN.md section 5). Signature, timestamp window, and shape are checked before this runs. */
export interface CallbackBody {
  jobId: string;
  event: "started" | "progress" | "succeeded" | "failed";
  at: string;
  seq: number;
  error?: { code: string; message: string };
}

export type RestoreCallbackResult = "not_a_restore" | "ignored" | "applied";

const MAX_ERROR_MESSAGE_LENGTH = 1000;

function errorCodeOf(code: string | undefined): string {
  return code !== undefined && /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : "UNKNOWN";
}

/**
 * Applies one container event to a restore row in a single guarded UPDATE:
 * `last_seq < seq` rejects replays and out-of-order events, and the status guard keeps terminal states final.
 * Timestamps use the Worker clock, not the container's.
 */
export async function handleRestoreCallback(db: Db, body: CallbackBody, now = new Date()): Promise<RestoreCallbackResult> {
  const [row] = await db.select({ id: restores.id }).from(restores).where(eq(restores.id, body.jobId)).limit(1);
  if (!row) return "not_a_restore";

  const at = now.toISOString();
  const fresh = and(eq(restores.id, body.jobId), lt(restores.lastSeq, body.seq));
  const open = inArray(restores.status, ["queued", "running"]);
  const done = (ids: { id: string }[]): RestoreCallbackResult => (ids.length > 0 ? "applied" : "ignored");

  switch (body.event) {
    case "started":
      return done(
        await db.update(restores).set({ startedAt: at, heartbeatAt: at, lastSeq: body.seq })
          .where(and(fresh, eq(restores.status, "running"))).returning({ id: restores.id }),
      );
    case "progress":
      return done(
        await db.update(restores).set({ heartbeatAt: at, lastSeq: body.seq })
          .where(and(fresh, eq(restores.status, "running"))).returning({ id: restores.id }),
      );
    case "succeeded":
      return done(
        await db.update(restores).set({ status: "success", finishedAt: at, heartbeatAt: at, lastSeq: body.seq })
          .where(and(fresh, open)).returning({ id: restores.id }),
      );
    case "failed":
      return done(
        await db.update(restores).set({
          status: "failed",
          errorCode: errorCodeOf(body.error?.code),
          errorMessage: redactSecrets(body.error?.message ?? "Restore failed").slice(0, MAX_ERROR_MESSAGE_LENGTH),
          finishedAt: at,
          lastSeq: body.seq,
        }).where(and(fresh, open)).returning({ id: restores.id }),
      );
  }
}
