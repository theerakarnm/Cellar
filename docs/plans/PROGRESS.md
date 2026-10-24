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
