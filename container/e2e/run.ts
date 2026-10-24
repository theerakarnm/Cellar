// Functional check of the runner against Postgres 14 and 17 and an S3 stand-in. Needs Docker. Run from the repo root:
//   bun container/e2e/run.ts
import {
  PG_PASSWORD, baseJob, check, compose, objectDigest, psql, r2Block, runRunner, startCallbackListener, startStack, type CallbackEvent,
} from "./support";

const VERSIONS = [14, 17] as const;
const TABLES = ["customers", "orders", "events", "order_totals"];

const listener = startCallbackListener();
const terminal = (events: CallbackEvent[]) => events.find((event) => event.event === "succeeded" || event.event === "failed");

async function counts(service: "pg14" | "pg17", database: string): Promise<string> {
  return psql(service, database, TABLES.map((table) => `select '${table}=' || count(*) from ${table}`).join(" union all ") + " order by 1");
}

try {
  const build = await compose(["--profile", "runner", "build", "runner"]);
  check(build.code === 0, "runner image builds");
  await startStack(["pg14", "pg17", "s3"]);

  for (const version of VERSIONS) {
    const service = `pg${version}` as "pg14" | "pg17";
    const url = (database: string, password = PG_PASSWORD) => `postgres://cellar:${password}@${service}:5432/${database}`;
    const label = `PG${version}`;
    const key = `backups/e2e/${version}/dump.dump`;

    const testRun = await runRunner({ jobId: `test-${version}`, job: baseJob(listener, `test-${version}`, "test", url("shop")) });
    const testEvents = listener.eventsFor(`test-${version}`);
    check(testRun.code === 0 && terminal(testEvents)?.event === "succeeded", `${label} test job succeeds`);
    check(String(terminal(testEvents)?.result?.pgServerVersion).startsWith(`${version}.`), `${label} test job reports server version ${version}.x`);
    check(Number(terminal(testEvents)?.result?.dbSizeBytes) > 0, `${label} test job reports the database size`);

    const backupRun = await runRunner({ jobId: `backup-${version}`, job: baseJob(listener, `backup-${version}`, "backup", url("shop"), { r2: r2Block({ key, partSizeBytes: 5 * 1024 * 1024 }) }) });
    const backupResult = terminal(listener.eventsFor(`backup-${version}`));
    check(backupRun.code === 0 && backupResult?.event === "succeeded", `${label} backup job succeeds`);
    const stored = await objectDigest(key);
    check(backupResult?.result?.sha256 === stored.sha256 && backupResult?.result?.sizeBytes === stored.bytes, `${label} callback sha256 and size match the stored object`);

    await psql(service, "postgres", "drop database if exists restore_check");
    await psql(service, "postgres", "create database restore_check");
    const restoreRun = await runRunner({ jobId: `restore-${version}`, job: baseJob(listener, `restore-${version}`, "restore", url("restore_check"), { r2: r2Block(), restore: { sourceKey: key, targetDbName: "restore_check" } }) });
    check(restoreRun.code === 0 && terminal(listener.eventsFor(`restore-${version}`))?.event === "succeeded", `${label} restore job succeeds`);
    const [source, restored] = [await counts(service, "shop"), await counts(service, "restore_check")];
    check(source === restored && source.includes("orders=20000"), `${label} restored row counts equal the source (${source.replaceAll("\n", ", ")})`);

    const badPassword = "wrong-password-xyz";
    const authRun = await runRunner({ jobId: `auth-${version}`, job: baseJob(listener, `auth-${version}`, "test", url("shop", badPassword)) });
    const authResult = terminal(listener.eventsFor(`auth-${version}`));
    check(authRun.code === 1 && authResult?.error?.code === "AUTH_FAILED", `${label} wrong password fails with AUTH_FAILED and exit code 1`);
    check(!JSON.stringify(authResult).includes(badPassword) && !authRun.stdout.includes(badPassword) && !authRun.stderr.includes(badPassword), `${label} wrong password never appears in the callback or output`);
  }

  const badKeyRun = await runRunner({
    jobId: "s3-bad",
    job: baseJob(listener, "s3-bad", "backup", `postgres://cellar:${PG_PASSWORD}@pg17:5432/shop`, { r2: r2Block({ key: "backups/e2e/bad.dump", partSizeBytes: 5 * 1024 * 1024, secretAccessKey: "not-the-real-secret" }) }),
  });
  const badKey = terminal(listener.eventsFor("s3-bad"));
  check(badKeyRun.code === 1 && badKey?.error?.code === "UPLOAD_FAILED" && !JSON.stringify(badKey).includes("not-the-real-secret"), "bad R2 secret fails with UPLOAD_FAILED, redacted");

  const expiredRun = await runRunner({
    jobId: "expired",
    job: { ...baseJob(listener, "expired", "test", `postgres://cellar:${PG_PASSWORD}@pg17:5432/shop`), deadlineAt: new Date(Date.now() - 1000).toISOString() },
  });
  check(expiredRun.code === 1 && terminal(listener.eventsFor("expired"))?.error?.code === "TIMEOUT", "a job past its deadline fails with TIMEOUT");

  const invalidRun = await runRunner({ jobId: "invalid", job: { type: "explode" } });
  check(invalidRun.code === 2 && invalidRun.stderr.includes("Invalid job"), "an invalid job exits with code 2");

  const seqs = ["test-14", "backup-17"].flatMap((id) => listener.eventsFor(id).map((event) => event.seq));
  check(seqs.length > 0 && listener.invalidCount() === 0, `every callback carried a valid HMAC (${seqs.length} events checked, ${listener.invalidCount()} rejected)`);
} finally {
  listener.stop();
  await compose(["--profile", "runner", "down", "-v"]);
}
