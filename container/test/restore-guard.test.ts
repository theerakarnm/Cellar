import { describe, expect, it } from "vitest";
import { JobError, type Job } from "../job";
import { restoreConnection } from "../jobs/restore";
import { SAMPLE_JOBS } from "../contract";

function restoreJob(url: string, targetDbName: string): Job {
  return { ...SAMPLE_JOBS.restore, deadlineAt: new Date(SAMPLE_JOBS.restore.deadlineAt), db: { url, name: "shop" }, restore: { ...SAMPLE_JOBS.restore.restore, targetDbName } } as Job;
}

describe("restoreConnection", () => {
  it("returns the connection when targetDbName matches the database in db.url", () => {
    const connection = restoreConnection(restoreJob("postgresql://app:pw@db.internal:5432/shop", "shop"));
    expect(connection.database).toBe("shop");
    expect(connection.host).toBe("127.0.0.1");
  });

  it("compares the decoded database name", () => {
    const connection = restoreConnection(restoreJob("postgresql://app:pw@db.internal/my%20db", "my db"));
    expect(connection.database).toBe("my db");
  });

  it("rejects a mismatch with INVALID_JOB before any connection work", () => {
    const job = restoreJob("postgresql://app:pw@db.internal/restore_check", "shop");
    expect(() => restoreConnection(job)).toThrow(JobError);
    try {
      restoreConnection(job);
    } catch (error) {
      expect((error as JobError).code).toBe("INVALID_JOB");
      expect((error as JobError).message).not.toContain("restore_check");
      expect((error as JobError).message).not.toContain("pw");
    }
  });
});
