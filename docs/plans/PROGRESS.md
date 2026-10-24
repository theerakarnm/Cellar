# Cellar build progress

## Phase 1 - Foundation

Status: complete.

Tasks done: 5.
- haiku: 3 tasks (scaffold, schema, access).
- glm: 2 tasks (crypto, redact).

Sonnet review rounds: 1.
No blockers from sonnet review.
Opus verdict: PASS (round 1).

Commit style: one commit per task plus a phase commit.

Deferred MINOR items (address in later phases):
- redact misses a raw single quote inside a URL password.
- redact does not cover webhook/service-token secrets.
- malformed token a.b.c logs 'verification error' (cosmetic).

## Phase 2 - Targets CRUD API and Audit Log

Tasks done: 16 (haiku: 7, glm: 9).
Sonnet review rounds: 1 (no blockers).
Opus verdict: PASS (round 1).

Deferred MINOR items:
- Concurrent same-name POST returns 500 and leaks D1 error text. Map UNIQUE to 409 and use a generic 500 message.
- cron and timezone fields have no max length.
- parseBody accepts text/plain (possible CSRF angle, uncertain).
- A no-op PATCH with tunnel:{} is audited.
- Some validation messages echo submitted values (cron, channel ids).
- uuidv7 is not monotonic within the same millisecond, so audit order can tie.
- Name-unique race, see first item.

## Phase 3 - GFS Retention Function

Tasks done: 5 (haiku: 1, glm: 4).
Sonnet review rounds: 1 (no blockers).
Opus verdict: PASS (round 1).

Deferred MINOR items:
- An invalid now with max_age_days set gives NaN, so everything except the latest is deleted with no error.
Suggest throwing RangeError.
- The plain-object reasons map breaks on ids like toString or __proto__ (cannot happen with UUIDv7).
- Phase 6 note: started_at is nullable, new Date(null) is 1970, and a non-Z SQLite datetime parses in host-local time.
The Phase 6 mapper must pass ISO-Z strings.
- Comparator tiebreak on duplicate ids (harmless).

## Phase 4 - Container image and job runner
Status: opus PASS-with-human-gate-pending.
Task 2 (tunnel spike with the owner's real tunnel) and Task 18 (runner through the real tunnel) are NOT run. They need the owner's tunnel, Access TCP app, service token and Postgres.
Tasks 3-17 and 19 were built and verified against local fakes (podman, native arm64, Postgres 14 and 17, RustFS).
Tasks done: 16 plan tasks plus 8 fix tasks (haiku and glm).
Sonnet review rounds: 2 (no blockers in round 2).
Opus verdict: round 1 FAIL (3 blockers), round 2 PASS-with-human-gate-pending.
Verification: 24/24 docker e2e checks on PG14 and PG17, and the 2.19 GiB backup passed at 256m (OOMKilled=false, peak 210 MiB, native arm64).
Deviations from the plan:
- podman used instead of Docker (docker symlink in /tmp/cellar-bin).
- Restore picks pg_restore by the destination server major (replaces Decision 10), because pg_restore 17+ emits SET transaction_timeout.
- Backup streams pg_dump through a FIFO with --no-sync, because Bun does not apply backpressure to child stdout.
- restore.targetDbName must equal the database in db.url (INVALID_JOB, exit 1 with callback). Phase 7 must send the decoded dbName from the URL, not a sanitized name.
- Callback fetch has a 15 s timeout, abortMultipart a 30 s timeout, parseJob validates jobKey and callbackUrl.
Deferred items (see /tmp/cellar-p4-gate2.md): s3 pause() listener cleanup, cancel callback response bodies, restore guard before startTunnel, Decision 11 exit-code wording, restore memory proof before Phase 7, pg stderr tails may carry row data into callbacks, amd64 memory number unmeasured.
Pending for the owner: run Task 2 (SPIKE OK) and Task 18 before relying on the tunnel path.

## Phase 5 - Orchestration (cron, queue, container, callback)
Tasks done: 11 plan tasks plus 6 fix tasks (haiku and glm).
Task 1 (callback spike) was run but inconclusive, see below.
Sonnet review rounds: 2 (no blockers).
Opus verdict: round 1 FAIL (1 blocker), round 2 PASS with the container and outbound path unverified.
Round 1 blocker: the callback schema rejected hasReadAllData null from PG13 test jobs.
Fixed with a test using the real shape.
Also fixed: stopJob when startJob fails, re-send of a still-queued same-slot backup, failJob only for still-queued rows when the re-send fails.
Spike (Task 1): INCONCLUSIVE.
wrangler dev under podman cannot start the egress sidecar (crun: cannot set memory swappiness with cgroupv2), so the container never ran.
The outbound-handler callback path and the container-dependent manual e2e are NOT verified.
Default kept: empty CALLBACK_BASE_URL, outbound intercept, with the documented fallback config.
Confirm with Docker Desktop or on a deployed Worker.
Deviations: ApiErrorStatus gained 503 and 413.
lib/cursor.ts not created (Phase 2 pagination.ts has the helpers).
ApiError import path is lib/api-error.ts.
Deferred MINOR items (see /tmp/cellar-p5-gate1.md and gate2): sweeper stale-heartbeat update race, late success after timed_out keeps r2_key (hand off to Phase 6), no dead letter queue, audit written after queue send, blocked targets unlogged, byte-size check on queue messages, double catch around stopJob.
Owner decision needed: the default schedule is 02:00 for every target with max_concurrent_jobs 1 and a one-hour queue_timeout, so about 6 or more targets fail every night unless schedules are staggered or the limit is raised.

## Phase 6 - Retention runner (R2 and D1)
Tasks done: 11 plan tasks plus 2 fix tasks and 1 flaky-test fix (haiku and glm).
Sonnet review rounds: 1 (no blockers).
Opus verdict: PASS (round 1, 0 blockers).
Safety checks by opus: 18 adversarial scratch tests.
The latest successful backup is never deleted on any path (scheduled, after-backup, manual).
Dry run is ON by default.
R2 object is deleted first, then the D1 soft delete.
Fixed after the gate: the latest-success guard and the planner now share one ordering (compareBackupTime in plan.ts), with a zone-less timestamp regression test.
Fixed flaky test: the Phase 5 sweeper test created a new workerd per test and could time out under load.
It now creates one test env per file.
Local end-to-end (wrangler dev with --enable-containers=false, local D1 and R2): preview, dry run, live run, manual delete and audit rows all verified.
Deviations: wiring of the callback hook lives in routes/internal.ts.
ApiErrorStatus lacks 502, so r2_delete_failed is returned directly.
Deferred MINOR items: orphaned R2 objects for timed_out or failed rows with an r2_key (future phase or README note).
Persistently failing rows count against the 50 per run cap and can delay later deletions.
Manual delete also works on a soft-deleted target's backups (owner decision).
Phase 7 must guard deleteBackup against an active restore.
Stale comment in jobs/cron.ts.
target-jobs.ts listing sorts by a raw coalesce string (display only).
Owner action at deploy: retention deletes nothing until retention_dry_run is set to false.

