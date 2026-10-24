# Phase 7: Restore and Download Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-7-restore-and-download.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE task 1 and report anything down.
> This plan was written BEFORE Phases 2 to 6 exist in the tree. Every path or export from those phases is "(planned, not yet in tree)"; the Phase gate table and the Cross-phase assumptions list them.
> The code in the steps is a reference implementation. Only `s3-presign.ts`, `restore-rules.ts`, and the SQL idioms were run (in `/tmp/phase-7-scratch`, see "Scratch runs"). Round 2 edits only renamed a test title in `s3-presign.test.ts` (re-run, 4 passed); the new and changed route, runner, and fixture snippets were never compiled.
> Everything else was never compiled. When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Let an operator download a backup through a short-lived presigned R2 URL and restore a backup into a registered target's existing database, with typed-name confirmation, a restore job row, queue and container orchestration, callbacks, sweeper coverage, and audit rows.
**Architecture:** Two new Hono sub-apps (`backupActions` at `/api/backups`, `restoresRoutes` at `/api/restores`) sit behind the Phase 1 Access middleware. A restore is a row in `restores` plus a queue message `{ jobId, type: "restore", targetId }`. A new `runRestoreJob` starts the Phase 4 container with the destination target's restore URL. New small modules handle restore callbacks and the restore sweeper, and one-line hooks connect them to the Phase 5 callback handler, queue consumer, and sweeper. Presigned URLs use an in-house SigV4 query signer (WebCrypto, no dependency).
**Tech Stack:** Bun 1.3, TypeScript (strict, `noUncheckedIndexedAccess`), Hono, Drizzle ORM on D1, Zod (added in Phase 2), Vitest with `getPlatformProxy` (Phase 2 `createTestEnv`).
**Spec:** `docs/plans/prds/phase-7.md` (owner's PRD), resolved by `docs/plans/2026-10-24-phases-2-10-decisions.md` ("Phase 7", X1 to X18, and "Owner answers, round 2", which is binding), `AGENTS.md`, and `docs/PLAN.md` sections 3 to 6.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`). The tree at that commit holds only the planning documents. The executor's HEAD will be much later (Phases 1 to 6 merged), so every "(planned)" anchor describes the plans, not code. When one does not match, run `git log --oneline 5f7ddc8..HEAD` to tell "the plan was wrong" from "the phase moved".
**Confidence:** 6/10. Rubric: start 10, minus 2 because anchors point into files that do not exist yet (register X18), minus 2 because Preflight checks for the local RustFS stack, scratch databases, and the Phase gate script could not be run while planning (Docker is not installed on the planning machine, and Phases 1 to 6 are not in the tree). No other deductions: every Consumes entry has a full signature, there are no Human verifies, no NOT-building cut rests on an unproven codebase claim, and the schema task lists its consumers. Below 7, so execution is single-track sequential. Biggest uncertainty: the exact names Phase 5 gives its dispatch, callback, consumer, and sweeper code (see "Cross-phase assumptions").
**NOT building:**
- UI, restore dialog, extra overwrite warning (Phase 9). The API enforces `acknowledgeOverwrite` and returns `sameDatabase`.
- Creating databases. Restore needs an existing database (AGENTS.md, PLAN.md section 4).
- A default destination. `destinationTargetId` is required.
- Cancel, retry, or delete endpoints for restores.
- Counting restores toward `max_concurrent_jobs` (owner answer 21: restores do not count).
- Direct connection mode (removed by owner answer 1: tunnel only; the restore job always starts the tunnel).
- Checking dump and server major versions before a restore (a PG 17 dump into a PG 13 server fails inside `pg_restore`; the failure arrives as a `failed` callback).
- Alerts for restore results. Phase 8 does not emit `restore_finished`.
- `response-content-disposition` on the presigned URL. [uncertain: not confirmed in the R2 docs; the file name is the last key segment.]
- Presigned URLs for per-part container uploads (PLAN.md section 5 calls this a future step).
- Changes to the container `restore` command (Phase 4) or to the backup flow (Phases 5 and 6).
- Any `wrangler deploy`, remote migration, or Cloudflare resource creation.

## ASK - owner confirmation needed before execution

No open owner questions.

**Closed by owner (round 2):**

- Q-overwrite-ack: answer 19. The typed destination target name is always required. `acknowledgeOverwrite: true` is also required when the destination is the backup's own target (400 otherwise). Task 7 enforces it.
- Q-busy: answer 20. 409 when the destination has an active backup or restore. The reverse (a backup starting while a restore runs) is still a Phase 5 consumer rule.
- Q-concurrency: answer 21. Restores do not count toward `max_concurrent_jobs` (default `max_instances` - 1, so 1). If the container pool is full, the container start fails and the queue retries (3 attempts, then the restore becomes `failed` with `start_failed`).
- Direct mode: answer 1. Removed everywhere. The destination always has tunnel settings (NOT NULL).

## Cross-phase assumptions (to confirm when plans are reconciled)

These are not owner questions. They are guesses about earlier plans that did not exist when this plan was written.

- **A1. Phase 5 dispatch module.** `src/worker/jobs/dispatch.ts` exports `TUNNEL_LOCAL_PORT`, `ContainerJobPayload`, `getCallbackUrl`, `deriveJobKey`, `toTunnelDbUrl`, `startContainer`, `stopContainer` with the signatures in the Phase gate table. `src/worker/jobs/types.ts` exports `JobMessage`. Names come from PLAN.md sections 2 and 5 and register Phase 5. The gate STOPs if one is missing.
- **A2. Replay `seq` storage.** Phase 5 keeps the last seen callback `seq` in an integer column `last_seq` (NOT NULL DEFAULT 0) on each job row. Phase 1's schema has no such column on `restores`, so Task 3 adds it by an additive migration. The gate STOPs if Phase 5 chose another mechanism.
- **A3. Settings route.** `PUT /api/settings` in `src/worker/routes/settings.ts` validates a key allowlist with Zod and accepts a partial object. Task 6 adds `download_url_ttl_seconds` to it.
- **A4. Phase 2 helpers.** `ApiError` is exported from `src/worker/middleware/error.ts`; `parseBody(c, schema): Promise<T>` and `parseQuery(c, schema): T` from `src/worker/lib/validate.ts`; `writeAudit`, `getDb`, `uuidv7`, `createTestEnv` per register X5, X6, X8, X10, X11, X4. If Phase 2 also exported a cursor helper (check `grep -rn nextCursor src/worker/lib`), Task 11 uses it instead of its private `encodeCursor` and `decodeCursor` and records a `> Deviation:`.

## Decisions that differ from the PRD / docs/PLAN.md

1. **Restore request body** is `{ destinationTargetId, confirmName, acknowledgeOverwrite? }` (register Phase 7 plus owner answer 19). PLAN.md's `destinationDbName` and `confirmDbName` are dropped. `acknowledgeOverwrite` must be the literal `true` when the destination is the backup's own target (400 `validation_error` otherwise); it is optional and ignored otherwise. `confirmName` must equal the destination TARGET name exactly (case-sensitive, no trimming). The destination database name is derived from the destination target's restore URL and stored in `restores.destination_db_name`.
2. **Restore response** is `202 { restoreId, sameDatabase }` (PLAN.md: `{ restoreId }`). `sameDatabase` is also stored in `restores.is_source_overwrite`.
3. **Error codes.** Wrong `confirmName`, missing `acknowledgeOverwrite` for a same-database restore, unknown body keys, bad query: 400 `validation_error`. Destination without a restore URL: 400 `restore_url_missing`. Restore URL without a database name: 400 `restore_url_invalid`. Unknown backup, unknown or soft-deleted destination: 404 `not_found`. Backup not `success` or already deleted, destination busy: 409 `conflict`. Queue send failure: 503 `enqueue_failed`.
4. **Check order** in the restore route: body shape, backup exists and is available, destination exists, `confirmName`, `acknowledgeOverwrite` (same-database only), restore URL present, restore URL names a database, destination not busy. Each failure is tested in isolation.
5. **Backups of soft-deleted targets** can still be downloaded and restored from (AGENTS.md: soft delete keeps R2 data and history). A soft-deleted target cannot be a restore destination.
6. **New column `restores.last_seq`** and **new unique partial index** `uq_restores_active_destination` (one queued or running restore per destination target). The index makes the busy check atomic. Both ship in one additive migration (register X3).
7. **New optional env var `R2_REGION`** (default `auto`). Local RustFS needs `us-east-1`. R2 uses `auto`. Documented in `.dev.vars.example`.
8. **Settings allowlist** gains `download_url_ttl_seconds` (integer 1 to 900). The signed lifetime is `min(setting, 900)`; a missing or unusable value means 900.
9. **Routes live in new files** (`routes/backup-actions.ts`, `routes/restores.ts`) so Phases 5 and 6 own `routes/backups.ts` alone. PLAN.md section 2 lists them under `routes/`.
10. **The restore job id is the restore row id.** The callback `jobId` is `restores.id`. ids are UUIDv7, so a callback handler can try `backups`, then `restores`, by id.
11. **Audit.** `backup.download` (entity `backup`, details `{ targetId, expiresAt }`, never the URL) and `restore.start` (entity `restore`, details `{ backupId, destinationTargetId, destinationDbName, sameDatabase }`). The audit row is written before the URL is returned and before the queue send, so no download or restore is unaudited.
12. **Restore deadline** is `now + destination.job_deadline_minutes` at container start (the `restores` table has no deadline column). The sweeper recomputes it as `started_at + destination.job_deadline_minutes`.

Task 12 updates `docs/PLAN.md` to match.

## Global Constraints

- TypeScript everywhere; Bun is the package manager; `bun run test` runs Vitest. (AGENTS.md)
- Worker is Hono on Cloudflare Workers; D1 + Drizzle ORM; migrations live in `/migrations`; Zod validates every API input. (AGENTS.md)
- Source layout: Worker code in `src/worker/`, tests in `test/worker/`, shared test helpers in `test/helpers/`. (register X1)
- Auth: every `/api/*` route except `GET /api/health` runs behind the Access middleware. New routes mount after `app.use("/api/*", access())`. (AGENTS.md, Phase 1 plan)
- Connection URLs, tunnel service tokens, and alert credentials are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`). Never return them in plaintext after save. Never log them. (AGENTS.md)
- R2 credentials are a bucket-scoped token injected per job at runtime. Never bake them into the image, never log them, never put them in queue messages. (AGENTS.md)
- Redact connection strings and passwords from logs, errors, API responses, and alerts. (AGENTS.md)
- "Restore uses a separate restore-capable connection URL supplied by the user." Never fall back to `connection_url_enc` for a restore. (AGENTS.md)
- "Restore has no default destination." Restoring into the source database also needs `acknowledgeOverwrite: true`. A restore returns 409 when the destination has an active backup or restore. Restores do not count toward `max_concurrent_jobs`. (AGENTS.md, owner answers 19 to 21)
- Tunnel only: there is no `connection_mode` and no direct branch. Tunnel columns on `targets` are NOT NULL. (AGENTS.md, owner answer 1)
- No new dependency. Approved list: `wrangler`, `drizzle-kit`, `typescript`, `@cloudflare/workers-types`, `@types/bun`, `@types/react`, `@types/react-dom`, RustFS (local S3 stand-in, test and dev only). No `jsdom`, no Testing Library, no UI tests. (owner answers 7 to 10)
- Presigned download URLs expire in 15 minutes or less. (PRD, README)
- `confirmName` must exactly equal the destination target name, else 400. (PRD)
- Destination must have a restore connection URL, else 400 with a clear message. (PRD)
- Queue messages carry ids only. (PLAN.md section 5, register Phase 5)
- Only forward job state transitions; terminal states never change. (PLAN.md section 6)
- Later phases add columns only by additive migrations: new file via `bun run db:generate -- --name <what>`, never edit an applied migration, run `ls migrations` at task start. (register X3)
- Never run `db:migrate:remote`, `deploy`, or any `wrangler` command without `--local`. (AGENTS.md)
- IDs are UUIDv7 from `src/worker/lib/uuidv7.ts`; all times are UTC ISO-8601 text; columns are `snake_case`.
- No em dash in any file you write. Use a plain dash. Do not add the agent as co-author in commit messages.
- If the same step fails 3 times, stop and report what you tried. (AGENTS.md)

## Patterns to Mirror

All sources below exist today. They are plans, not code. "(planned)" marks the code the plans will produce.

### Hono sub-app typed with `AppEnv`, and Access mounted on `/api/*`
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:744 (AppEnv), :853 (createMiddleware<AppEnv>) -->
```ts
export type AppEnv = { Bindings: Env; Variables: { actorEmail: string } };
// under DEV_BYPASS on localhost:
c.set("actorEmail", "dev@localhost");
```
Routes in this plan are `new Hono<AppEnv>()`, read `c.get("actorEmail")`, and are mounted with `app.route("/api/<base>", sub)` after the Access middleware (planned, `src/worker/app.ts`, register X2).

### Drizzle table style and the `restores` table this plan extends
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:624-655 (restores), :617 (uniqueIndex with where) -->
```ts
export const restores = sqliteTable(
  "restores",
  {
    id: text("id").primaryKey(),
    sourceBackupId: text("source_backup_id").notNull().references(() => backups.id),
    destinationTargetId: text("destination_target_id").notNull().references(() => targets.id),
    destinationDbName: text("destination_db_name").notNull(),
    status: text("status", { enum: ["queued", "running", "success", "failed", "timed_out"] }).notNull(),
    actor: text("actor").notNull(),
    isSourceOverwrite: integer("is_source_overwrite", { mode: "boolean" }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedAt: text("queued_at"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
  },
  (t) => [
    index("idx_restores_destination").on(t.destinationTargetId, sql`${t.queuedAt} DESC`),
    index("idx_restores_source").on(t.sourceBackupId),
    index("idx_restores_status").on(t.status, t.heartbeatAt),
  ],
);
```
Indexes are `idx_<table>_<what>`, unique indexes `uq_<table>_<what>`, and partial indexes use `.where(sql`...`)`.

### Error handling
<!-- SOURCE: docs/plans/2026-10-24-phases-2-10-decisions.md, X6 -->
`ApiError(status, code, message, details?)` becomes `{ "error": { "code", "message", "details"? } }`. Unknown errors become 500 `internal_error` with `redactError`. Validation failures are 400 `validation_error`; not found 404 `not_found`; conflicts 409 `conflict`. Container error messages are stored only after `redactSecrets` (planned, `src/worker/lib/redact.ts`, Phase 1 Task 3).

### Tests
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:81 (app.request with env), docs/plans/2026-10-24-phases-2-10-decisions.md X4 -->
Vitest in Node. Routes are tested with `app.request("http://localhost/api/...", init, env)`. D1 and R2 come from `createTestEnv(overrides?)` which returns `{ env, dispose() }` (planned, `test/helpers/env.ts`, Phase 2). Test files mirror source paths under `test/worker/`.

## Phase gate

Phase 7 needs Phases 1 to 6 merged. Run this before Task 1.
If anything is reported missing or different, STOP and report: "the earlier phase moved". Do not patch around it.

The files and exports this plan consumes (all planned, not yet in tree):

| Path | Needed | Source |
|---|---|---|
| `src/worker/env.ts` | `Env` with `DB`, `BACKUPS`, `JOBS: Queue`, `ENCRYPTION_KEY`, `R2_ENDPOINT: string`, `R2_BUCKET: string`, `R2_ACCESS_KEY_ID: string`, `R2_SECRET_ACCESS_KEY: string` | Phase 1 Task 1, register Phase 5 |
| `src/worker/app.ts` | `app: Hono<AppEnv>`; Access mounted on `/api/*` | Phase 1 plan |
| `src/worker/db/schema.ts`, `db/client.ts` | tables `targets`, `backups`, `restores`, `auditLogs`, `settings`; `getDb(env: Env)` | Phase 1, register X11 |
| `src/worker/lib/crypto.ts`, `lib/redact.ts` | `decrypt(payload: string, keyBase64: string): Promise<string>`; `redactSecrets(input: string): string`; `redactError(error: unknown): string` | Phase 1 |
| `src/worker/lib/audit.ts` | `writeAudit(db, entry: { actor: string; action: string; entityType: string; entityId?: string \| null; details?: unknown; ip?: string \| null }): Promise<void>` | register X10 |
| `src/worker/lib/uuidv7.ts` | `uuidv7(now?: number): string` | register X8 |
| `src/worker/lib/validate.ts` | `parseBody<T>(c: Context, schema: ZodType<T>): Promise<T>`; `parseQuery<T>(c: Context, schema: ZodType<T>): T` | register X5 |
| `src/worker/middleware/error.ts` | `class ApiError extends Error { constructor(status: number, code: string, message: string, details?: unknown) }` | register X6 |
| `src/worker/jobs/types.ts` | `type JobMessage = { jobId: string; type: "backup" \| "test"; targetId: string }` | register Phase 5 |
| `src/worker/jobs/dispatch.ts` | `TUNNEL_LOCAL_PORT: number`; `interface ContainerJobPayload` (PLAN.md section 5 shape: `jobId`, `type`, `callbackUrl`, `jobKey`, `deadlineAt`, `db: { url; name }`, `tunnel: { hostname; tokenId; tokenSecret; localPort }` (always present), `r2: { endpoint; bucket; key; accessKeyId; secretAccessKey; partSizeBytes }`, `restore?: { sourceKey; targetDbName }`); `getCallbackUrl(env: Env): string`; `deriveJobKey(env: Env, jobId: string): Promise<string>`; `toTunnelDbUrl(url: string, localPort: number): string`; `startContainer(env: Env, payload: ContainerJobPayload): Promise<void>`; `stopContainer(env: Env, jobId: string): Promise<void>` | PLAN.md section 5, register Phase 5 |
| `src/worker/jobs/consumer.ts`, `jobs/callback.ts`, `jobs/sweeper.ts` | queue consumer with a switch on `message.body.type`; verified-callback handler; `sweepStaleJobs(env: Env, now: Date)` entry called from the cron | register Phase 5 |
| `src/worker/container/job-runner.ts` | `JobRunner` Container class | register Phase 5 |
| `src/worker/routes/settings.ts` | `PUT /api/settings` with a Zod key allowlist | register Phase 5 |
| `test/helpers/env.ts` | `createTestEnv(overrides?: Partial<Env>): Promise<{ env: Env; dispose(): Promise<void> }>` | register X4 |
| `GET /api/audit-logs` | `?entityType&entityId&limit&cursor`, newest first | register Phase 2 |

- [ ] Step 1: Create the branch: `git switch -c phase-7-restore-and-download`
- [ ] Step 2: Run the gate script from the repo root:
```bash
missing=0
for f in src/worker/app.ts src/worker/env.ts src/worker/db/schema.ts src/worker/db/client.ts \
  src/worker/lib/crypto.ts src/worker/lib/redact.ts src/worker/lib/audit.ts src/worker/lib/uuidv7.ts src/worker/lib/validate.ts \
  src/worker/middleware/access.ts src/worker/middleware/error.ts src/worker/routes/settings.ts \
  src/worker/jobs/types.ts src/worker/jobs/dispatch.ts src/worker/jobs/consumer.ts src/worker/jobs/callback.ts src/worker/jobs/sweeper.ts \
  src/worker/container/job-runner.ts test/helpers/env.ts; do
  test -f "$f" || { echo "MISSING FILE $f"; missing=1; }
done
for s in TUNNEL_LOCAL_PORT deriveJobKey getCallbackUrl toTunnelDbUrl startContainer stopContainer ContainerJobPayload; do
  grep -Eq "export .*\b$s\b" src/worker/jobs/dispatch.ts || { echo "MISSING EXPORT $s in jobs/dispatch.ts"; missing=1; }
done
grep -Eq "export .*\bJobMessage\b" src/worker/jobs/types.ts || { echo "MISSING EXPORT JobMessage"; missing=1; }
grep -Eq "export .*\bApiError\b" src/worker/middleware/error.ts || { echo "MISSING EXPORT ApiError"; missing=1; }
for s in parseBody parseQuery; do grep -Eq "export .*\b$s\b" src/worker/lib/validate.ts || { echo "MISSING EXPORT $s"; missing=1; }; done
grep -Eq "export .*\bwriteAudit\b" src/worker/lib/audit.ts || { echo "MISSING EXPORT writeAudit"; missing=1; }
grep -Eq "export .*\bgetDb\b" src/worker/db/client.ts || { echo "MISSING EXPORT getDb"; missing=1; }
grep -Eq "export .*\buuidv7\b" src/worker/lib/uuidv7.ts || { echo "MISSING EXPORT uuidv7"; missing=1; }
grep -Eq "export .*\bcreateTestEnv\b" test/helpers/env.ts || { echo "MISSING EXPORT createTestEnv"; missing=1; }
for v in R2_ENDPOINT R2_BUCKET R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  grep -q "$v" src/worker/env.ts || { echo "MISSING Env.$v"; missing=1; }
done
grep -rEq "last_seq|lastSeq" src/worker/db/schema.ts || { echo "MISSING backups.last_seq (replay seq column) in schema.ts"; missing=1; }
[ "$missing" = 0 ] && echo "GATE OK"
```
- [ ] Step 3: Record the baseline and how Phase 5 stores `seq` (these feed Tasks 3 and 9):
```bash
ls migrations | tail -5
grep -rn "last_seq\|lastSeq" src/worker migrations | head -8
bun run typecheck; bun run test 2>&1 | tail -6
```
- [ ] Step 4: Verify - Run: the gate script from Step 2 - Expected: the last line is `GATE OK` and no `MISSING` line is printed. Also `bun run typecheck && bun run test` must exit 0 (AGENTS.md: a phase starts green).

(No commit: this task changes no files.)

## Preflight

### DURABLE - true until the repo itself changes

- **D1, R2, and Queue producer work in Vitest without a new dependency.** `getPlatformProxy` with `persist: false` was verified in a scratch project (register X4). Consequence: route tests use real local D1; the queue is replaced by `fakeQueue()` so messages can be read back.
- **The SQL idioms this plan relies on work in SQLite.** Scratch run `/tmp/phase-7-scratch/sql.ts` (bun:sqlite): a partial unique index `... WHERE status IN ('queued','running')` rejects a second active row and allows a new one after the first fails; `UPDATE ... WHERE last_seq < ?1 ... RETURNING id` returns 1 row for a fresh seq and 0 rows for a replay. [D1 runs SQLite; D1's `RETURNING` support is documented but was not exercised against `wrangler`'s local D1 here.]
- **The SigV4 signer matches two independent implementations.** Scratch run: the AWS documentation example signature, and botocore `S3SigV4QueryAuth` for an R2-style and a local-endpoint-style (port) URL (identical signatures). See "Scratch runs".
- **No Human-only checks exist in this phase.** Everything is reachable with `curl`, `psql`, and the local stack.

### PERISHABLE - recapture before task 1

- **Bun and Node.** Check: `bun --version && node --version` - planning run: Bun 1.3.5, Node v22.19.0. Needed by: every task.
- **Branch and tree state.** Check: `git status --short && git branch --show-current` - Expected: clean tree on `phase-7-restore-and-download` after Task 0. Needed by: every commit.
- **Phases 1 to 6 are merged.** Check: the Phase gate script - Expected: `GATE OK`. Not run while planning (files do not exist yet).
- **Baseline red count.** Check: `bun run typecheck; bun run test` - Expected: both exit 0 at the start (Phase gate Step 4). If not, record the exact counts here and name the failing files; do not widen the list mid-run. Not run while planning.
- **Next migration number.** Check: `ls migrations` - needed by Task 3 (do not hard-code a number).
- **`jq`, `psql`, `pg_restore`, `shasum` on the PATH.** Check: `jq --version && psql --version && pg_restore --version && shasum -v`. Planning machine: all present. Needed by: End-to-end verification only.
- **Docker.** Check: `docker info --format '{{.ServerVersion}}'`. Planning machine: `docker: command not found`. Needed by: End-to-end verification (Phase 4 compose: Postgres 14 and 17, RustFS). If missing: STOP before the end-to-end section and ask; Tasks 1 to 12 do not need it.
- **Local stack up (Phase 4 and 5 setup).** Check: `docker compose -f test/docker-compose.test.yml ps` shows Postgres and RustFS running (file planned in Phase 4). Needed by: End-to-end verification. Not run while planning.
- **Free port for the dev server.** Check: `lsof -i :8787` prints nothing (planning machine: free). If used, pick another and use it in `API=` below.
- **Dev server running THIS checkout, log captured.** Obtain: `bun run dev > /tmp/cellar-dev.log 2>&1 &` then `curl -sf http://localhost:8787/api/health` - Expected: `{"ok":true}`. Needs `.dev.vars` (gitignored) with `DEV_BYPASS=true`, a fake `ENCRYPTION_KEY`, `R2_*` pointing at the local RustFS (the same values the Phase 5 end-to-end section uses), and `R2_REGION=us-east-1`. Needed by: End-to-end verification.
- **Two scratch databases, both EXISTING and disposable.** Obtain: on the compose Postgres, `createdb` two empty databases (for example `cellar_restore_a` and `cellar_restore_b`). Export host-reachable URLs: `SRC_CONN_URL` (the sample database the Phase 4 compose seeds), `SCRATCH_A_URL`, `SCRATCH_B_URL`, and `TUNNEL_FIELDS` (a JSON fragment such as `"tunnelHostname":"...","tunnelTokenId":"...","tunnelTokenSecret":"..."` using the field names Phase 2's create body defines, for the same tunnel the Phase 5 end-to-end section uses to reach the compose Postgres). Check: `psql "$SCRATCH_A_URL" -Atc 'select 1'` and the same for B print `1`. Restoring is destructive, so these must never point at the sample database.
- **Secrets.** None are needed to run tests. Test passwords are fake literals in the test files. Record only the shape in this file: `test -n "$SRC_CONN_URL"` then "set" or "NOT set".

## Execution

**Tracks:** one track, sequential. The work is a chain: migration, fixtures, routes, job runner, callback, sweeper, list routes. Splitting it would put 13 tasks over 4 tracks, each below the cost floor (3 tasks or 5 files), and all of them edit `src/worker/routes/backup-actions.ts` or the Phase 5 hook files.
**Merge order:** not applicable (single track).
**Shared files:** `src/worker/app.ts` is edited in Task 5 and Task 11 only. `src/worker/routes/backup-actions.ts` is created in Task 5 and extended in Task 7. `src/worker/env.ts` and `.dev.vars.example` belong to Task 1. `migrations/` belongs to Task 3. `docs/PLAN.md` belongs to Task 12. `package.json` and `bun.lock` are not touched (no new dependency).
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on the branch from Task 0.
**treehouse:** not needed for a single track.

---

### Task 0: Phase gate

See the `## Phase gate` section above. It is the first task. It creates the branch, proves Phases 1 to 6 are in place, and records the baseline.

---

### Task 1: SigV4 presign helper and `R2_REGION`

**Files:**
- Create: `src/worker/lib/s3-presign.ts`
- Create: `test/worker/lib/s3-presign.test.ts`
- Modify: `src/worker/env.ts` (anchor: `R2_BUCKET`, planned)
- Modify: `.dev.vars.example` (anchor: `R2_BUCKET`, planned)
- This task has four files on purpose: the env var and the helper that reads it land in one building commit.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `presignUrl(input: PresignInput): Promise<string>` where `PresignInput = { url: URL; accessKeyId: string; secretAccessKey: string; region: string; expiresInSeconds: number; now: Date }`. `url` carries the final encoded path and no query.
  - `presignGetObject(input: PresignGetObjectInput): Promise<string>` where `PresignGetObjectInput = { endpoint: string; bucket: string; key: string; accessKeyId: string; secretAccessKey: string; region: string; expiresInSeconds: number; now: Date }`. Path-style: `<endpoint>/<bucket>/<key>`, each key segment RFC 3986 encoded (so `:` becomes `%3A`).
  - `Env.R2_REGION?: string` (empty or unset means `auto`).

**Gotcha:** SigV4 for S3 signs the path as sent, with single encoding. `encodeURIComponent` leaves `! ' ( ) *` alone, so the helper escapes them. The host header is signed with its port, which matters for local RustFS. The signer ran in scratch against the AWS example and botocore; do not "simplify" the encoding.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/s3-presign.ts` (ran in scratch, unchanged):
```ts
export interface PresignInput {
  /** Full URL with the final, already-encoded path. Query string must be empty. */
  url: URL;
  accessKeyId: string;
  secretAccessKey: string;
  /** "auto" for R2. */
  region: string;
  expiresInSeconds: number;
  now: Date;
}

const encoder = new TextEncoder();

/** RFC 3986 unreserved set, as SigV4 requires. */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(data)));
}

/** AWS Signature Version 4 query-string signing for a GET with an unsigned payload. */
export async function presignUrl(input: PresignInput): Promise<string> {
  const { url, accessKeyId, secretAccessKey, region, expiresInSeconds, now } = input;
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  query.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQuery = query.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");

  const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export interface PresignGetObjectInput {
  /** Path-style endpoint, for example the R2 S3 endpoint or a local RustFS URL. No trailing slash needed. */
  endpoint: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expiresInSeconds: number;
  now: Date;
}

export async function presignGetObject(input: PresignGetObjectInput): Promise<string> {
  const base = new URL(input.endpoint);
  const basePath = base.pathname.replace(/\/+$/, "");
  const path = [input.bucket, ...input.key.split("/")].map(uriEncode).join("/");
  const url = new URL(`${base.origin}${basePath}/${path}`);
  return presignUrl({ ...input, url });
}
```
- [ ] Step 2: Create `test/worker/lib/s3-presign.test.ts` (ran in scratch with only the import path changed):
```ts
import { describe, expect, it } from "vitest";
import { presignGetObject, presignUrl } from "../../../src/worker/lib/s3-presign";

const KEY = "backups/t-1/2026/10/24/2026-10-24T02:00:00.000Z_appdb.dump";
const NOW = new Date("2026-10-24T02:05:07.123Z");

describe("presignUrl", () => {
  it("matches the AWS documented SigV4 query-string example", async () => {
    const url = await presignUrl({
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      expiresInSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
  });
});

// Expected URLs below were produced by botocore S3SigV4QueryAuth with the same inputs (see "Scratch runs").
describe("presignGetObject", () => {
  it("matches botocore for an R2-style endpoint, region auto, and a key with a space", async () => {
    const url = await presignGetObject({
      endpoint: "https://acct123.r2.cloudflarestorage.com",
      bucket: "cellar-backups",
      key: "backups/t-1/2026/10/24/2026-10-24T02:00:00.000Z_my db.dump",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      region: "auto",
      expiresInSeconds: 900,
      now: NOW,
    });
    expect(url).toBe(
      "https://acct123.r2.cloudflarestorage.com/cellar-backups/backups/t-1/2026/10/24/2026-10-24T02%3A00%3A00.000Z_my%20db.dump?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKID%2F20261024%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261024T020507Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=27d0d554156d51d2504bf7b8c17e76b313a85b82dfaf157ee87061e6eab3ed0b",
    );
  });

  it("matches botocore for a path-style endpoint with a port (local RustFS)", async () => {
    const input = {
      bucket: "cellar-test",
      key: KEY,
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
      region: "us-east-1",
      expiresInSeconds: 900,
      now: NOW,
    };
    const expected =
      "http://localhost:9000/cellar-test/backups/t-1/2026/10/24/2026-10-24T02%3A00%3A00.000Z_appdb.dump?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=minioadmin%2F20261024%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261024T020507Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=49b6aebffb625c1b2cbc009e6ca1168693b4a3ccdae9d4238d79fa4eea9839e9";
    expect(await presignGetObject({ ...input, endpoint: "http://localhost:9000" })).toBe(expected);
    expect(await presignGetObject({ ...input, endpoint: "http://localhost:9000/" })).toBe(expected);
  });

  it("signs only the host header and carries the requested expiry", async () => {
    const url = new URL(
      await presignGetObject({ endpoint: "https://acct123.r2.cloudflarestorage.com", bucket: "b", key: KEY, accessKeyId: "A", secretAccessKey: "S", region: "auto", expiresInSeconds: 300, now: NOW }),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261024T020507Z");
  });
});
```
- [ ] Step 3: In `src/worker/env.ts`, add `R2_REGION?: string;` on the line after `R2_BUCKET: string;`. In `.dev.vars.example`, add after the R2 block:
```dotenv
# Optional. SigV4 region for presigned download URLs. Leave empty for Cloudflare R2 (it uses "auto").
# Local RustFS needs us-east-1.
R2_REGION=
```
- [ ] Step 4: Verify - Run: `bun run typecheck && bunx vitest run test/worker/lib/s3-presign.test.ts` - Expected: typecheck exits 0; 4 passed, 0 failed
- [ ] Step 5: Commit - `git add src/worker/lib/s3-presign.ts test/worker/lib/s3-presign.test.ts src/worker/env.ts .dev.vars.example && git commit -m "feat: add SigV4 presigned GET helper and R2_REGION"`

---

### Task 2: Restore rules (TTL clamp, destination database name)

**Files:**
- Create: `src/worker/lib/restore-rules.ts`
- Test: `test/worker/lib/restore-rules.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_DOWNLOAD_TTL_SECONDS: 900`
  - `clampDownloadTtl(raw: unknown): number` - integer 1 to 900; anything that is not a finite number of at least 1 returns 900.
  - `destinationDbNameFromUrl(url: string): string | null` - the decoded database name of a `postgres://` or `postgresql://` URL, or `null` when the URL does not parse, uses another scheme, has an empty path, or has a `/` inside the name. It never throws and never echoes the URL.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/restore-rules.ts` (ran in scratch, unchanged):
```ts
export const MAX_DOWNLOAD_TTL_SECONDS = 900;

export function clampDownloadTtl(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MAX_DOWNLOAD_TTL_SECONDS;
  const whole = Math.floor(raw);
  if (whole < 1) return MAX_DOWNLOAD_TTL_SECONDS;
  return Math.min(whole, MAX_DOWNLOAD_TTL_SECONDS);
}

export function destinationDbNameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  return name === "" || name.includes("/") ? null : name;
}
```
- [ ] Step 2: Create `test/worker/lib/restore-rules.test.ts` (ran in scratch with only the import path changed). The `it.each` tables enumerate the whole input set: 12 TTL values (unset, null, string, NaN, 0, negative, fraction below 1, the lower bound 1, a mid value, a fractional value, the 900 bound, above the bound) and 8 URLs (plain, encoded with query string, empty path, no path, encoded slash, wrong scheme, not a URL, bad percent-encoding):
```ts
import { describe, expect, it } from "vitest";
import { clampDownloadTtl, destinationDbNameFromUrl } from "../../../src/worker/lib/restore-rules";
describe("clampDownloadTtl", () => {
  it.each([[undefined, 900], [null, 900], ["600", 900], [NaN, 900], [0, 900], [-5, 900], [0.5, 900], [1, 1], [300, 300], [300.9, 300], [900, 900], [3600, 900]])("%s -> %s", (raw, want) => {
    expect(clampDownloadTtl(raw)).toBe(want);
  });
});
describe("destinationDbNameFromUrl", () => {
  it.each([
    ["postgres://u:p@h:5432/scratch", "scratch"],
    ["postgresql://u:p%40ss@h/my%20db?sslmode=require", "my db"],
    ["postgres://u:p@h:5432/", null],
    ["postgres://u:p@h:5432", null],
    ["postgres://u:p@h/a%2Fb", null],
    ["mysql://u:p@h/db", null],
    ["not a url", null],
    ["postgres://u:p@h/%E0%A4%A", null],
  ])("%s -> %s", (url, want) => {
    expect(destinationDbNameFromUrl(url)).toBe(want);
  });
});
```
- [ ] Step 3: Verify - Run: `bun run typecheck && bunx vitest run test/worker/lib/restore-rules.test.ts` - Expected: typecheck exits 0; 20 passed, 0 failed
- [ ] Step 4: Commit - `git add src/worker/lib/restore-rules.ts test/worker/lib/restore-rules.test.ts && git commit -m "feat: add download TTL clamp and restore destination parsing"`

---

### Task 3: Migration - `restores.last_seq` and one active restore per destination

**Files:**
- Modify: `src/worker/db/schema.ts` (anchor: `export const restores`, `heartbeatAt: text("heartbeat_at")` and the index array, ~L624-655 in the Phase 1 plan)
- Create: `migrations/<NNNN>_restore_last_seq.sql` (emitted by drizzle-kit; `<NNNN>` is the next free number printed by `ls migrations`)
- Create: `migrations/meta/<NNNN>_snapshot.json` (emitted)
- Modify: `migrations/meta/_journal.json` (appended by drizzle-kit)

**Interfaces:**
- Consumes: the `restores` table from Phase 1 Task 4.
- Produces: `restores.lastSeq` (`integer("last_seq").notNull().default(0)`) and the unique partial index `uq_restores_active_destination` on `(destination_target_id) WHERE status IN ('queued','running')`.

**Blast radius (inferred type):** `typeof restores.$inferSelect` gains `lastSeq: number`, and every hand-built restore row must supply it or rely on the default. Consumers at planning time: none, because no earlier phase constructs a `restores` row by hand. The executor must re-check: `grep -rn "restores" src test --include=*.ts -l` - Expected: only `src/worker/db/schema.ts` (plus Phase 5 files if its sweeper already names the table; those use `select`/`update` and need no change). Insert sites use Drizzle, which applies the column default.

**Gotcha:** the index makes a second INSERT of an active restore for the same destination fail with `UNIQUE constraint failed: restores.destination_target_id`. Terminal states (`success`, `failed`, `timed_out`) are not in the index, so history is unlimited.

**Rollback:** local D1 only. `rm -rf .wrangler/state/v3/d1 && bun run db:migrate:local` rebuilds it from the migration files. To drop the change entirely: `git revert <commit>`. Nothing remote is touched. Never run `db:migrate:remote`.

**Steps:**
- [ ] Step 1: In `src/worker/db/schema.ts`, in the `restores` table, add this column after `heartbeatAt`:
```ts
    lastSeq: integer("last_seq").notNull().default(0),
```
and add this entry to the index array after `idx_restores_status`:
```ts
    uniqueIndex("uq_restores_active_destination")
      .on(t.destinationTargetId)
      .where(sql`${t.status} IN ('queued', 'running')`),
```
- [ ] Step 2: Generate the migration: `ls migrations && bun run db:generate -- --name restore_last_seq && ls migrations`
- [ ] Step 3: Read the new SQL file. It must contain an `ALTER TABLE` adding `last_seq` as `integer DEFAULT 0 NOT NULL` and a `CREATE UNIQUE INDEX` named `uq_restores_active_destination` with a `WHERE` clause. If drizzle-kit emits a table rebuild instead, keep it (SQLite) but confirm it preserves every other `restores` column and index.
- [ ] Step 4: Apply to local D1 only: `bun run db:migrate:local`
- [ ] Step 5: Verify - Run: `bun run typecheck && grep -c "last_seq" migrations/*_restore_last_seq.sql && grep -c "uq_restores_active_destination" migrations/*_restore_last_seq.sql` - Expected: typecheck exits 0; both counts are 1 or more. (Behavioral proof of the index and default is the test in Task 4.)
- [ ] Step 6: Commit - `git add src/worker/db/schema.ts migrations && git commit -m "feat: add restores.last_seq and one active restore per destination"`

---

### Task 4: Test fixtures and schema test

**Files:**
- Create: `test/helpers/restore-fixtures.ts`
- Test: `test/worker/db/restores-schema.test.ts`

**Interfaces:**
- Consumes: `createTestEnv` (Phase 2), `encrypt` (Phase 1), Drizzle tables, `Env` with R2 vars (Phase 5).
- Produces (used by Tasks 5 to 11):
  - `NOW_ISO: string` (`"2026-10-24T00:00:00.000Z"`)
  - `TEST_R2: { R2_ENDPOINT; R2_BUCKET; R2_ACCESS_KEY_ID; R2_SECRET_ACCESS_KEY }` (fake values, `satisfies Partial<Env>`)
  - `BACKUP_URL`, `RESTORE_URL: string` (fake URLs with fake passwords `backup-pass-1` and `restore-pass-1`)
  - `fakeQueue(options?: { failSend?: boolean }): { queue: Queue; sent: unknown[] }`
  - `seedTarget(env: Env, o?: { id?: string; name?: string; restoreUrl?: string | null; deletedAt?: string | null; jobDeadlineMinutes?: number }): Promise<typeof targets.$inferSelect>` (always adds fake encrypted tunnel settings; default restore URL is `RESTORE_URL`)
  - `seedBackup(env: Env, targetId: string, o?: { id?: string; status?: "queued" | "running" | "success" | "failed" | "timed_out"; deletedAt?: string | null }): Promise<typeof backups.$inferSelect>` (default `success`, with `r2Key` unique per backup)
  - `seedRestore(env: Env, o: { id?: string; sourceBackupId: string; destinationTargetId: string; status?: ...; destinationDbName?: string; isSourceOverwrite?: boolean; queuedAt?: string; startedAt?: string | null; heartbeatAt?: string | null; lastSeq?: number }): Promise<typeof restores.$inferSelect>`

**Gotcha:** `seedRestore` obeys the Task 3 index: two `queued` or `running` restores for one destination throw. Tests that need several active restores create one destination target per restore.

**Steps:**
- [ ] Step 1: Create `test/helpers/restore-fixtures.ts`:
```ts
import { getDb } from "../../src/worker/db/client";
import { backups, restores, targets } from "../../src/worker/db/schema";
import type { Env } from "../../src/worker/env";
import { encrypt } from "../../src/worker/lib/crypto";

export const NOW_ISO = "2026-10-24T00:00:00.000Z";

export const TEST_R2 = {
  R2_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
  R2_BUCKET: "cellar-backups",
  R2_ACCESS_KEY_ID: "AKIDTEST",
  R2_SECRET_ACCESS_KEY: "r2-secret-test",
} satisfies Partial<Env>;

export const BACKUP_URL = "postgres://backup_user:backup-pass-1@db.example.com:5432/appdb";
export const RESTORE_URL = "postgres://restore_user:restore-pass-1@db.example.com:5432/scratch";

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${++counter}`;

export function fakeQueue(options: { failSend?: boolean } = {}): { queue: Queue; sent: unknown[] } {
  const sent: unknown[] = [];
  const queue = {
    send: async (message: unknown) => {
      if (options.failSend) throw new Error("queue down at postgres://q:queue-secret@h/db");
      sent.push(message);
    },
    sendBatch: async () => {},
  } as unknown as Queue;
  return { queue, sent };
}

export async function seedTarget(
  env: Env,
  o: { id?: string; name?: string; restoreUrl?: string | null; deletedAt?: string | null; jobDeadlineMinutes?: number } = {},
): Promise<typeof targets.$inferSelect> {
  const id = o.id ?? nextId("target");
  const restoreUrl = o.restoreUrl === undefined ? RESTORE_URL : o.restoreUrl;
  const [row] = await getDb(env)
    .insert(targets)
    .values({
      id,
      name: o.name ?? `name-${id}`,
      dbName: "appdb",
      connectionUrlEnc: await encrypt(BACKUP_URL, env.ENCRYPTION_KEY),
      restoreUrlEnc: restoreUrl === null ? null : await encrypt(restoreUrl, env.ENCRYPTION_KEY),
      tunnelHostname: "db.example.com",
      tunnelTokenIdEnc: await encrypt("tunnel-id-1", env.ENCRYPTION_KEY),
      tunnelTokenSecretEnc: await encrypt("tunnel-secret-1", env.ENCRYPTION_KEY),
      jobDeadlineMinutes: o.jobDeadlineMinutes ?? 120,
      deletedAt: o.deletedAt ?? null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    })
    .returning();
  if (!row) throw new Error("seedTarget: insert returned no row");
  return row;
}

export async function seedBackup(
  env: Env,
  targetId: string,
  o: { id?: string; status?: "queued" | "running" | "success" | "failed" | "timed_out"; deletedAt?: string | null } = {},
): Promise<typeof backups.$inferSelect> {
  const id = o.id ?? nextId("backup");
  const [row] = await getDb(env)
    .insert(backups)
    .values({
      id,
      targetId,
      status: o.status ?? "success",
      trigger: "manual",
      r2Key: `backups/${targetId}/2026/10/24/2026-10-24T02:00:00.000Z_${id}.dump`,
      sizeBytes: 1234,
      sha256: "ab".repeat(32),
      queuedAt: NOW_ISO,
      deletedAt: o.deletedAt ?? null,
    })
    .returning();
  if (!row) throw new Error("seedBackup: insert returned no row");
  return row;
}

export async function seedRestore(
  env: Env,
  o: {
    id?: string;
    sourceBackupId: string;
    destinationTargetId: string;
    status?: "queued" | "running" | "success" | "failed" | "timed_out";
    destinationDbName?: string;
    isSourceOverwrite?: boolean;
    queuedAt?: string;
    startedAt?: string | null;
    heartbeatAt?: string | null;
    lastSeq?: number;
  },
): Promise<typeof restores.$inferSelect> {
  const [row] = await getDb(env)
    .insert(restores)
    .values({
      id: o.id ?? nextId("restore"),
      sourceBackupId: o.sourceBackupId,
      destinationTargetId: o.destinationTargetId,
      destinationDbName: o.destinationDbName ?? "scratch",
      status: o.status ?? "queued",
      actor: "dev@localhost",
      isSourceOverwrite: o.isSourceOverwrite ?? false,
      queuedAt: o.queuedAt ?? NOW_ISO,
      startedAt: o.startedAt ?? null,
      heartbeatAt: o.heartbeatAt ?? null,
      lastSeq: o.lastSeq ?? 0,
    })
    .returning();
  if (!row) throw new Error("seedRestore: insert returned no row");
  return row;
}
```
- [ ] Step 2: Create `test/worker/db/restores-schema.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { restores } from "../../../src/worker/db/schema";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
beforeEach(async () => {
  ctx = await createTestEnv();
});
afterEach(async () => {
  await ctx.dispose();
});

describe("restores table (Phase 7 migration)", () => {
  it("defaults last_seq to 0", async () => {
    const backup = await seedBackup(ctx.env, (await seedTarget(ctx.env)).id);
    const row = await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: (await seedTarget(ctx.env)).id });
    expect(row.lastSeq).toBe(0);
  });

  it("allows only one queued or running restore per destination target", async () => {
    const backup = await seedBackup(ctx.env, (await seedTarget(ctx.env)).id);
    const destination = await seedTarget(ctx.env);
    const first = await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id });
    await expect(seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id, status: "running" })).rejects.toThrow();
    await getDb(ctx.env).update(restores).set({ status: "failed" }).where(eq(restores.id, first.id));
    await expect(seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id })).resolves.toBeTruthy();
  });
});
```
- [ ] Step 3: Verify - Run: `bun run typecheck && bunx vitest run test/worker/db/restores-schema.test.ts` - Expected: typecheck exits 0; 2 passed, 0 failed
- [ ] Step 4: Commit - `git add test/helpers/restore-fixtures.ts test/worker/db/restores-schema.test.ts && git commit -m "test: add restore fixtures and schema test for the active-restore index"`

---

### Task 5: `POST /api/backups/:id/download-url`

**Files:**
- Create: `src/worker/routes/backup-actions.ts`
- Modify: `src/worker/app.ts` (anchor: `app.use("/api/*", access())`; add the import and one `app.route` line after the last existing `app.route(` call, planned)
- Test: `test/worker/routes/backup-download.test.ts`

**Interfaces:**
- Consumes: `presignGetObject`, `clampDownloadTtl` (Tasks 1, 2), `writeAudit`, `getDb`, `ApiError`, `Env.R2_*` (Phase gate), fixtures (Task 4).
- Produces: `backupActions: Hono<AppEnv>` exported from `src/worker/routes/backup-actions.ts`, mounted at `/api/backups`. Route `POST /api/backups/:id/download-url` returns `200 { url: string; expiresAt: string }` (ISO UTC). Errors: 404 `not_found` (unknown id), 409 `conflict` (backup not `success`, `deleted_at` set, or no `r2_key`). Writes audit `backup.download` before returning.

**Gotcha:** the audit row must never hold the URL, any `X-Amz-*` value, or the R2 secret. `expiresAt` is `now + ttl`; the signed `X-Amz-Date` is `now` truncated to the second, so the signed expiry is never later than `expiresAt`.

**Steps:**
- [ ] Step 1: Create `src/worker/routes/backup-actions.ts`:
```ts
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { backups, settings } from "../db/schema";
import { writeAudit } from "../lib/audit";
import { clampDownloadTtl } from "../lib/restore-rules";
import { presignGetObject } from "../lib/s3-presign";
import { ApiError } from "../middleware/error";
import type { AppEnv } from "../middleware/access";

type Db = ReturnType<typeof getDb>;

export const backupActions = new Hono<AppEnv>();

async function findAvailableBackup(db: Db, id: string): Promise<typeof backups.$inferSelect & { r2Key: string }> {
  const [backup] = await db.select().from(backups).where(eq(backups.id, id)).limit(1);
  if (!backup) throw new ApiError(404, "not_found", "Backup not found");
  if (backup.status !== "success" || backup.deletedAt !== null || backup.r2Key === null) {
    throw new ApiError(409, "conflict", "Backup is not available (only successful, undeleted backups can be downloaded or restored)");
  }
  return { ...backup, r2Key: backup.r2Key };
}

async function readDownloadTtlSeconds(db: Db): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "download_url_ttl_seconds")).limit(1);
  if (!row) return clampDownloadTtl(undefined);
  try {
    return clampDownloadTtl(JSON.parse(row.value));
  } catch {
    return clampDownloadTtl(undefined);
  }
}

backupActions.post("/:id/download-url", async (c) => {
  const db = getDb(c.env);
  const backup = await findAvailableBackup(db, c.req.param("id"));
  const ttl = await readDownloadTtlSeconds(db);
  const now = new Date();
  const url = await presignGetObject({
    endpoint: c.env.R2_ENDPOINT,
    bucket: c.env.R2_BUCKET,
    key: backup.r2Key,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    region: c.env.R2_REGION || "auto",
    expiresInSeconds: ttl,
    now,
  });
  const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "backup.download",
    entityType: "backup",
    entityId: backup.id,
    details: { targetId: backup.targetId, expiresAt },
    ip: c.req.header("CF-Connecting-IP") ?? null,
  });
  return c.json({ url, expiresAt });
});
```
- [ ] Step 2: In `src/worker/app.ts` add `import { backupActions } from "./routes/backup-actions";` with the other imports, and `app.route("/api/backups", backupActions);` after the last existing `app.route(...)` line (after the Access middleware registration). Hono merges two sub-apps mounted on the same base path, so this coexists with a `routes/backups.ts` mounted at `/api/backups` by Phases 5 and 6.
- [ ] Step 3: Create `test/worker/routes/backup-download.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../../src/worker/app";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs, settings } from "../../../src/worker/db/schema";
import { createTestEnv } from "../../helpers/env";
import { TEST_R2, seedBackup, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;

beforeEach(async () => {
  ctx = await createTestEnv(TEST_R2);
});
afterEach(async () => {
  await ctx.dispose();
});

const post = (id: string) => app.request(`http://localhost/api/backups/${id}/download-url`, { method: "POST" }, ctx.env);

async function setTtl(value: string): Promise<void> {
  await getDb(ctx.env).insert(settings).values({ key: "download_url_ttl_seconds", value, updatedAt: "2026-10-24T00:00:00.000Z" });
}

function signedLifetimeSeconds(url: string): number {
  const params = new URL(url).searchParams;
  return Number(params.get("X-Amz-Expires"));
}

describe("POST /api/backups/:id/download-url", () => {
  it("returns a presigned R2 URL that expires in 15 minutes by default", async () => {
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const res = await post(backup.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresAt: string };
    const url = new URL(body.url);
    expect(url.origin).toBe(TEST_R2.R2_ENDPOINT);
    expect(url.pathname.startsWith("/cellar-backups/backups/")).toBe(true);
    expect(url.searchParams.get("X-Amz-Credential")?.startsWith("AKIDTEST/")).toBe(true);
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(signedLifetimeSeconds(body.url)).toBe(900);
    const msUntilExpiry = Date.parse(body.expiresAt) - Date.now();
    expect(msUntilExpiry).toBeGreaterThan(0);
    expect(msUntilExpiry).toBeLessThanOrEqual(900_000);
  });

  it("never signs more than 15 minutes, even when the setting is larger", async () => {
    await setTtl("3600");
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string; expiresAt: string };
    expect(signedLifetimeSeconds(body.url)).toBe(900);
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(900_000);
  });

  it("honours a smaller download_url_ttl_seconds setting", async () => {
    await setTtl("300");
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    expect(signedLifetimeSeconds(body.url)).toBe(300);
  });

  it("falls back to 15 minutes when the setting is not a usable number", async () => {
    await setTtl('"soon"');
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    expect(signedLifetimeSeconds(body.url)).toBe(900);
  });

  it("uses R2_REGION when it is set", async () => {
    await ctx.dispose();
    ctx = await createTestEnv({ ...TEST_R2, R2_REGION: "us-east-1" });
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    const body = (await (await post(backup.id)).json()) as { url: string };
    expect(new URL(body.url).searchParams.get("X-Amz-Credential")).toContain("/us-east-1/s3/aws4_request");
  });

  it("writes a backup.download audit row without the URL or any signature", async () => {
    const target = await seedTarget(ctx.env);
    const backup = await seedBackup(ctx.env, target.id);
    await post(backup.id);
    const rows = await getDb(ctx.env).select().from(auditLogs).where(eq(auditLogs.action, "backup.download"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "dev@localhost", entityType: "backup", entityId: backup.id });
    expect(rows[0]?.details).toContain(target.id);
    expect(rows[0]?.details).not.toContain("X-Amz");
    expect(rows[0]?.details).not.toContain("r2-secret-test");
  });

  it("returns 404 for an unknown backup and writes no audit row", async () => {
    const res = await post("does-not-exist");
    expect(res.status).toBe(404);
    expect(await getDb(ctx.env).select().from(auditLogs)).toHaveLength(0);
  });

  it("returns 409 for backups that are not successful or were deleted", async () => {
    const target = await seedTarget(ctx.env);
    const failed = await seedBackup(ctx.env, target.id, { status: "failed" });
    const deleted = await seedBackup(ctx.env, target.id, { deletedAt: "2026-10-24T01:00:00.000Z" });
    for (const backup of [failed, deleted]) {
      const res = await post(backup.id);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("conflict");
    }
    expect(await getDb(ctx.env).select().from(auditLogs)).toHaveLength(0);
  });

  it("still serves backups whose target was soft-deleted (history and R2 data are kept)", async () => {
    const target = await seedTarget(ctx.env, { deletedAt: "2026-10-24T01:00:00.000Z" });
    const backup = await seedBackup(ctx.env, target.id);
    expect((await post(backup.id)).status).toBe(200);
  });
});
```
- [ ] Step 4: Verify - Run: `bun run typecheck && bunx vitest run test/worker/routes/backup-download.test.ts` - Expected: typecheck exits 0; 9 passed, 0 failed
- [ ] Step 5: Commit - `git add src/worker/routes/backup-actions.ts src/worker/app.ts test/worker/routes/backup-download.test.ts && git commit -m "feat: presigned backup download URL with audit row"`

---

### Task 6: Settings allowlist accepts `download_url_ttl_seconds`

**Files:**
- Modify: `src/worker/routes/settings.ts` (anchor: the Zod known-key allowlist that already holds `max_concurrent_jobs`, planned)
- Test: `test/worker/routes/settings-download-ttl.test.ts`

**Interfaces:**
- Consumes: the Phase 5 `PUT /api/settings` handler (assumption A3).
- Produces: `PUT /api/settings` accepts `download_url_ttl_seconds` as an integer from 1 to 900 and stores it in `settings` as JSON text (key `download_url_ttl_seconds`). Task 5's reader parses that JSON.

**Gotcha:** copy the exact style of the existing `max_concurrent_jobs` entry (same schema object, same audit call `settings.update`). If the handler requires the whole settings object instead of a partial one, send the full object in the test and record a `> Deviation:`. The test reads the `settings` table directly so it does not depend on the response shape of `GET /api/settings`.

**Steps:**
- [ ] Step 1: In the allowlist schema in `src/worker/routes/settings.ts`, add next to the `max_concurrent_jobs` entry:
```ts
  download_url_ttl_seconds: z.number().int().min(1).max(900),
```
(Make it optional in the same way the other keys are, so a partial `PUT` stays valid.)
- [ ] Step 2: Create `test/worker/routes/settings-download-ttl.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../../src/worker/app";
import { getDb } from "../../../src/worker/db/client";
import { settings } from "../../../src/worker/db/schema";
import { createTestEnv } from "../../helpers/env";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
beforeEach(async () => {
  ctx = await createTestEnv();
});
afterEach(async () => {
  await ctx.dispose();
});

const put = (body: unknown) =>
  app.request("http://localhost/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, ctx.env);
const stored = async () => (await getDb(ctx.env).select().from(settings).where(eq(settings.key, "download_url_ttl_seconds")))[0];

describe("PUT /api/settings download_url_ttl_seconds", () => {
  it("accepts whole seconds from 1 to 900 and stores them as JSON", async () => {
    expect((await put({ download_url_ttl_seconds: 600 })).status).toBe(200);
    expect(JSON.parse((await stored())?.value ?? "null")).toBe(600);
    expect((await put({ download_url_ttl_seconds: 900 })).status).toBe(200);
    expect((await put({ download_url_ttl_seconds: 1 })).status).toBe(200);
  });

  it("rejects values above 15 minutes, below 1 second, fractions, and strings", async () => {
    for (const bad of [901, 0, -1, 1.5, "600"]) {
      expect((await put({ download_url_ttl_seconds: bad })).status).toBe(400);
    }
    expect(await stored()).toBeUndefined();
  });
});
```
- [ ] Step 3: Verify - Run: `bun run typecheck && bunx vitest run test/worker/routes/settings-download-ttl.test.ts` - Expected: typecheck exits 0; 2 passed, 0 failed
- [ ] Step 4: Commit - `git add src/worker/routes/settings.ts test/worker/routes/settings-download-ttl.test.ts && git commit -m "feat: allow download_url_ttl_seconds in settings"`

---

### Task 7: `POST /api/backups/:id/restore`

**Files:**
- Modify: `src/worker/routes/backup-actions.ts` (extend the file from Task 5)
- Test: `test/worker/routes/backup-restore.test.ts`

**Interfaces:**
- Consumes: Task 5's `backupActions`, `findAvailableBackup`; `decrypt`, `redactError`, `uuidv7`, `parseBody`, `destinationDbNameFromUrl`; fixtures (Task 4); the `restores` unique index (Task 3).
- Produces: `POST /api/backups/:id/restore`, body `{ destinationTargetId: string; confirmName: string; acknowledgeOverwrite?: true }` (strict; unknown keys give 400; `acknowledgeOverwrite: true` is required when the destination is the backup's own target, else 400 `validation_error`), returns `202 { restoreId: string; sameDatabase: boolean }`. Inserts a `restores` row (`status: "queued"`, `actor` from Access, `destinationDbName` from the restore URL, `isSourceOverwrite = sameDatabase`), writes audit `restore.start`, then sends `{ jobId: restoreId, type: "restore", targetId: destinationTargetId }` to `env.JOBS`. If the send throws, the row becomes `failed` with `error_code = enqueue_failed` and the route answers 503 `enqueue_failed`.

**Gotcha:** the check order is fixed (Decision 4). `confirmName` is compared with `!==` and no trimming. The decrypted restore URL lives only in a local variable: it is never logged, audited, stored, or returned. Do not fall back to `connection_url_enc`.

**Steps:**
- [ ] Step 1: In `src/worker/routes/backup-actions.ts`, replace the import block (the lines from `import { eq } from "drizzle-orm";` to `import type { AppEnv } from "../middleware/access";`) with:
```ts
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { backups, restores, settings, targets } from "../db/schema";
import { writeAudit } from "../lib/audit";
import { decrypt } from "../lib/crypto";
import { redactError } from "../lib/redact";
import { clampDownloadTtl, destinationDbNameFromUrl } from "../lib/restore-rules";
import { presignGetObject } from "../lib/s3-presign";
import { uuidv7 } from "../lib/uuidv7";
import { parseBody } from "../lib/validate";
import { ApiError } from "../middleware/error";
import type { AppEnv } from "../middleware/access";
```
- [ ] Step 2: Insert these helpers after `readDownloadTtlSeconds` (before the `download-url` route):
```ts
const restoreBody = z.strictObject({
  destinationTargetId: z.string().min(1),
  confirmName: z.string(),
  acknowledgeOverwrite: z.literal(true).optional(),
});

async function destinationBusy(db: Db, targetId: string): Promise<boolean> {
  const activeRestore = await db
    .select({ id: restores.id })
    .from(restores)
    .where(and(eq(restores.destinationTargetId, targetId), inArray(restores.status, ["queued", "running"])))
    .limit(1);
  if (activeRestore.length > 0) return true;
  const activeBackup = await db
    .select({ id: backups.id })
    .from(backups)
    .where(and(eq(backups.targetId, targetId), inArray(backups.status, ["queued", "running"])))
    .limit(1);
  return activeBackup.length > 0;
}

function isUniqueViolation(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return text.includes("UNIQUE constraint failed");
}
```
- [ ] Step 3: Append the route at the end of the file:
```ts
backupActions.post("/:id/restore", async (c) => {
  const db = getDb(c.env);
  const body = await parseBody(c, restoreBody);
  const backup = await findAvailableBackup(db, c.req.param("id"));

  const [destination] = await db.select().from(targets).where(eq(targets.id, body.destinationTargetId)).limit(1);
  if (!destination || destination.deletedAt !== null) throw new ApiError(404, "not_found", "Destination target not found");
  if (body.confirmName !== destination.name) {
    throw new ApiError(400, "validation_error", "confirmName must exactly equal the destination target name", { field: "confirmName" });
  }
  const sameDatabase = destination.id === backup.targetId;
  if (sameDatabase && body.acknowledgeOverwrite !== true) {
    throw new ApiError(400, "validation_error", "Restoring into the source database needs acknowledgeOverwrite: true", { field: "acknowledgeOverwrite" });
  }
  if (destination.restoreUrlEnc === null) {
    throw new ApiError(400, "restore_url_missing", "The destination target has no restore connection URL. Add one to the target before restoring.");
  }
  const restoreUrl = await decrypt(destination.restoreUrlEnc, c.env.ENCRYPTION_KEY);
  const destinationDbName = destinationDbNameFromUrl(restoreUrl);
  if (destinationDbName === null) {
    throw new ApiError(400, "restore_url_invalid", "The destination restore connection URL must be a postgres URL that names a database");
  }
  if (await destinationBusy(db, destination.id)) {
    throw new ApiError(409, "conflict", "Another backup or restore is queued or running on the destination target");
  }

  const restoreId = uuidv7();
  try {
    await db.insert(restores).values({
      id: restoreId,
      sourceBackupId: backup.id,
      destinationTargetId: destination.id,
      destinationDbName,
      status: "queued",
      actor: c.get("actorEmail"),
      isSourceOverwrite: sameDatabase,
      queuedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "conflict", "Another backup or restore is queued or running on the destination target");
    }
    throw error;
  }
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "restore.start",
    entityType: "restore",
    entityId: restoreId,
    details: { backupId: backup.id, destinationTargetId: destination.id, destinationDbName, sameDatabase },
    ip: c.req.header("CF-Connecting-IP") ?? null,
  });
  try {
    await c.env.JOBS.send({ jobId: restoreId, type: "restore", targetId: destination.id });
  } catch (error) {
    await db
      .update(restores)
      .set({ status: "failed", errorCode: "enqueue_failed", errorMessage: redactError(error), finishedAt: new Date().toISOString() })
      .where(eq(restores.id, restoreId));
    throw new ApiError(503, "enqueue_failed", "Could not queue the restore job. Try again.");
  }
  return c.json({ restoreId, sameDatabase }, 202);
});
```
- [ ] Step 4: Create `test/worker/routes/backup-restore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../../../src/worker/app";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs, restores } from "../../../src/worker/db/schema";
import { createTestEnv } from "../../helpers/env";
import { TEST_R2, fakeQueue, seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let sent: unknown[];

async function boot(options: { failSend?: boolean } = {}): Promise<void> {
  const queue = fakeQueue(options);
  sent = queue.sent;
  ctx = await createTestEnv({ ...TEST_R2, JOBS: queue.queue });
}

beforeEach(async () => {
  await boot();
});
afterEach(async () => {
  await ctx.dispose();
});

const restore = (backupId: string, body: unknown) =>
  app.request(
    `http://localhost/api/backups/${backupId}/restore`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    ctx.env,
  );

async function setup() {
  const source = await seedTarget(ctx.env, { name: "source-db" });
  const destination = await seedTarget(ctx.env, { name: "scratch-db" });
  const backup = await seedBackup(ctx.env, source.id);
  return { source, destination, backup };
}

const allRestores = () => getDb(ctx.env).select().from(restores);
const auditRows = (action: string) => getDb(ctx.env).select().from(auditLogs).where(eq(auditLogs.action, action));
const errorCode = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe("POST /api/backups/:id/restore", () => {
  it("rejects a wrong confirmName with 400 and starts nothing", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "not-the-name" });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("validation_error");
    expect(await allRestores()).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(await auditRows("restore.start")).toHaveLength(0);
  });

  it("requires an exact match: case and surrounding spaces are rejected", async () => {
    const { destination, backup } = await setup();
    for (const confirmName of ["Scratch-DB", "scratch-db ", " scratch-db", ""]) {
      expect((await restore(backup.id, { destinationTargetId: destination.id, confirmName })).status).toBe(400);
    }
    expect(await allRestores()).toHaveLength(0);
  });

  it("rejects a destination without a restore connection URL, with a clear message", async () => {
    const source = await seedTarget(ctx.env, { name: "source-db" });
    const destination = await seedTarget(ctx.env, { name: "no-restore-url", restoreUrl: null });
    const backup = await seedBackup(ctx.env, source.id);
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "no-restore-url" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("restore_url_missing");
    expect(body.error.message).toContain("restore connection URL");
    expect(await allRestores()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("rejects a restore URL that names no database", async () => {
    const source = await seedTarget(ctx.env, { name: "source-db" });
    const destination = await seedTarget(ctx.env, { name: "no-db", restoreUrl: "postgres://restore_user:pw@db.example.com:5432" });
    const backup = await seedBackup(ctx.env, source.id);
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "no-db" });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("restore_url_invalid");
  });

  it("queues the restore into another target: 202, sameDatabase false, queue message carries ids only", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { restoreId: string; sameDatabase: boolean };
    expect(body.sameDatabase).toBe(false);
    const rows = await allRestores();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: body.restoreId,
      sourceBackupId: backup.id,
      destinationTargetId: destination.id,
      destinationDbName: "scratch",
      status: "queued",
      actor: "dev@localhost",
      isSourceOverwrite: false,
    });
    expect(sent).toEqual([{ jobId: body.restoreId, type: "restore", targetId: destination.id }]);
  });

  it("flags sameDatabase when the destination is the backup's own target", async () => {
    const { source, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: source.id, confirmName: "source-db", acknowledgeOverwrite: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { sameDatabase: boolean }).sameDatabase).toBe(true);
    expect((await allRestores())[0]?.isSourceOverwrite).toBe(true);
  });

  it("requires acknowledgeOverwrite: true when the destination is the backup's own target", async () => {
    const { source, backup } = await setup();
    for (const extra of [{}, { acknowledgeOverwrite: false }]) {
      const res = await restore(backup.id, { destinationTargetId: source.id, confirmName: "source-db", ...extra });
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("validation_error");
    }
    expect(await allRestores()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("does not need acknowledgeOverwrite for another target, and accepts it there", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db", acknowledgeOverwrite: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { sameDatabase: boolean }).sameDatabase).toBe(false);
  });

  it("writes a restore.start audit row that holds no connection secrets", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    const { restoreId } = (await res.json()) as { restoreId: string };
    const rows = await auditRows("restore.start");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "dev@localhost", entityType: "restore", entityId: restoreId });
    const details = JSON.parse(rows[0]?.details ?? "{}") as Record<string, unknown>;
    expect(details).toMatchObject({ backupId: backup.id, destinationTargetId: destination.id, destinationDbName: "scratch", sameDatabase: false });
    expect(rows[0]?.details).not.toContain("restore-pass-1");
    expect(rows[0]?.details).not.toContain("postgres://");
  });

  it("rejects unknown body fields, including the old confirmDbName", async () => {
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db", confirmDbName: "scratch" });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("validation_error");
    expect((await restore(backup.id, { confirmName: "scratch-db" })).status).toBe(400);
  });

  it("returns 404 for an unknown backup", async () => {
    const { destination } = await setup();
    expect((await restore("nope", { destinationTargetId: destination.id, confirmName: "scratch-db" })).status).toBe(404);
  });

  it("returns 404 for an unknown or soft-deleted destination", async () => {
    const { backup } = await setup();
    const deleted = await seedTarget(ctx.env, { name: "gone", deletedAt: "2026-10-24T01:00:00.000Z" });
    expect((await restore(backup.id, { destinationTargetId: "nope", confirmName: "x" })).status).toBe(404);
    expect((await restore(backup.id, { destinationTargetId: deleted.id, confirmName: "gone" })).status).toBe(404);
  });

  it("returns 409 when the backup is not successful or was deleted", async () => {
    const { source, destination } = await setup();
    const failed = await seedBackup(ctx.env, source.id, { status: "failed" });
    const deleted = await seedBackup(ctx.env, source.id, { deletedAt: "2026-10-24T01:00:00.000Z" });
    for (const backup of [failed, deleted]) {
      expect((await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" })).status).toBe(409);
    }
    expect(await allRestores()).toHaveLength(0);
  });

  it("returns 409 while another restore is queued or running on the destination", async () => {
    const { destination, backup } = await setup();
    await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id, status: "running" });
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    expect(res.status).toBe(409);
    expect(await allRestores()).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it("returns 409 while a backup is queued or running on the destination", async () => {
    const { source, backup } = await setup();
    await seedBackup(ctx.env, source.id, { status: "running" });
    const res = await restore(backup.id, { destinationTargetId: source.id, confirmName: "source-db", acknowledgeOverwrite: true });
    expect(res.status).toBe(409);
    expect(await allRestores()).toHaveLength(0);
  });

  it("marks the restore failed and answers 503 when the queue send fails, without leaking the error text", async () => {
    await ctx.dispose();
    await boot({ failSend: true });
    const { destination, backup } = await setup();
    const res = await restore(backup.id, { destinationTargetId: destination.id, confirmName: "scratch-db" });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("queue-secret");
    const rows = await allRestores();
    expect(rows[0]).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
    expect(rows[0]?.errorMessage).not.toContain("queue-secret");
  });
});
```
- [ ] Step 5: Verify - Run: `bun run typecheck && bunx vitest run test/worker/routes/backup-restore.test.ts test/worker/routes/backup-download.test.ts` - Expected: typecheck exits 0; 25 passed (16 restore + 9 download), 0 failed
- [ ] Step 6: Commit - `git add src/worker/routes/backup-actions.ts test/worker/routes/backup-restore.test.ts && git commit -m "feat: restore endpoint with typed-name confirmation, audit row, and queue message"`

---

### Task 8: Restore job runner and queue consumer hook

**Files:**
- Create: `src/worker/jobs/restore-job.ts`
- Modify: `src/worker/jobs/types.ts` (anchor: `JobMessage`, the `type:` union, planned)
- Modify: `src/worker/jobs/consumer.ts` (anchor: the `switch` on the message `type`, planned)
- Test: `test/worker/jobs/restore-job.test.ts`

**Interfaces:**
- Consumes: Phase 5 dispatch exports (Phase gate table): `TUNNEL_LOCAL_PORT`, `ContainerJobPayload`, `getCallbackUrl`, `deriveJobKey`, `toTunnelDbUrl`, `startContainer`; `decrypt`, `redactError`.
- Produces:
  - `type RestoreJobOutcome = "skipped" | "started" | "retry" | "failed"`
  - `MAX_START_ATTEMPTS: 3`
  - `runRestoreJob(env: Env, message: { jobId: string; attempts: number }, now?: Date): Promise<RestoreJobOutcome>`
  - `JobMessage["type"]` becomes `"backup" | "test" | "restore"`.

**Blast radius (shared type):** widening the `type` union breaks any exhaustive `switch` (a `never` check). At planning time the consumer is the only such place. Re-check: `grep -rn "JobMessage\|body.type" src test --include=*.ts` - every `switch` or `Record<JobMessage["type"], ...>` must get a `restore` entry in this commit. Hand-built messages in Phase 5 tests still compile (the union only grew).

**Gotcha:** the restore stays `queued` until the container's `started` callback (Task 9). The runner only starts the container. It ACKs duplicates (`skipped`). It never logs the payload: the payload holds the restore URL password, the tunnel secret, the job key, and the R2 secret.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/restore-job.ts`:
```ts
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { backups, restores, targets } from "../db/schema";
import type { Env } from "../env";
import { decrypt } from "../lib/crypto";
import { redactError } from "../lib/redact";
import { TUNNEL_LOCAL_PORT, deriveJobKey, getCallbackUrl, startContainer, toTunnelDbUrl, type ContainerJobPayload } from "./dispatch";

export type RestoreJobOutcome = "skipped" | "started" | "retry" | "failed";

/** The queue gives up retrying after this many deliveries; the restore row then becomes `failed`. */
export const MAX_START_ATTEMPTS = 3;
const R2_PART_SIZE_BYTES = 64 * 1024 * 1024;

type Db = ReturnType<typeof getDb>;

async function failRestore(db: Db, id: string, code: string, message: string, now: Date): Promise<"failed"> {
  await db
    .update(restores)
    .set({ status: "failed", errorCode: code, errorMessage: message, finishedAt: now.toISOString() })
    .where(and(eq(restores.id, id), inArray(restores.status, ["queued", "running"])));
  return "failed";
}

/**
 * Queue consumer branch for `type: "restore"`. Idempotent: only a `queued` row is started.
 * The row stays `queued` until the container sends its `started` callback.
 */
export async function runRestoreJob(env: Env, message: { jobId: string; attempts: number }, now = new Date()): Promise<RestoreJobOutcome> {
  const db = getDb(env);
  const [restore] = await db.select().from(restores).where(eq(restores.id, message.jobId)).limit(1);
  if (!restore || restore.status !== "queued") return "skipped";

  const [backup] = await db.select().from(backups).where(eq(backups.id, restore.sourceBackupId)).limit(1);
  if (!backup || backup.status !== "success" || backup.deletedAt !== null || backup.r2Key === null) {
    return failRestore(db, restore.id, "backup_unavailable", "The source backup is no longer available", now);
  }
  const [destination] = await db.select().from(targets).where(eq(targets.id, restore.destinationTargetId)).limit(1);
  if (!destination || destination.deletedAt !== null || destination.restoreUrlEnc === null) {
    return failRestore(db, restore.id, "target_unavailable", "The destination target was deleted or has no restore connection URL", now);
  }

  const restoreUrl = await decrypt(destination.restoreUrlEnc, env.ENCRYPTION_KEY);
  const tunnel: ContainerJobPayload["tunnel"] = {
    hostname: destination.tunnelHostname,
    tokenId: await decrypt(destination.tunnelTokenIdEnc, env.ENCRYPTION_KEY),
    tokenSecret: await decrypt(destination.tunnelTokenSecretEnc, env.ENCRYPTION_KEY),
    localPort: TUNNEL_LOCAL_PORT,
  };

  const payload: ContainerJobPayload = {
    jobId: restore.id,
    type: "restore",
    callbackUrl: getCallbackUrl(env),
    jobKey: await deriveJobKey(env, restore.id),
    deadlineAt: new Date(now.getTime() + destination.jobDeadlineMinutes * 60_000).toISOString(),
    db: { url: toTunnelDbUrl(restoreUrl, TUNNEL_LOCAL_PORT), name: restore.destinationDbName },
    tunnel,
    r2: {
      endpoint: env.R2_ENDPOINT,
      bucket: env.R2_BUCKET,
      key: backup.r2Key,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      partSizeBytes: R2_PART_SIZE_BYTES,
    },
    restore: { sourceKey: backup.r2Key, targetDbName: restore.destinationDbName },
  };

  try {
    await startContainer(env, payload);
    return "started";
  } catch (error) {
    if (message.attempts < MAX_START_ATTEMPTS) return "retry";
    return failRestore(db, restore.id, "start_failed", redactError(error), now);
  }
}
```
- [ ] Step 2: In `src/worker/jobs/types.ts` change the `type` union of `JobMessage` to `"backup" | "test" | "restore"`.
- [ ] Step 3: In `src/worker/jobs/consumer.ts` add the import `import { runRestoreJob } from "./restore-job";` and this case to the switch on the message type (use the variable names the file already uses for the message `msg`; `msg.attempts` is the Queues delivery count):
```ts
      case "restore": {
        const outcome = await runRestoreJob(env, { jobId: msg.body.jobId, attempts: msg.attempts });
        if (outcome === "retry") msg.retry({ delaySeconds: 30 });
        else msg.ack();
        break;
      }
```
- [ ] Step 4: Create `test/worker/jobs/restore-job.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { backups, restores } from "../../../src/worker/db/schema";
import { MAX_START_ATTEMPTS, runRestoreJob } from "../../../src/worker/jobs/restore-job";
import * as dispatch from "../../../src/worker/jobs/dispatch";
import { createTestEnv } from "../../helpers/env";
import { TEST_R2, seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

vi.mock("../../../src/worker/jobs/dispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/worker/jobs/dispatch")>()),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
}));

const startContainer = vi.mocked(dispatch.startContainer);
const NOW = new Date("2026-10-24T03:00:00.000Z");

let ctx: Awaited<ReturnType<typeof createTestEnv>>;

beforeEach(async () => {
  startContainer.mockReset();
  startContainer.mockResolvedValue(undefined);
  ctx = await createTestEnv(TEST_R2);
});
afterEach(async () => {
  await ctx.dispose();
});

async function queuedRestore(targetOptions: Parameters<typeof seedTarget>[1] = {}) {
  const source = await seedTarget(ctx.env, { name: "source-db" });
  const destination = await seedTarget(ctx.env, { name: "scratch-db", ...targetOptions });
  const backup = await seedBackup(ctx.env, source.id);
  const restore = await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id });
  return { source, destination, backup, restore };
}

const rowOf = async (id: string) => (await getDb(ctx.env).select().from(restores).where(eq(restores.id, id)))[0];

describe("runRestoreJob", () => {
  it("skips a restore that does not exist", async () => {
    expect(await runRestoreJob(ctx.env, { jobId: "missing", attempts: 1 }, NOW)).toBe("skipped");
    expect(startContainer).not.toHaveBeenCalled();
  });

  it("skips a restore that is no longer queued (duplicate delivery)", async () => {
    const { restore } = await queuedRestore();
    await getDb(ctx.env).update(restores).set({ status: "running" }).where(eq(restores.id, restore.id));
    expect(await runRestoreJob(ctx.env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("skipped");
    expect(startContainer).not.toHaveBeenCalled();
  });

  it("starts the container with the restore URL, the source key, and the destination target's deadline ", async () => {
    const { backup, restore } = await queuedRestore({ jobDeadlineMinutes: 90 });
    expect(await runRestoreJob(ctx.env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("started");
    expect(startContainer).toHaveBeenCalledTimes(1);
    const payload = startContainer.mock.calls[0]?.[1];
    expect(payload).toMatchObject({
      jobId: restore.id,
      type: "restore",
      deadlineAt: "2026-10-24T04:30:00.000Z",
      db: { name: "scratch" },
      tunnel: { hostname: "db.example.com", tokenId: "tunnel-id-1", tokenSecret: "tunnel-secret-1" },
      r2: { bucket: "cellar-backups", key: backup.r2Key, accessKeyId: "AKIDTEST" },
      restore: { sourceKey: backup.r2Key, targetDbName: "scratch" },
    });
    expect(payload?.db.url).toContain("restore_user:restore-pass-1@127.0.0.1:");
    expect(payload?.db.url).not.toContain("backup-pass-1");
    expect((await rowOf(restore.id))?.status).toBe("queued");
  });

  it("fails the restore when the source backup was deleted after it was queued", async () => {
    const { backup, restore } = await queuedRestore();
    await getDb(ctx.env).update(backups).set({ deletedAt: NOW.toISOString() }).where(eq(backups.id, backup.id));
    expect(await runRestoreJob(ctx.env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("failed");
    expect(await rowOf(restore.id)).toMatchObject({ status: "failed", errorCode: "backup_unavailable" });
    expect(startContainer).not.toHaveBeenCalled();
  });

  it("fails the restore when the destination target was soft-deleted", async () => {
    const { restore } = await queuedRestore({ deletedAt: "2026-10-24T01:00:00.000Z" });
    expect(await runRestoreJob(ctx.env, { jobId: restore.id, attempts: 1 }, NOW)).toBe("failed");
    expect(await rowOf(restore.id)).toMatchObject({ status: "failed", errorCode: "target_unavailable" });
  });

  it("asks the queue to retry when the container cannot start and attempts remain", async () => {
    const { restore } = await queuedRestore();
    startContainer.mockRejectedValue(new Error("no capacity"));
    expect(await runRestoreJob(ctx.env, { jobId: restore.id, attempts: MAX_START_ATTEMPTS - 1 }, NOW)).toBe("retry");
    expect((await rowOf(restore.id))?.status).toBe("queued");
  });

  it("fails the restore with a redacted message on the last attempt", async () => {
    const { restore } = await queuedRestore();
    startContainer.mockRejectedValue(new Error("boom postgres://restore_user:restore-pass-1@db.example.com/scratch"));
    expect(await runRestoreJob(ctx.env, { jobId: restore.id, attempts: MAX_START_ATTEMPTS }, NOW)).toBe("failed");
    const row = await rowOf(restore.id);
    expect(row).toMatchObject({ status: "failed", errorCode: "start_failed" });
    expect(row?.errorMessage).toContain("boom");
    expect(row?.errorMessage).not.toContain("restore-pass-1");
  });
});
```
- [ ] Step 5: Verify - Run: `bun run typecheck && bunx vitest run test/worker/jobs/restore-job.test.ts` - Expected: typecheck exits 0 (including the consumer switch); 7 passed, 0 failed
- [ ] Step 6: Commit - `git add src/worker/jobs test/worker/jobs/restore-job.test.ts && git commit -m "feat: start restore containers from the queue consumer"`

---

### Task 9: Restore callback handling and callback hook

**Files:**
- Create: `src/worker/jobs/restore-callback.ts`
- Modify: `src/worker/jobs/callback.ts` (anchor: the place after body parsing and the `backups` and connection-test lookups, before the unknown-job response, planned)
- Test: `test/worker/jobs/restore-callback.test.ts`

**Interfaces:**
- Consumes: `restores.lastSeq` (Task 3), `redactSecrets`, `getDb`.
- Produces:
  - `interface CallbackBody { jobId: string; event: "started" | "progress" | "succeeded" | "failed"; at: string; seq: number; error?: { code: string; message: string } }`
  - `type RestoreCallbackResult = "not_a_restore" | "ignored" | "applied"`
  - `handleRestoreCallback(db: ReturnType<typeof getDb>, body: CallbackBody, now?: Date): Promise<RestoreCallbackResult>`

**Gotcha:** the HMAC, timestamp window, and body shape are verified by the Phase 5 handler BEFORE this runs. This function does not verify anything. Each event is one guarded UPDATE: `last_seq < seq` rejects replays, and the status guard keeps terminal states final. `started_at`, `heartbeat_at`, and `finished_at` come from the Worker clock. A lost `started` event does not block a later `succeeded` or `failed`.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/restore-callback.ts`:
```ts
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
  return code !== undefined && /^[A-Z_]{1,40}$/.test(code) ? code : "UNKNOWN";
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
        await db.update(restores).set({ status: "running", startedAt: at, heartbeatAt: at, lastSeq: body.seq })
          .where(and(fresh, eq(restores.status, "queued"))).returning({ id: restores.id }),
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
```
- [ ] Step 2: In `src/worker/jobs/callback.ts`, import `handleRestoreCallback` and, at the point named above (the verified body is in a variable shaped like `CallbackBody`; use the file's own names for `db` and the body), add:
```ts
  const restoreResult = await handleRestoreCallback(db, body);
  if (restoreResult !== "not_a_restore") return c.json({ ok: true });
```
The handler's response for an applied or ignored event must match what it returns for a `backups` job (the same `200`). Terminal-state and replay events answer `200` too, so the container does not retry.
- [ ] Step 3: Create `test/worker/jobs/restore-callback.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { restores } from "../../../src/worker/db/schema";
import { handleRestoreCallback, type CallbackBody } from "../../../src/worker/jobs/restore-callback";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let restoreId: string;

beforeEach(async () => {
  ctx = await createTestEnv();
  const source = await seedTarget(ctx.env);
  const destination = await seedTarget(ctx.env);
  const backup = await seedBackup(ctx.env, source.id);
  restoreId = (await seedRestore(ctx.env, { sourceBackupId: backup.id, destinationTargetId: destination.id })).id;
});
afterEach(async () => {
  await ctx.dispose();
});

const T1 = new Date("2026-10-24T03:00:00.000Z");
const T2 = new Date("2026-10-24T03:00:30.000Z");
const T3 = new Date("2026-10-24T03:05:00.000Z");

const event = (seq: number, name: CallbackBody["event"], error?: CallbackBody["error"]): CallbackBody => ({
  jobId: restoreId,
  event: name,
  at: "2026-10-24T03:00:00.000Z",
  seq,
  ...(error ? { error } : {}),
});
const apply = (body: CallbackBody, now: Date) => handleRestoreCallback(getDb(ctx.env), body, now);
const row = async () => (await getDb(ctx.env).select().from(restores).where(eq(restores.id, restoreId)))[0];

describe("handleRestoreCallback", () => {
  it("reports ids that are not restores so the caller can try other job types", async () => {
    expect(await apply({ ...event(1, "started"), jobId: "someone-else" }, T1)).toBe("not_a_restore");
  });

  it("moves queued to running on started and stamps start and heartbeat from the Worker clock", async () => {
    expect(await apply(event(1, "started"), T1)).toBe("applied");
    expect(await row()).toMatchObject({ status: "running", startedAt: T1.toISOString(), heartbeatAt: T1.toISOString(), lastSeq: 1 });
  });

  it("updates only the heartbeat on progress", async () => {
    await apply(event(1, "started"), T1);
    expect(await apply(event(2, "progress"), T2)).toBe("applied");
    expect(await row()).toMatchObject({ status: "running", startedAt: T1.toISOString(), heartbeatAt: T2.toISOString(), lastSeq: 2 });
  });

  it("ignores a replayed or out-of-order seq", async () => {
    await apply(event(1, "started"), T1);
    await apply(event(3, "progress"), T2);
    expect(await apply(event(3, "progress"), T3)).toBe("ignored");
    expect(await apply(event(2, "progress"), T3)).toBe("ignored");
    expect(await row()).toMatchObject({ heartbeatAt: T2.toISOString(), lastSeq: 3 });
  });

  it("ignores progress for a restore that is not running", async () => {
    expect(await apply(event(1, "progress"), T1)).toBe("ignored");
    expect((await row())?.status).toBe("queued");
  });

  it("marks success once and never changes a terminal state afterwards", async () => {
    await apply(event(1, "started"), T1);
    expect(await apply(event(2, "succeeded"), T2)).toBe("applied");
    expect(await row()).toMatchObject({ status: "success", finishedAt: T2.toISOString() });
    expect(await apply(event(3, "failed", { code: "UNKNOWN", message: "late" }), T3)).toBe("ignored");
    expect(await apply(event(4, "succeeded"), T3)).toBe("ignored");
    expect(await row()).toMatchObject({ status: "success", finishedAt: T2.toISOString(), errorCode: null });
  });

  it("accepts a terminal event even when the started event was lost", async () => {
    expect(await apply(event(2, "succeeded"), T2)).toBe("applied");
    expect((await row())?.status).toBe("success");
  });

  it("stores a failure with its error code and a redacted message", async () => {
    await apply(event(1, "started"), T1);
    const message = "pg_restore: connection to postgres://restore_user:restore-pass-1@127.0.0.1:15432/scratch failed";
    expect(await apply(event(2, "failed", { code: "RESTORE_FAILED", message }), T2)).toBe("applied");
    const stored = await row();
    expect(stored).toMatchObject({ status: "failed", errorCode: "RESTORE_FAILED", finishedAt: T2.toISOString() });
    expect(stored?.errorMessage).toContain("pg_restore");
    expect(stored?.errorMessage).not.toContain("restore-pass-1");
  });

  it("replaces an unusable error code with UNKNOWN and caps the message length", async () => {
    await apply(event(1, "started"), T1);
    await apply(event(2, "failed", { code: "drop table; --", message: "x".repeat(5000) }), T2);
    const stored = await row();
    expect(stored?.errorCode).toBe("UNKNOWN");
    expect(stored?.errorMessage?.length).toBe(1000);
  });
});
```
- [ ] Step 4: Verify - Run: `bun run typecheck && bunx vitest run test/worker/jobs/restore-callback.test.ts` - Expected: typecheck exits 0; 9 passed, 0 failed
- [ ] Step 5: Commit - `git add src/worker/jobs/restore-callback.ts src/worker/jobs/callback.ts test/worker/jobs/restore-callback.test.ts && git commit -m "feat: apply container callbacks to restore rows"`

---

### Task 10: Restore sweeper and sweeper hook

**Files:**
- Create: `src/worker/jobs/restore-sweeper.ts`
- Modify: `src/worker/jobs/sweeper.ts` (anchor: `sweepStaleJobs`, planned)
- Test: `test/worker/jobs/restore-sweeper.test.ts`

**Interfaces:**
- Consumes: `stopContainer` (Phase gate table), `restores`, `targets`.
- Produces:
  - `interface RestoreSweepResult { timedOut: string[]; queueTimedOut: string[] }`
  - `sweepRestores(env: Env, now?: Date): Promise<RestoreSweepResult>`
  - `sweepStaleJobs` (Phase 5) also calls `sweepRestores(env, now)`.

**Gotcha:** rules are PLAN.md section 6: `running` with no heartbeat for 5 minutes (or since `started_at` if none), or past `started_at + destination.job_deadline_minutes`, becomes `timed_out` with `error_code = TIMEOUT`; `queued` for more than 1 hour becomes `failed` with `queue_timeout`. Every update is guarded by the current status so a late callback wins. A failing `stopContainer` is logged without details and does not stop the sweep. Isolation: `stopContainer` is mocked in the test.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/restore-sweeper.ts`:
```ts
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../db/client";
import { restores, targets } from "../db/schema";
import type { Env } from "../env";
import { stopContainer } from "./dispatch";

const HEARTBEAT_TIMEOUT_MS = 5 * 60_000;
const QUEUE_TIMEOUT_MS = 60 * 60_000;

export interface RestoreSweepResult {
  timedOut: string[];
  queueTimedOut: string[];
}

/**
 * PLAN.md section 6 rules, applied to `restores`:
 * - `running` with no heartbeat for 5 minutes, or past `started_at + destination job_deadline_minutes`, becomes `timed_out`.
 * - `queued` for more than 1 hour becomes `failed` with `error_code = queue_timeout`.
 * Updates are guarded by the current status, so a callback that wins the race is never overwritten.
 */
export async function sweepRestores(env: Env, now = new Date()): Promise<RestoreSweepResult> {
  const db = getDb(env);
  const nowMs = now.getTime();
  const at = now.toISOString();
  const result: RestoreSweepResult = { timedOut: [], queueTimedOut: [] };

  const running = await db
    .select({ id: restores.id, startedAt: restores.startedAt, heartbeatAt: restores.heartbeatAt, deadlineMinutes: targets.jobDeadlineMinutes })
    .from(restores)
    .innerJoin(targets, eq(targets.id, restores.destinationTargetId))
    .where(eq(restores.status, "running"));

  for (const row of running) {
    const lastBeatMs = Date.parse(row.heartbeatAt ?? row.startedAt ?? at);
    const deadlineMs = Date.parse(row.startedAt ?? at) + row.deadlineMinutes * 60_000;
    if (nowMs - lastBeatMs <= HEARTBEAT_TIMEOUT_MS && nowMs <= deadlineMs) continue;
    const changed = await db
      .update(restores)
      .set({ status: "timed_out", errorCode: "TIMEOUT", errorMessage: "No heartbeat from the container, or the job deadline passed", finishedAt: at })
      .where(and(eq(restores.id, row.id), eq(restores.status, "running")))
      .returning({ id: restores.id });
    if (changed.length === 0) continue;
    result.timedOut.push(row.id);
    try {
      await stopContainer(env, row.id);
    } catch {
      console.warn(`restore sweeper: stopContainer failed for ${row.id}`);
    }
  }

  const queued = await db
    .update(restores)
    .set({ status: "failed", errorCode: "queue_timeout", errorMessage: "The restore waited in the queue for more than 1 hour", finishedAt: at })
    .where(and(eq(restores.status, "queued"), lt(restores.queuedAt, new Date(nowMs - QUEUE_TIMEOUT_MS).toISOString())))
    .returning({ id: restores.id });
  result.queueTimedOut.push(...queued.map((r) => r.id));
  return result;
}
```
- [ ] Step 2: In `src/worker/jobs/sweeper.ts`, import `sweepRestores` and call `await sweepRestores(env, now);` inside `sweepStaleJobs`, after the existing backup and connection-test sweeps (use the function's own names for `env` and `now`). Keep the existing return value; do not merge result shapes.
- [ ] Step 3: Create `test/worker/jobs/restore-sweeper.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../../src/worker/db/client";
import { restores } from "../../../src/worker/db/schema";
import * as dispatch from "../../../src/worker/jobs/dispatch";
import { sweepRestores } from "../../../src/worker/jobs/restore-sweeper";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

vi.mock("../../../src/worker/jobs/dispatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/worker/jobs/dispatch")>()),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
}));

const stopContainer = vi.mocked(dispatch.stopContainer);
const NOW = new Date("2026-10-24T12:00:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let sourceId: string;
let backupId: string;

beforeEach(async () => {
  stopContainer.mockReset();
  stopContainer.mockResolvedValue(undefined);
  ctx = await createTestEnv();
  sourceId = (await seedTarget(ctx.env)).id;
  backupId = (await seedBackup(ctx.env, sourceId)).id;
});
afterEach(async () => {
  await ctx.dispose();
});

/** Each restore gets its own destination target: only one queued or running restore may exist per destination. */
async function restoreRow(o: Omit<Parameters<typeof seedRestore>[1], "sourceBackupId" | "destinationTargetId"> & { deadlineMinutes?: number }) {
  const destination = await seedTarget(ctx.env, { jobDeadlineMinutes: o.deadlineMinutes ?? 120 });
  return seedRestore(ctx.env, { ...o, sourceBackupId: backupId, destinationTargetId: destination.id });
}
const rowOf = async (id: string) => (await getDb(ctx.env).select().from(restores).where(eq(restores.id, id)))[0];

describe("sweepRestores", () => {
  it("leaves a running restore with a fresh heartbeat alone", async () => {
    const fresh = await restoreRow({ status: "running", startedAt: ago(30), heartbeatAt: ago(1) });
    expect(await sweepRestores(ctx.env, NOW)).toEqual({ timedOut: [], queueTimedOut: [] });
    expect((await rowOf(fresh.id))?.status).toBe("running");
    expect(stopContainer).not.toHaveBeenCalled();
  });

  it("times out a running restore with no heartbeat for more than 5 minutes and stops its container", async () => {
    const stale = await restoreRow({ status: "running", startedAt: ago(30), heartbeatAt: ago(6) });
    const result = await sweepRestores(ctx.env, NOW);
    expect(result.timedOut).toEqual([stale.id]);
    expect(await rowOf(stale.id)).toMatchObject({ status: "timed_out", errorCode: "TIMEOUT", finishedAt: NOW.toISOString() });
    expect(stopContainer).toHaveBeenCalledWith(ctx.env, stale.id);
  });

  it("uses started_at when no heartbeat has arrived yet", async () => {
    const stale = await restoreRow({ status: "running", startedAt: ago(10), heartbeatAt: null });
    expect((await sweepRestores(ctx.env, NOW)).timedOut).toEqual([stale.id]);
  });

  it("times out a running restore past the destination target's deadline even with a fresh heartbeat", async () => {
    const late = await restoreRow({ status: "running", startedAt: ago(61), heartbeatAt: ago(1), deadlineMinutes: 60 });
    const ontime = await restoreRow({ status: "running", startedAt: ago(59), heartbeatAt: ago(1), deadlineMinutes: 60 });
    const result = await sweepRestores(ctx.env, NOW);
    expect(result.timedOut).toEqual([late.id]);
    expect((await rowOf(ontime.id))?.status).toBe("running");
  });

  it("fails a restore that waited in the queue for more than 1 hour with queue_timeout", async () => {
    const old = await restoreRow({ status: "queued", queuedAt: ago(61) });
    const recent = await restoreRow({ status: "queued", queuedAt: ago(59) });
    const result = await sweepRestores(ctx.env, NOW);
    expect(result.queueTimedOut).toEqual([old.id]);
    expect(await rowOf(old.id)).toMatchObject({ status: "failed", errorCode: "queue_timeout" });
    expect((await rowOf(recent.id))?.status).toBe("queued");
    expect(stopContainer).not.toHaveBeenCalled();
  });

  it("does not touch finished restores", async () => {
    const done = await restoreRow({ status: "success", startedAt: ago(500), heartbeatAt: ago(400), queuedAt: ago(600) });
    const failed = await restoreRow({ status: "failed", queuedAt: ago(600) });
    expect(await sweepRestores(ctx.env, NOW)).toEqual({ timedOut: [], queueTimedOut: [] });
    expect((await rowOf(done.id))?.status).toBe("success");
    expect((await rowOf(failed.id))?.status).toBe("failed");
  });

  it("still marks the row when stopping the container fails", async () => {
    stopContainer.mockRejectedValue(new Error("container already gone"));
    const stale = await restoreRow({ status: "running", startedAt: ago(30), heartbeatAt: ago(9) });
    expect((await sweepRestores(ctx.env, NOW)).timedOut).toEqual([stale.id]);
    expect((await rowOf(stale.id))?.status).toBe("timed_out");
  });
});
```
- [ ] Step 4: Verify - Run: `bun run typecheck && bunx vitest run test/worker/jobs/restore-sweeper.test.ts` - Expected: typecheck exits 0; 7 passed, 0 failed
- [ ] Step 5: Commit - `git add src/worker/jobs/restore-sweeper.ts src/worker/jobs/sweeper.ts test/worker/jobs/restore-sweeper.test.ts && git commit -m "feat: sweep stuck restores"`

---

### Task 11: `GET /api/restores` and `GET /api/restores/:id`

**Files:**
- Create: `src/worker/routes/restores.ts`
- Modify: `src/worker/app.ts` (anchor: the `app.route("/api/backups", backupActions)` line from Task 5)
- Test: `test/worker/routes/restores.test.ts`

**Interfaces:**
- Consumes: `parseQuery`, `ApiError`, `getDb`, fixtures.
- Produces: `restoresRoutes: Hono<AppEnv>` mounted at `/api/restores`.
  - `GET /api/restores?targetId&limit&cursor` returns `{ items: RestoreView[]; nextCursor: string | null }` newest first (`queued_at` desc, then `id` desc). `limit` default 50, max 200 (register X7). `targetId` filters `destination_target_id`. An invalid cursor or limit is 400 `validation_error`.
  - `GET /api/restores/:id` returns one `RestoreView` or 404 `not_found`.
  - `RestoreView = { id; sourceBackupId; destinationTargetId; destinationDbName; status; actor; sameDatabase: boolean; errorCode; errorMessage; queuedAt; startedAt; finishedAt }`. It omits `heartbeatAt` and `lastSeq`.

**Gotcha:** if Phase 2 exported a shared cursor helper (assumption A4), import it and delete the two private functions; record a `> Deviation:`. A cursor is opaque to clients (base64url of `[queuedAt, id]`).

**Steps:**
- [ ] Step 1: Create `src/worker/routes/restores.ts`:
```ts
import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { restores } from "../db/schema";
import { parseQuery } from "../lib/validate";
import { ApiError } from "../middleware/error";
import type { AppEnv } from "../middleware/access";

export const restoresRoutes = new Hono<AppEnv>();

const listQuery = z.object({
  targetId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

function toView(row: typeof restores.$inferSelect) {
  return {
    id: row.id,
    sourceBackupId: row.sourceBackupId,
    destinationTargetId: row.destinationTargetId,
    destinationDbName: row.destinationDbName,
    status: row.status,
    actor: row.actor,
    sameDatabase: row.isSourceOverwrite,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function encodeCursor(row: { queuedAt: string | null; id: string }): string {
  return btoa(JSON.stringify([row.queuedAt ?? "", row.id])).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): { queuedAt: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return { queuedAt: parsed[0], id: parsed[1] };
    }
  } catch {
    // falls through to the error below
  }
  throw new ApiError(400, "validation_error", "Invalid cursor", { field: "cursor" });
}

restoresRoutes.get("/", async (c) => {
  const query = parseQuery(c, listQuery);
  const db = getDb(c.env);
  const after = query.cursor ? decodeCursor(query.cursor) : null;
  const rows = await db
    .select()
    .from(restores)
    .where(
      and(
        query.targetId ? eq(restores.destinationTargetId, query.targetId) : undefined,
        after ? or(lt(restores.queuedAt, after.queuedAt), and(eq(restores.queuedAt, after.queuedAt), lt(restores.id, after.id))) : undefined,
      ),
    )
    .orderBy(desc(restores.queuedAt), desc(restores.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  return c.json({ items: page.map(toView), nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null });
});

restoresRoutes.get("/:id", async (c) => {
  const [row] = await getDb(c.env).select().from(restores).where(eq(restores.id, c.req.param("id"))).limit(1);
  if (!row) throw new ApiError(404, "not_found", "Restore not found");
  return c.json(toView(row));
});
```
- [ ] Step 2: In `src/worker/app.ts` add `import { restoresRoutes } from "./routes/restores";` and `app.route("/api/restores", restoresRoutes);` right after the `backupActions` line.
- [ ] Step 3: Create `test/worker/routes/restores.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../../src/worker/app";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedRestore, seedTarget } from "../../helpers/restore-fixtures";

let ctx: Awaited<ReturnType<typeof createTestEnv>>;
let backupId: string;
let destinationA: string;
let destinationB: string;

beforeEach(async () => {
  ctx = await createTestEnv();
  backupId = (await seedBackup(ctx.env, (await seedTarget(ctx.env)).id)).id;
  destinationA = (await seedTarget(ctx.env)).id;
  destinationB = (await seedTarget(ctx.env)).id;
});
afterEach(async () => {
  await ctx.dispose();
});

const get = (path: string) => app.request(`http://localhost${path}`, {}, ctx.env);
type Page = { items: { id: string; status: string }[]; nextCursor: string | null };

async function seedHistory() {
  const base = { sourceBackupId: backupId, status: "success" as const };
  await seedRestore(ctx.env, { ...base, id: "r-1", destinationTargetId: destinationA, queuedAt: "2026-10-24T01:00:00.000Z" });
  await seedRestore(ctx.env, { ...base, id: "r-2", destinationTargetId: destinationB, queuedAt: "2026-10-24T02:00:00.000Z" });
  await seedRestore(ctx.env, { ...base, id: "r-3", destinationTargetId: destinationA, queuedAt: "2026-10-24T03:00:00.000Z" });
}

describe("GET /api/restores", () => {
  it("lists newest first", async () => {
    await seedHistory();
    const page = (await (await get("/api/restores")).json()) as Page;
    expect(page.items.map((i) => i.id)).toEqual(["r-3", "r-2", "r-1"]);
    expect(page.nextCursor).toBeNull();
  });

  it("filters by destination targetId", async () => {
    await seedHistory();
    const page = (await (await get(`/api/restores?targetId=${destinationA}`)).json()) as Page;
    expect(page.items.map((i) => i.id)).toEqual(["r-3", "r-1"]);
  });

  it("pages with an opaque cursor and visits every row once", async () => {
    await seedHistory();
    const first = (await (await get("/api/restores?limit=2")).json()) as Page;
    expect(first.items.map((i) => i.id)).toEqual(["r-3", "r-2"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (await get(`/api/restores?limit=2&cursor=${first.nextCursor}`)).json()) as Page;
    expect(second.items.map((i) => i.id)).toEqual(["r-1"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor and an out-of-range limit with 400", async () => {
    expect((await get("/api/restores?cursor=!!!")).status).toBe(400);
    expect((await get("/api/restores?limit=201")).status).toBe(400);
    expect((await get("/api/restores?limit=0")).status).toBe(400);
  });
});

describe("GET /api/restores/:id", () => {
  it("returns the public fields only", async () => {
    await seedRestore(ctx.env, { id: "r-9", sourceBackupId: backupId, destinationTargetId: destinationA, status: "running", isSourceOverwrite: true, lastSeq: 4, heartbeatAt: "2026-10-24T01:00:00.000Z" });
    const res = await get("/api/restores/r-9");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "r-9",
      sourceBackupId: backupId,
      destinationTargetId: destinationA,
      destinationDbName: "scratch",
      status: "running",
      actor: "dev@localhost",
      sameDatabase: true,
      errorCode: null,
      errorMessage: null,
      queuedAt: "2026-10-24T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
    });
  });

  it("returns 404 for an unknown id", async () => {
    expect((await get("/api/restores/nope")).status).toBe(404);
  });
});
```
- [ ] Step 4: Verify - Run: `bun run typecheck && bunx vitest run test/worker/routes/restores.test.ts` - Expected: typecheck exits 0; 6 passed, 0 failed
- [ ] Step 5: Commit - `git add src/worker/routes/restores.ts src/worker/app.ts test/worker/routes/restores.test.ts && git commit -m "feat: list and read restores"`

---

### Task 12: Update `docs/PLAN.md`

**Files:**
- Modify: `docs/PLAN.md` (anchors below)

**Interfaces:**
- Consumes: Decisions 1 to 12 above.
- Produces: PLAN.md that matches the code.

**Steps:**
- [ ] Step 1: Apply these edits (grep each anchor first; if a string differs, adjust minimally):
  1. Section 4 table: the row that starts `| POST /api/backups/:id/restore |` already matches (owner round 2, with `acknowledgeOverwrite`, 400 and 409 rules). Check it; change it only if it differs from Decisions 1 to 4. Do not remove `acknowledgeOverwrite`.
  2. Section 4 table: in the row that starts `| POST /api/backups/:id/download-url |`, append to the Response cell: ` Lifetime is `min(settings.download_url_ttl_seconds, 900)` seconds, default 900. Only `success` backups that are not deleted.`
  3. Section 3, `restores` table: after the row that starts `| queued_at, started_at, finished_at, heartbeat_at |` add `| last_seq | integer NOT NULL DEFAULT 0 | highest callback `seq` applied (replay protection) |`. In the line that starts `Indexes: `(destination_target_id, queued_at DESC)`` append `; unique `(destination_target_id) WHERE status IN ('queued','running')` (one active restore per destination)`.
  4. Section 3, `settings` keys line: change `download_url_ttl_seconds` to `download_url_ttl_seconds` (integer 1 to 900, default 900).
  5. Section 6, the line `- The same rules apply to `restores`.`: append ` For restores the deadline is `started_at` plus the destination target's `job_deadline_minutes`.`
  6. Section 2 repo structure: in the `routes/` line add `backup-actions.ts`; in the `jobs/` line add `restore-job.ts  restore-callback.ts  restore-sweeper.ts`; in the `lib/` line add `restore-rules.ts`.
  7. Section 4 intro or notes: add one line `R2_REGION (optional env var) sets the SigV4 region for presigned URLs; R2 uses "auto", local RustFS needs us-east-1.`
- [ ] Step 2: Verify - Run: `grep -c "confirmDbName" docs/PLAN.md; grep -c "acknowledgeOverwrite" docs/PLAN.md; grep -c "confirmName" docs/PLAN.md; grep -c "last_seq" docs/PLAN.md; grep -c $'\xe2\x80\x94' docs/PLAN.md` - Expected: `0`, `1` or more, `1` or more, `1` or more, `0`
- [ ] Step 3: Commit - `git add docs/PLAN.md && git commit -m "docs: align PLAN.md with phase 7 restore and download"`

## Failure handling summary

- **Phase gate reports a missing file or export** - Detect: `MISSING` lines. Respond: STOP and report which earlier phase moved. Do not recreate Phase 2 to 6 code.
- **Phase 5 stores replay `seq` somewhere other than a `last_seq` column** - Detect: Phase gate Step 3 grep shows another mechanism or none. Respond: STOP and report; Tasks 3 and 9 mirror `last_seq`.
- **drizzle-kit generates a table rebuild for `restores`** - Detect: the migration drops and recreates `restores`. Respond: keep it only if every column and index survives (compare with the Phase 1 plan), otherwise STOP; never edit an applied migration.
- **A restore reaches the real source database in the end-to-end run** - Detect: row counts on the sample database change. Respond: STOP, report. The scratch databases must be the only restore destinations.
- **`bun run dev` cannot reach RustFS for the presigned URL** - Detect: `403 SignatureDoesNotMatch` or a region error. Respond: check `R2_REGION=us-east-1` in `.dev.vars` and that the host in `R2_ENDPOINT` is the one `curl` can reach; the host is part of the signature.

## End-to-end verification

Run after Task 12, with the Preflight stack up. Restoring is destructive: every restore below targets the scratch databases only.
Use one shell for the whole section and `export` `API=http://localhost:8787` first. Ids are saved to `/tmp/phase7-e2e.env` (no secrets). Commands use `DEV_BYPASS`, so no Access token is needed.

- [ ] Run: `bun run test && bun run typecheck` - Expected: both exit 0 (AGENTS.md phase rule). New tests in this phase: 82.
- [ ] Manual: create two targets and a successful backup of the first.
```bash
create() { curl -sf -X POST "$API/api/targets" -H 'content-type: application/json' -d "$1" | jq -r .id; }
SRC=$(create "{\"name\":\"e2e-source\",\"connectionUrl\":\"$SRC_CONN_URL\",\"restoreUrl\":\"$SCRATCH_A_URL\",$TUNNEL_FIELDS}")
DST=$(create "{\"name\":\"e2e-scratch\",\"connectionUrl\":\"$SRC_CONN_URL\",\"restoreUrl\":\"$SCRATCH_B_URL\",$TUNNEL_FIELDS}")
BK=$(curl -sf -X POST "$API/api/targets/$SRC/backup" | jq -r .backupId)
for i in $(seq 1 60); do S=$(curl -sf "$API/api/backups/$BK" | jq -r .status); [ "$S" = success ] && break; sleep 5; done
echo "SRC=$SRC DST=$DST BK=$BK" > /tmp/phase7-e2e.env; echo "backup status: $S"
```
  Expected: `backup status: success`. (Use the create-body field names Phase 2 defined if they differ.)
- [ ] Manual: download works, is checksummed, and expires.
```bash
. /tmp/phase7-e2e.env
RES=$(curl -sf -X POST "$API/api/backups/$BK/download-url"); URL=$(echo "$RES" | jq -r .url)
curl -sf "$URL" -o /tmp/phase7.dump && shasum -a 256 /tmp/phase7.dump | cut -d' ' -f1
curl -sf "$API/api/backups/$BK" | jq -r .sha256
pg_restore --list /tmp/phase7.dump > /dev/null && echo list-ok
echo "$URL" | grep -o 'X-Amz-Expires=[0-9]*'
curl -s -o /dev/null -w '%{http_code}\n' "${URL%?}0"
```
  Expected: the two hashes are equal; `list-ok`; `X-Amz-Expires=900` (or less); the tampered URL prints `403`.
- [ ] Manual: a wrong confirmName is rejected and nothing starts.
```bash
. /tmp/phase7-e2e.env
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/backups/$BK/restore" -H 'content-type: application/json' -d "{\"destinationTargetId\":\"$DST\",\"confirmName\":\"wrong\"}"
curl -sf "$API/api/restores?targetId=$DST" | jq '.items | length'
```
  Expected: `400`, then `0`.
- [ ] Manual: restore into the other target's scratch database, then compare row counts per table.
```bash
. /tmp/phase7-e2e.env
R=$(curl -sf -X POST "$API/api/backups/$BK/restore" -H 'content-type: application/json' -d "{\"destinationTargetId\":\"$DST\",\"confirmName\":\"e2e-scratch\"}"); echo "$R"
RID=$(echo "$R" | jq -r .restoreId); echo "RID=$RID" >> /tmp/phase7-e2e.env
for i in $(seq 1 90); do S=$(curl -sf "$API/api/restores/$RID" | jq -r .status); case "$S" in success|failed|timed_out) break;; esac; sleep 5; done
echo "restore status: $S"
for t in $(psql "$SRC_CONN_URL" -Atc "select tablename from pg_tables where schemaname='public' order by 1"); do
  a=$(psql "$SRC_CONN_URL" -Atc "select count(*) from \"$t\""); b=$(psql "$SCRATCH_B_URL" -Atc "select count(*) from \"$t\"")
  [ "$a" = "$b" ] && echo "ok $t $a" || echo "MISMATCH $t src=$a dst=$b"
done
```
  Expected: the POST prints `"sameDatabase":false`; `restore status: success`; one `ok <table> <n>` line per table (at least one) and no `MISMATCH`.
- [ ] Manual: restore into the source target (its restore URL points at scratch database A). Without `acknowledgeOverwrite` it is refused; with it, a second request is refused while the first is active.
```bash
. /tmp/phase7-e2e.env
noack="{\"destinationTargetId\":\"$SRC\",\"confirmName\":\"e2e-source\"}"
body="{\"destinationTargetId\":\"$SRC\",\"confirmName\":\"e2e-source\",\"acknowledgeOverwrite\":true}"
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/api/backups/$BK/restore" -H 'content-type: application/json' -d "$noack"
A=$(curl -s -o /tmp/p7a.json -w '%{http_code}' -X POST "$API/api/backups/$BK/restore" -H 'content-type: application/json' -d "$body") &
B=$(curl -s -o /tmp/p7b.json -w '%{http_code}' -X POST "$API/api/backups/$BK/restore" -H 'content-type: application/json' -d "$body"); wait
cat /tmp/p7a.json /tmp/p7b.json
```
  Expected: the first line (no acknowledgement) prints `400`. Then exactly one of the two responses is `202` with `"sameDatabase":true`, the other is `409` with code `conflict`. After the accepted restore reaches `success` (poll `GET /api/restores/<id>` as above), the per-table counts of `SCRATCH_A_URL` equal those of `SRC_CONN_URL`.
- [ ] Manual: audit rows exist for the download and both restores.
```bash
. /tmp/phase7-e2e.env
curl -sf "$API/api/audit-logs?entityType=backup&entityId=$BK" | jq -r '.items[].action' | sort -u
curl -sf "$API/api/audit-logs?entityType=restore&entityId=$RID" | jq -r '.items[].action' | sort -u
```
  Expected: the first prints `backup.download`; the second prints `restore.start`.
- [ ] Manual: no secret or signed URL reached the dev server log.
```bash
. /tmp/phase7-e2e.env
grep -c "X-Amz-Signature" /tmp/cellar-dev.log; grep -c "$(echo "$SCRATCH_B_URL" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#')" /tmp/cellar-dev.log
```
  Expected: `0` and `0` (no signature, and no restore-URL password, in the log).

## Scratch runs

- `/tmp/phase-7-scratch/s3-presign.ts` and `s3-presign.test.ts` (Task 1): run with Vitest 5.0.5 on Bun 1.3.5, 4 tests passed. The AWS documentation example gives signature `aeeed9bb...d404`. The R2-style URL (key with a space, region `auto`) and the local-endpoint-style URL (port, region `us-east-1`) were each compared with botocore `S3SigV4QueryAuth` using a pinned clock: signatures `27d0d554...ed0b` and `49b6aebf...39e9` matched exactly. The expected strings in the test are botocore's output.
- `/tmp/phase-7-scratch/restore-rules.ts` and `restore-rules.test.ts` (Task 2): 20 tests passed.
- `/tmp/phase-7-scratch/sql.ts` (Task 3 and Task 9 idioms): partial unique index and `UPDATE ... WHERE last_seq < ? ... RETURNING` behave as described in Preflight.
- Round 2 re-run (after renaming MinIO to RustFS in the signer comment and test title): `final-presign.test.ts` 4 passed and `restore-rules.test.ts` 20 passed.
- NOT run: every other snippet (routes, fixtures, runner, callback, sweeper, and their tests), because they need Phases 1 to 6.

## Phase summary (fill in at the end of execution)

The executor ends the phase with this block, using real numbers (AGENTS.md):

- ✅ Completed: download URL endpoint, restore endpoint (with `acknowledgeOverwrite`), restore job runner, callback and sweeper support, restore list and read endpoints, `restores.last_seq` migration, settings key, PLAN.md updates.
- 🧪 Tests and results: `bun run test` and `bun run typecheck` results; 82 new tests; the end-to-end row-count output.
- ⚠️ Open issues and decisions needed: none from the owner (round 2 closed Q-overwrite-ack, Q-busy, Q-concurrency); a backup that starts while a restore runs is not blocked (Phase 5 consumer rule); cross-version restores fail inside `pg_restore`; Cross-phase assumptions A1 to A4 and any `> Deviation:` lines.
