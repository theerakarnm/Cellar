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

## Phase 7 - Restore and download
Tasks done: 12 plan tasks plus 8 fix tasks (haiku and glm).
Sonnet review rounds: 2 (no blockers).
Opus verdict: round 1 FAIL (1 blocker), round 2 PASS.
Round 1 blocker: a duplicate queue delivery of a restore killed the running container.
Fixed by claiming the restore row (queued to running) atomically before startJob.
A redelivery now acks without starting or stopping anything.
Opus verified duplicates, 3 concurrent deliveries and a lost started callback with its own scratch tests.
Other fixes: a backup claim is blocked while a restore into the same target is queued or running (owner answer 20, reverse direction).
deleteBackup refuses (409 backup_in_use) and retention skips a backup that a queued or running restore uses as its source, listed in RetentionResult.skipped.
acknowledgeOverwrite false is accepted for another target.
Error codes with digits are preserved.
Five restore-callback tests removed by a fix were restored.
Download URLs: SigV4 presigned, TTL at most 900 seconds, Cache-Control no-store, URL never logged or audited.
Opus checked the signature against botocore (30/30) and a live RustFS run (200, 403 when tampered, 403 after expiry).
Deviations: ApiError import path is lib/api-error.ts.
Docker is not installed, so the restore end-to-end through a real container was not run in this phase (it passed in Phase 4 on PG14 and PG17 under podman).
Deferred MINOR items: restore start double fault (start RPC fails after the container started and stopJob also fails) can let a retry stop a live container.
Terminal callbacks still apply to queued rows, so a late failed from a stopped first container could turn a retryable start into a final failure (suggest accepting succeeded and failed on running only).
Deleting a target with an active restore into it returns 204.
A backup requested during a restore waits and can fail with queue_timeout plus an alert.
Restore busy check is not atomic (tiny window).
Sweeper code TIMEOUT differs from the backup codes.
Plan doc gotcha lines 1323 and 1354 are stale.

## Phase 8 - Alerts (LINE, Discord, staleness)
Tasks done: 13 plan tasks plus 3 fix tasks (haiku and glm).
Sonnet review rounds: 3 (no findings in the last).
Opus verdict: round 1 FAIL (1 blocker), round 2 PASS.
Round 1 blocker: the Discord webhook check accepted custom ports, userinfo and /api/v10/ paths, which broke the locked rule that URLs must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/.
Fixed: exact-prefix check on the normalized href, the normalized URL is stored and sent.
The test that asserted /api/v10/ is accepted was flipped (correction to the locked rule, not a weakening).
Other fixes: the sweeper stops the container before waiting on an alert (a hung webhook no longer delays it), no alert for a soft-deleted target, a callback test now asserts its status.
Opus checked: no credential leak with a hostile server or a throwing fetch, failure counters exact under concurrency with exactly one consecutive-failures alert, callback answers in 22 ms with a hung webhook, staleness edge cases.
Deviations: alert sends use a 10 second timeout and do not follow redirects (documented in docs/alerts.md).
The LINE push endpoint was checked against LINE docs only partly.
Real LINE and Discord delivery was NOT run (needs real tokens and a webhook).
Deferred MINOR items: later rows in the same sweep still wait about 20 s each on a hung webhook.
max(512) on the webhook URL is checked before normalization.
Re-enabling a long-disabled target sends a stale alert on the next tick.
The notify hook is not idempotent per backup id (all call sites gate on the applied update).
Staleness runs inside the cron after runCronTick steps (each step is wrapped).
Owner action: set APP_BASE_URL for the deployed Worker, create channels, and send a test message from the UI or POST /api/alert-channels/:id/test to confirm real delivery.

