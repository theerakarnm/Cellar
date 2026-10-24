# Phases 2-10: cross-phase decisions register

Written 2026-10-24 for the planners of phases 2 to 10.
Phase 1 plan: `docs/plans/2026-10-24-phase-1-foundation.md` (final, includes the schema amendments below).
Phase PRDs: `docs/plans/prds/phase-N.md` (the owner's text, unchanged).

## How to use this file

1. Precedence when sources disagree: `AGENTS.md` locked decisions, then the owner answers recorded in `docs/PLAN.md`, then the phase PRD, then this file's resolutions.
   Where the PRD asks for something that conflicts with a locked decision or PLAN answer, this file records the resolution.
2. Items marked **ASK** need the owner's confirmation before that phase is executed. The phase plan must list them in its header and in its final summary section.
3. Every phase plan is written BEFORE the previous phases exist in the tree.
   Do not invent code locations. Take file paths, exports, and signatures from the earlier plans' `Produces:` blocks and from this file.
   Each plan starts with a **Phase gate** preflight: `bun run test && bun run typecheck` pass and the files it depends on exist (list them with `test -f`).
   If a gate file or export differs from what the plan says, STOP and report. The earlier phase moved.
4. All phase plans are single-track sequential (tracks would be below the cost floor). Say so in Execution.

## Owner answers, round 2 (binding, override any conflicting text below)

Answered 2026-10-24.
`docs/PLAN.md` and `AGENTS.md` were updated to match. The phase plans were NOT yet updated; each plan must be reconciled with this section before execution (see "Plan follow-ups" at the end of this section).

1. **Direct mode is removed.** Tunnel only. No `connection_mode` column, no enum, no check. Tunnel hostname and token fields are required and stay NOT NULL. Remove direct mode from docs too.
2. **Health:** `AGENTS.md` now says Access is verified on every request except `GET /api/health`. Health returns only `{ ok, version }`.
3. **Name reuse:** `targets.name` uses a partial unique index `uq_targets_name ON targets(name) WHERE deleted_at IS NULL`.
4. **Target stats:** Phase 2 adds `stats: { backupCount, totalBackupBytes }` to the target response, counting only non-deleted success backups.
5. **Phase 1 schema changes approved,** minus direct mode: `project_tag`, `target_alert_channels` (and `alert_channels.target_id` removed), `backups.duration_ms`, `backups.deleted_reason`, plus new `targets.alert_failure_threshold` (integer NOT NULL DEFAULT 3) and the partial unique name index. Tunnel columns stay NOT NULL.
6. **Shared code and root edits approved:** `src/shared/tz.ts` shared by Phases 2 and 3, and small root edits for tests and typecheck. Each phase summary lists them.
7. **Approved dependencies:** `wrangler`, `drizzle-kit`, `typescript`, `@cloudflare/workers-types` (Phase 1).
8. **Approved:** `@types/bun`, and RustFS as the local S3 stand-in (test and dev only, never in the production image).
9. **Approved:** `@types/react`, `@types/react-dom`.
10. **Not approved for v1:** `jsdom` and Testing Library. No UI tests; rely on API and unit tests. Logic stays in pure modules covered by unit tests. Browser walkthroughs by the agent are still allowed as Manual verifies.
11. **GitHub Actions approved in principle.** Use the latest major versions that actually exist (verify, do not assume v7) and pin each by commit SHA.
12. **Part size is 32 MiB at the 256 MB local limit,** as a config value. PLAN.md notes 32 MiB x 10,000 parts = 320,000 MiB (about 312 GiB, 335 GB) per dump. Document, never create, an R2 lifecycle rule that aborts incomplete multipart uploads after 1 day. No local disk.
13. **Container contract confirmed:** job JSON on stdin, entrypoint `bun run /app/entrypoint.ts`, Phase 4 exports `signCallback`. Phase 4 adds a contract test that Phase 5 reuses so the two cannot drift.
14. **`max_instances` = 2,** configurable.
15. Manual delete ignores dry run (explicit human action, audited).
16. Manual delete works on success backups only.
17. Retention skips soft-deleted targets.
18. Retention dry run stays on until the owner turns it off.
19. **Restore:** the typed destination target name is always required. `acknowledgeOverwrite: true` is additionally required when the destination is the source database (400 otherwise). UI and docs follow this.
20. Restore returns 409 when the destination has an active backup or restore.
21. Restores do not count toward `max_concurrent_jobs`. It defaults to `max_instances` - 1 (so 1).
22. The alert failure threshold and the staleness override live in target create/update (Phase 2). No separate alert-settings endpoint.
23. Discord webhooks: allow only `https://discord.com/api/webhooks/...` and `https://discordapp.com/api/webhooks/...`. Reject everything else.
24. **No testing of unsaved targets.** The form saves the target with `enabled = false`, then Test connection runs, then the user enables it. The UI shows this flow clearly.
25. Repo URL: `https://github.com/theerakarnm/cellar`.
26. Commit `scripts/check-readme.ts` and run it in CI.
27. Fix the README tagline to "Every Postgres, aged and kept safe." and fix "A backup is cellart if..." to "kept" in the Retention section.
28. The owner enables GitHub private vulnerability reporting.

### Plan follow-ups (not done yet)

- Phase 1 plan: remove `connection_mode` and the nullable tunnel columns from its schema, add `alert_failure_threshold` and the partial unique name index, change the unique-name wording, and update the expected counts (tables, indexes, `WHERE` lines). Its Task 6 doc edits to `docs/PLAN.md` and `AGENTS.md` are already applied, so Task 6 must be reduced.
- Phase 2: remove direct mode and Q-direct; add `alertFailureThreshold`; Q-stats and Q-name closed.
- Phase 4: part size 32 MiB (config), `@types/bun`, RustFS, contract test, lifecycle-rule note.
- Phase 5: `max_instances` 2, `max_concurrent_jobs` default 1, contract.
- Phases 6 and 7: answers 15 to 21.
- Phase 8: threshold in Phase 2 (drop the alert-settings endpoint), Discord host allowlist.
- Phase 9: drop the optional jsdom ASK, unsaved-target flow, remove direct mode.
- Phase 10: remove the direct mode warning, repo URL, committed check script and CI step, SHA-pinned actions, tagline fixes.

## Cross-cutting decisions (apply to every phase)

- **X1. Source layout.** Worker code in `src/worker/`, tests in `test/worker/`, code shared by Worker and UI in `src/shared/` (tests in `test/shared/`), UI in `ui/`, container in `container/`.
- **X2. Phase 1 interfaces** (from its plan): `Env` in `src/worker/env.ts`; `AppEnv = { Bindings: Env; Variables: { actorEmail: string } }` and `access()` in `src/worker/middleware/access.ts`; `app` (Hono<AppEnv>) in `src/worker/app.ts` (`/api/health` registered first, then `app.use("/api/*", access())`); default export `{ fetch: app.fetch }` in `src/worker/index.ts`; `encrypt(plaintext, keyBase64)` / `decrypt(payload, keyBase64)` in `src/worker/lib/crypto.ts`; `redactSecrets(input)` / `redactError(error)` / `REDACTED` in `src/worker/lib/redact.ts`; Drizzle tables in `src/worker/db/schema.ts`: `targets`, `backups`, `restores`, `alertChannels`, `targetAlertChannels`, `auditLogs`, `settings`.
  Scripts: `dev`, `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `db:generate`, `db:migrate:local`, `db:migrate:remote`, `deploy`. Never run `db:migrate:remote` or `deploy`.
- **X3. Schema amendments made in Phase 1** (differ from the original PLAN.md section 3; PLAN.md now includes them): `targets.project_tag` (nullable text); `targets.alert_failure_threshold` (integer NOT NULL DEFAULT 3); unique name index is partial (`WHERE deleted_at IS NULL`); `alert_channels.target_id` removed; new `target_alert_channels(target_id, channel_id)` (composite PK, many to many); `backups.duration_ms`; `backups.deleted_reason`. There is no `connection_mode` and tunnel columns stay NOT NULL.
  Later phases add columns or tables only by additive migrations (new file via `bun run db:generate -- --name <what>`; never edit an applied migration; never rely on a hard-coded migration number, run `ls migrations` at task start).
- **X4. Test harness for D1/R2/Queue.** No new dependency. Use `getPlatformProxy` from `wrangler` inside Vitest (Node), with `persist: false` and the repo's `wrangler.jsonc`. It returns working local `DB` (D1), `BACKUPS` (R2), and `JOBS` (Queue producer) bindings. Verified in a scratch project: it applies migrations by running each statement of `migrations/*.sql` (split on `--> statement-breakpoint`) with `env.DB.prepare(stmt).run()`, and R2 put/get and `JOBS.send` work. Phase 2 creates the shared helper `test/helpers/env.ts` exporting `createTestEnv(overrides?: Partial<Env>): Promise<{ env: Env; dispose(): Promise<void> }>` (migrates, sets a fake `ENCRYPTION_KEY`, `ACCESS_*`, `DEV_BYPASS: "true"`), and routes are tested with `app.request(url, init, env)` against `http://localhost/...`. Later phases reuse it. [uncertain: `getPlatformProxy` reads `.dev.vars` if present; the helper must pass explicit values so tests do not depend on it.]
- **X5. Zod.** `zod` is a listed dependency; Phase 2 adds it (`bun add zod`). No `@hono/zod-validator` (unlisted): write a small in-house `parseBody(c, schema)` / `parseQuery(c, schema)` helper in `src/worker/lib/validate.ts` that throws an `ApiError`.
- **X6. Errors.** `src/worker/middleware/error.ts` (Phase 2) registers `app.onError`: `ApiError(status, code, message, details?)` becomes `{ "error": { "code", "message", "details"? } }`; unknown errors become 500 `internal_error` with a redacted message (`redactError`). Validation failures are 400 `validation_error`. Not found is 404 `not_found`. Conflicts are 409 `conflict`.
- **X7. Pagination.** Lists use `?limit` (default 50, max 200) and `?cursor` (opaque base64url of the last sort key) and return `{ items, nextCursor: string | null }`.
- **X8. IDs.** UUIDv7 from `src/worker/lib/uuidv7.ts` (`uuidv7(now?: number): string`, built in Phase 2, with unit tests, no dependency, `crypto.getRandomValues`).
- **X9. Time zones and cron are in-house, no dependency.** Phase 2 creates `src/shared/tz.ts` (uses `Intl.DateTimeFormat`): `isValidTimeZone(tz: string): boolean`, `getZonedParts(date: Date, tz: string): { year; month; day; hour; minute; second; weekday }` (weekday 1=Mon..7=Sun), `zonedTimeToUtc(parts, tz): Date` (local wall time to instant; documented behavior for DST gaps and overlaps), and `src/shared/cron.ts`: `validateCron(expr: string): string | null` (error message or null), `nextRun(expr: string, tz: string, after: Date): Date` (strictly after), `approxIntervalMs(expr, tz, after: Date): number` (gap between the next two runs). Phase 3 IMPORTS `getZonedParts` from `src/shared/tz.ts` (importing is allowed; Phase 3 only modifies `src/worker/retention/`).
- **X10. Audit helper.** `src/worker/lib/audit.ts`: `writeAudit(db, entry: { actor: string; action: string; entityType: string; entityId?: string | null; details?: unknown; ip?: string | null }): Promise<void>`; `details` is passed through `redactSecrets(JSON.stringify(...))` first. (PLAN.md listed `middleware/audit.ts`; this replaces it, because it is a helper, not middleware.)
  Action names: `target.create`, `target.update`, `target.delete`, `backup.trigger`, `backup.download`, `backup.delete`, `restore.start`, `retention.delete`, `retention.delete_failed`, `alert_channel.create`, `alert_channel.update`, `alert_channel.delete`, `settings.update`.
- **X11. DB client.** `src/worker/db/client.ts`: `getDb(env: Env)` returns `drizzle(env.DB, { schema })`. Phase 2 creates it.
- **X12. Secrets in responses.** Target and channel responses never include `*_enc` columns or plaintext. Target connection info is exposed as `connection: { host, port, dbName, user }` plus booleans `hasRestoreUrl`, `hasTunnelToken`.
- **X13. Cron cadence.** One `* * * * *` trigger (owner answer 14 in PLAN). Where a PRD says "every 5 minutes", the plan uses every minute and updates that wording.
- **X14. Callback hmac single source.** `container/hmac.ts` (WebCrypto only, no Bun-specific API) is the single implementation. Phase 4 creates it; Phase 5's Worker code imports it via a relative path.
- **X15. Root wiring exception.** A phase whose PRD restricts the files it may touch (Phases 3 and 4) may still make the minimal root edits needed to include its new folder in `bun run test` and `bun run typecheck` (for example `vitest.config.ts` include, a `typecheck` script that also runs `tsc -p container`). Nothing else outside the allowed folders. List each such edit explicitly in the plan so approving the plan approves it.
- **X16. Dependency rule.** (Round 2: approvals are listed at the top of this file.) Any package not in AGENTS.md "Stack (locked)" or already approved in the Phase 1 plan needs owner approval: list it in a "Dependencies that need your approval" table at the top of the plan, as the Phase 1 plan does. Prefer not adding any.
- **X17. UI testing.** No `jsdom` or Testing Library in v1 (owner answer 10). Phase 9 keeps logic in pure modules tested with plain Vitest and verifies pages by driving a real browser (Manual verifies).
- **X18. Honest confidence.** Plans are written before their prerequisites exist, so line anchors and exact types cannot be checked. Cite earlier plans (file and section) as SOURCE for patterns and write "(planned, not yet in tree)". Derive the confidence score with the rubric in the writing-plans skill, subtract 2 for "anchors in files that do not exist yet" once, and say so in the header.

## Per-phase resolutions

### Phase 2 (targets CRUD + audit log)
- Builds, beyond the PRD list, the prerequisites named in X4 to X11 (uuidv7, tz, cron, validate helper, error handler, audit helper, db client, test env helper) and adds `zod`.
- Fields: PRD "name, project tag, connection_url, restore_connection_url, tunnel_hostname, tunnel token id/secret, cron, timezone, retention, enabled, alert channel ids" map to columns `name, project_tag, connection_url_enc, restore_url_enc, tunnel_hostname, tunnel_token_id_enc, tunnel_token_secret_enc, schedule_cron, timezone, keep_last, keep_daily, keep_weekly, keep_monthly, max_age_days, enabled`, and rows in `target_alert_channels`. Also accept optional `job_deadline_minutes`, `stale_after_hours`, and `alert_failure_threshold` (default 3).
- `db_name` column: derived from the connection URL path, then sanitized to `[A-Za-z0-9_-]` (other characters become `_`). It is not a request field.
- Defaults when omitted (owner answers): schedule `0 2 * * *`, timezone `Asia/Bangkok`, retention keep_last 3 / daily 7 / weekly 4 / monthly 6 / max_age_days null, `job_deadline_minutes` 120.
- Hostname + token id + token secret are required on create (400 otherwise). There is no direct mode.
- Alert channel ids: validate that each id exists in `alert_channels` (the table exists, CRUD comes in Phase 8); replace the set in `target_alert_channels` on update when the field is present; leave it unchanged when omitted. A target with no linked channel gets no alerts (Phase 8 must say this in its docs).
- DELETE: soft delete (`deleted_at`, `enabled` false, `next_run_at` null). The name can be reused afterwards. Backups and R2 untouched. 204. Deleted targets are hidden from list/get (404).
- `next_run_at` = `nextRun(schedule_cron, timezone, now)` on create and whenever cron, timezone, or enabled changes (null when disabled).
- Responses include `lastStatus`, `lastBackupAt`, `nextRunAt`, and `stats: { backupCount: number; totalBackupBytes: number }` computed from `backups` (status success, `deleted_at` null). Approved (owner answer 4).
- `GET /api/audit-logs?entityType&entityId&limit&cursor` newest first.
- `GET /api/me` (in PLAN.md section 4) is NOT built in this phase.

### Phase 3 (retention function)
- Signature kept as the PRD: `selectBackupsToDelete(backups: RetentionBackup[], policy: RetentionPolicy, now: Date, tz: string): { keep: RetentionBackup[]; delete: RetentionBackup[]; reasons: Record<string, string[]> }`. Types are defined in `src/worker/retention/types.ts` with the PRD's snake_case keys: `RetentionBackup = { id: string; status: string; created_at: string /* ISO UTC */ }`, `RetentionPolicy = { keep_last: number | null; daily: number | null; weekly: number | null; monthly: number | null; max_age_days?: number | null }`. `null` or `0` means the rule is off. Phase 6 maps DB columns to these keys (`keep_daily` becomes `daily`, and `created_at` is `backups.started_at`).
- Non-success backups are returned in neither `keep` nor `delete`.
- Day/week/month bucket = local calendar day, ISO week (Monday start, ISO week-year), calendar month in `tz`; "daily N" keeps the newest backup of each of the N most recent distinct local days that have a backup (so gaps do not count as days). Same for weekly and monthly. State this rule and the keep_last semantic (the N newest successes) in the plan and tests.
- Reason strings: `keep_last`, `daily`, `weekly`, `monthly`, `latest_success` (safety rule). `max_age_days` removes the age-based keeps only; it never removes the latest success.
- README example test: keep_last 3, daily 7, weekly 4, monthly 6 over 200 days of daily backups. The planner must compute the exact expected kept count with a throwaway script and put the number and the method in the plan. Read README.md to confirm the example exists; if the README gives a different example, use the README's.
- Tests live in `test/worker/retention/`. Uses `getZonedParts` from Phase 2 (X9).

### Phase 4 (container)
- Image `oven/bun:1.3.9-slim` (Debian slim) + postgresql-client 13-18 (from the PGDG apt repo) + `cloudflared`. Runner is TypeScript on Bun in `container/`. Uses an in-house SigV4 S3 client for R2/RustFS multipart (no AWS SDK; Bun's `S3Client` was rejected because its writer completes truncated uploads on error and has no abort). Part size is a config value, default 32 MiB, and the local test runs at the 256 MB limit (answer 12). Add the `@types/bun` dev dependency (approved). Phase 4 adds a contract test (stdin JSON shape, entrypoint `bun run /app/entrypoint.ts`, `signCallback` signature format) that Phase 5 reuses (answer 13).
- **First task: the tunnel spike** (owner answer 1), local only: the container runs `cloudflared access tcp --hostname ... --url 127.0.0.1:PORT --service-token-id ... --service-token-secret ...` against a real tunnel and Access app that the owner provides, then `SELECT version()`. That needs a real Cloudflare Access app and tunnel, so the task is a `Verify - Human` gate with credentials passed by environment only, never written to a file. If it fails, STOP and report; do not build the Worker-side proxy or the VM agent without approval. The outbound-handler half of the spike moves to Phase 5 (it needs a Worker).
- Local verification as in the PRD: `test/docker-compose.test.yml` (Postgres 14 and 17, RustFS; test and dev only), test/backup/restore on both versions, row-count comparison, ~2 GB DB streamed with a 256 MB memory limit. Preflight must include Docker running, free disk (about 10 GB), and ports.
- Job input contract is PLAN.md section 5 (JSON on stdin or a file path argument; secrets never in argv). There is no direct mode; the tunnel block is always present.
- Hard timeout per job = `deadlineAt` from the payload (default 2 hours). Heartbeat callback every 30 s. Callback events `started | progress | succeeded | failed` per PLAN.md, HMAC headers `X-Cellar-Timestamp`, `X-Cellar-Signature`. `container/hmac.ts` is the single implementation (X14).
- Tests: runner logic (arg parsing, redaction, hmac, part sizing, tunnel readiness wait) as Vitest unit tests under `container/test/` wired by the X15 exception; integration checks by the compose file with shell/Bun scripts.
- Callback URL in local tests points to a tiny local HTTP listener started by the test script that verifies the HMAC.

### Phase 5 (orchestration)
- Cron is `* * * * *` (X13). The cron handler does, in order: enqueue due targets, run the stale sweeper, (Phase 6 later adds the daily retention run).
- Settings keys (code defaults, no seed rows): `max_concurrent_jobs` (default 2). Settings routes `GET /api/settings` and `PUT /api/settings` are built here (PLAN section 4; Phase 9's Settings page needs them; this is an addition to the PRD, flagged). `PUT` validates a known-key allowlist with Zod and writes an audit row `settings.update`. Phase 6 adds `retention_dry_run`.
- Test connection: `POST /api/targets/:id/test` returns `202 { testId }`; `GET /api/targets/:id/test/:testId` returns `{ status: "queued"|"running"|"success"|"failed"|"timed_out", result?, error? }`. This needs a new table `connection_tests (id, target_id, status, result_json, error_code, error_message, queued_at, started_at, finished_at, heartbeat_at)` via an additive migration. (PLAN had a synchronous `200`; the PRD allows polling.) Update PLAN.md.
- Queue message: `{ jobId, type: "backup"|"test", targetId }` ids only. The consumer is idempotent: a message whose row is not `queued` is acked and ignored. `max_batch_size: 1`.
- First task is the outbound-handler spike under `wrangler dev` (local container needs Docker). If it cannot be confirmed locally, the plan uses the public route `/internal/jobs/callback` with an Access bypass for that exact path; HMAC + timestamp (5 min window) + `seq` replay protection in both cases. The real deployed confirmation is a `Verify - Human` item for the owner and not required to finish the phase.
- `/internal/jobs/callback` is registered on the app OUTSIDE `/api/*`, so it is not behind the Access middleware (Phase 1 mounts Access only on `/api/*`). The job HMAC key is derived from `jobId` and `ENCRYPTION_KEY` (nothing stored), per PLAN.md section 5.
- R2 credentials for the container: bucket-scoped token stored as Worker secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, plus vars `R2_ENDPOINT`, `R2_BUCKET`; injected per job; never in queue messages or logs. Add to `Env` and `.dev.vars.example`. For local dev they point to RustFS from the Phase 4 compose file.
- Sweeper rules from PLAN.md section 6 (running: no heartbeat for 5 min or past deadline becomes `timed_out`; queued over 1 hour becomes `failed` with `error_code = queue_timeout`). Applies to `backups` and `connection_tests` (and `restores` once Phase 7 exists; Phase 7 extends it).
- `GET /api/targets/:id/backups?status&limit&cursor` newest first (`started_at` desc, falling back to `queued_at`).
- `schedule_slot` = the UTC ISO minute of the `next_run_at` being enqueued; the unique index on `(target_id, schedule_slot)` makes the insert idempotent (`INSERT ... ON CONFLICT DO NOTHING`, then enqueue only if a row was inserted). `next_run_at` advances to `nextRun(...)` from the slot time.
- Container class `JobRunner` in `src/worker/container/job-runner.ts` and `containers` / `durable_objects` / `migrations` (DO) blocks in `wrangler.jsonc` per `docs/research-notes.md`; `instance_type` is the single config value (default `basic`); `max_instances` is 2 (config value); `max_concurrent_jobs` defaults to `max_instances` - 1 = 1 (answers 14 and 21). Cron and Queue consumer handlers are added to `src/worker/index.ts` (`scheduled`, `queue`).

### Phase 6 (retention wiring)
- Maps DB rows to Phase 3 types (X-note above). Soft delete uses the existing `deleted_at` plus `deleted_reason` (the PRD says "status deleted"; `status` stays the job outcome and there is no `deleted` status value; flag this). Selection query: backups of the target with `status = 'success'` and `deleted_at IS NULL`.
- Deletes R2 first, then the D1 update; per-deletion audit `retention.delete` with `actor = "system"`; a failed R2 delete writes `retention.delete_failed`, leaves D1 unchanged, continues, and is reported in the return value `{ deleted: string[]; failed: { id; error }[]; dryRun: boolean }`.
- Setting `retention_dry_run` default `true`. Dry run logs decisions (redacted) and deletes nothing. Preview endpoint is `GET /api/targets/:id/retention-preview` (PRD) and replaces PLAN's `POST /api/targets/:id/retention/preview`.
- Triggers: after a successful backup callback (use `ctx.waitUntil` and never fail the callback), and once daily from the cron (guard with a `settings` row `retention_last_run_date` in the default timezone so it runs once per day). Bounded work per tick (for example 50 deletions) to respect Worker limits.
- Chunk D1 `IN (...)` lists to under 100 bound parameters (research-notes D1 limit).
- Extra from owner answer 10 (not in the PRD, flagged): `DELETE /api/backups/:id` with `{ confirm: true }` refusing the latest success, R2 first, soft delete, audit `backup.delete`. Share the single delete routine with `runRetention`.
- Uses the Phase 3 function unchanged.

### Phase 7 (restore and download)
- Request/response per the PRD: `{ destinationTargetId, confirmName }` where `confirmName` must equal the destination TARGET name. The destination database is the one in the destination target's `restore_url_enc`; `restores.destination_db_name` is derived from it. No database is created. `sameDatabase` is true when `destinationTargetId` equals the backup's `target_id`; store it in `restores.is_source_overwrite`. The "extra warning" is a UI concern (Phase 9). Round 2 (answer 19): `acknowledgeOverwrite: true` is ALSO required when `destinationTargetId` equals the backup's target (400 otherwise). PLAN.md already reflects this. The API returns 409 when the destination has an active backup or restore (answer 20). Restores do not count toward `max_concurrent_jobs` (answer 21).
- Restore reuses Phase 5's queue, container, and callback; extend message type to `restore`, the callback to update `restores`, and the sweeper to cover `restores`.
- Presigned GET: in-house AWS SigV4 query-string signing in `src/worker/lib/s3-presign.ts` (WebCrypto, no dependency) using the R2 S3 credentials from Phase 5; expiry = `min(settings.download_url_ttl_seconds, 900)`, default 900. Response `{ url, expiresAt }`. Only for `success` backups with `deleted_at` null.
- Also `GET /api/restores` (list, `?targetId`) and `GET /api/restores/:id`; audit actions `backup.download`, `restore.start`.
- Local end-to-end uses the Phase 4/5 local setup (RustFS). Restoring is destructive: the e2e must target a scratch database.

### Phase 8 (alerts)
- Channel credentials encrypted as JSON: `line` = `{ "token": "...", "to": "..." }`, `discord` = `{ "webhookUrl": "..." }`. Responses show `hasCredential: true` and nothing else about the secret.
- Per-target settings: `alert_failure_threshold` (integer, default 3) and `stale_after_hours` both live in Phase 2's target create/update (answer 22; there is NO separate alert-settings endpoint) (null = derive from schedule: `approxIntervalMs + 2h`, so daily = 26 h). Episode state columns on `targets` (additive migration): `consecutive_failures` (integer default 0), `failure_alerted_at` (text), `stale_alerted_at` (text). Rules: a failure or timeout increments the counter and fires the "failed" alert every time; reaching the threshold fires the "N consecutive failures" alert once until a success resets the counter; staleness fires once per episode (`stale_alerted_at` set) and resets on the next success.
- Channel selection: channels linked to the target in `target_alert_channels`, `enabled`, and whose `events` JSON includes the event name (`backup_failed`, `backup_stale`, `backup_consecutive_failures`; the column also allows `retention_failed` and `restore_finished` but this phase does not emit them).
- LINE push: check current LINE Messaging API docs for the push endpoint and body (the `line-messaging` skill at `~/.agents/skills/line-messaging/SKILL.md` documents it); Discord webhook JSON `{ "content": "..." }` (check Discord docs for limits). Webhook URLs must start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`; reject everything else (answer 23). Mark [uncertain] if unconfirmed.
- Messages: target name, project tag, event, redacted error summary (`redactError`, plus a hard length cap), time formatted in the target timezone, link `${APP_BASE_URL}/targets/${id}`. `APP_BASE_URL` is a new var (document in `.dev.vars.example`).
- Alerts are sent through a helper that catches everything, logs a redacted line, and is called with `ctx.waitUntil`; it must never throw into the callback or cron.
- Staleness check runs in the per-minute cron but is cheap (one query) and idempotent.

### Phase 9 (UI)
- Stack: React, React Router, Vite without `@vitejs/plugin-react` (not approved; Vite's built-in esbuild handles JSX) plus `@types/react` and `@types/react-dom` (approved), a small fetch wrapper in `ui/src/api/`. Built to `dist/ui` and served via Workers Static Assets: add an `assets` block to `wrangler.jsonc` (`directory: dist/ui`, SPA fallback, `run_worker_first` for `/api/*` and `/internal/*`). Zod schemas from `src/shared/` are reused for client-side form validation.
- `bun run dev` must serve UI and API together without a new dependency (for example `vite build --watch` plus `wrangler dev` started by a small script, or a Vite dev server with a proxy to `wrangler dev`). The planner picks one, verifies it in a scratch project first, and writes the choice down.
- First task: **API gap check** that lists every endpoint the pages need against what Phases 2-8 produce and STOPs if anything is missing (owner rule: do not change API behavior). Known inputs: target `stats` (Phase 2, approved), settings routes (Phase 5), restores list (Phase 7), alert channels (Phase 8), retention preview (Phase 6).
- Pure logic (time formatting in target tz, status classification for red highlighting, masked-field display) in `ui/src/lib/` with plain Vitest tests; pages verified with a real browser (Playwright or the Chrome extension) at 375 px and 1440 px in the end-to-end section. No `jsdom` or Testing Library (answer 10). Test connection works on saved targets only: the form saves with `enabled = false`, then Test connection, then the user enables the target (answer 24). Follow AGENTS.md style: pixel-level care, fix anything visibly off.
- Secrets fields are write-only (show "set" / "not set").
- Same-database restore dialog shows the extra warning when the destination target equals the backup's target (the API returns `sameDatabase`).

### Phase 10 (docs and OSS files)
- `LICENSE` (MIT) and a long `README.md` already exist at the repo root. Read both first. Do not overwrite LICENSE if it is already MIT; update README to match the code.
- Includes a scripted README cross-check: extract every `bun run <script>`, `wrangler` command, env var, and route from README and docs, and verify against `package.json`, `wrangler.jsonc`, `.dev.vars.example`, and the route files. Commit it as `scripts/check-readme.ts` and run it in CI (answer 26). Repo URL is `https://github.com/theerakarnm/cellar`. Fix the tagline to "Every Postgres, aged and kept safe." and "cellart" to "kept" in the Retention section (answer 27). GitHub Actions: use the latest major versions that actually exist (verify), pinned by commit SHA (answer 11). The owner enables private vulnerability reporting (answer 28).
- There is no direct mode; do not mention one. Explain the Access bypass for `/internal/jobs/callback` if Phase 5 chose it, the R2 token scoping, the `cloudflared` compose snippet, backup role SQL for PG13 (`GRANT pg_read_all_data` does not exist before PG14: the plan must give the PG13 alternative using explicit per-schema grants) and PG14+, restore role guidance, restore runbook (UI and manual `pg_restore`), CI workflow using Bun (`bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`).
- No private hostnames, account IDs, or tokens anywhere. Use `example.com` style placeholders.

## Plan file requirements (all planners)

- Path: `docs/plans/2026-10-24-phase-N-<slug>.md` with the slugs: 2 `targets-crud-audit-log`, 3 `gfs-retention-function`, 4 `container-image-job-runner`, 5 `orchestration-cron-queue-callback`, 6 `retention-runner-r2-d1`, 7 `restore-and-download`, 8 `alerts-line-discord-staleness`, 9 `react-ui`, 10 `docs-and-oss-files`.
- Follow `/Users/jametirakarn/.agents/skills/writing-plans/plan-template.md` exactly and the process and rules in `/Users/jametirakarn/.agents/skills/writing-plans/SKILL.md`, and pass `/Users/jametirakarn/.agents/skills/writing-plans/self-review-checklist.md`. Use `Phase N: <name> Implementation Plan` as the title. Include the "Phase gate" preflight, a "Decisions that differ from the PRD / docs/PLAN.md" section, a "Dependencies that need your approval" table (only if non-empty), and the ASK list.
- Write reference code in steps (real, complete, consistent with the Phase 1 code style: strict TypeScript, `noUncheckedIndexedAccess`, Hono with `AppEnv`, Drizzle with the schema in the Phase 1 plan). You cannot run it against the repo (the code does not exist yet). You MAY validate pure logic (cron, tz, retention, hmac, presign) in a scratch directory under `/tmp/phase-N-scratch` and paste only code you ran. Say in the plan which snippets were run in scratch and which were not.
- Final task of every plan: update `docs/PLAN.md` where this phase changes it (list exact edits), then end with the AGENTS.md phase summary (✅ / 🧪 / ⚠️).
- Every phase ends with `bun run test` and `bun run typecheck` passing (AGENTS.md).
- No em dash anywhere. Plain hyphen only. One sentence per line in prose where practical.
- Do not edit any file except your own plan file and your own scratch directory. Do not spawn agents. Do not run `wrangler deploy`, remote commands, or anything that creates a Cloudflare resource.
- When done, write nothing else, and send the parent one `agent_message` line: plan path, task count, confidence with arithmetic, top risk, and any ASK items.
