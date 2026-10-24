# Phase 5: Orchestration (cron, queue, container, callback, Backup now) Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-5-orchestration-cron-queue-callback.md` - the runner that ticks these
> checkboxes and honours the layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE Task 0 and report anything down.
> The code in the steps is a reference implementation.
> Everything marked "run in scratch" below was type-checked and run in a scratch project in `/tmp/phase-5-scratch/repo` (83 tests passed), but not in this repo. The two Phase 4 contract tests (Task 7 payload shape, Task 8 `SIGNATURE_VECTOR`) were added after that run and are not run in scratch, because they import `container/contract.ts`.
> After the owner's round 2 answers (no direct mode, backup limit counts backups only, 32 MiB parts, `max_instances` 2, default limit 1) the changed snippets were edited in that scratch project and re-run: `tsc --noEmit` clean and 83 tests pass (the removed direct-mode test is replaced by an undecryptable-secret test; one connection-test limit test is replaced by two). Re-run snippets: Task 3 constants, Task 4 default, Task 5 `wrangler.jsonc` value, Task 6 `claimJob`, Task 7 payload and tests.
> When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Wire the backup pipeline end to end: a per-minute cron enqueues due targets, a Queue consumer starts a Cloudflare Container per job, the container reports back through an HMAC-signed callback, and the API offers Backup now, Test connection, backup history, and settings.
**Architecture:** The cron handler inserts a `queued` `backups` row per due slot (unique indexes make it idempotent), sends an ids-only queue message, and advances `next_run_at`. The queue consumer atomically claims the row (`queued` to `running`, with the global and per-target limits checked inside one SQL statement), decrypts secrets in memory, and calls the `JobRunner` Durable Object, which starts the container and writes the job JSON to the runner's stdin. The container calls back on a virtual host that the Durable Object intercepts and forwards into the Hono app, where `/internal/jobs/callback` verifies HMAC, timestamp, and `seq` before changing any row.
**Tech Stack:** Bun 1.3, TypeScript, Hono, Drizzle + D1, Cloudflare Queues, Cron Triggers, Durable Object Container API (`ctx.container`, native, no `@cloudflare/containers` package), Zod, Vitest with `getPlatformProxy`.
**Spec:** `docs/plans/prds/phase-5.md` (owner PRD), `docs/plans/2026-10-24-phases-2-10-decisions.md` (register, binding), `docs/PLAN.md` sections 3 to 7.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`), the commit this plan was written on. The tree at that commit has no code. At execution time HEAD is the tip of the Phase 4 work. If an anchor does not match, run `git log --oneline 5f7ddc8..HEAD` to see what moved.
**Confidence:** 7/10. Derived with the rubric: start 10; -2 once because every anchor is in a file that does not exist yet (register X18); -1 for `parseBody(c, schema)` / `parseQuery(c, schema)` (the register gives no return types, `Promise<T>` and `T` are assumed). The `signCallback` signature and the runner contract (stdin, `bun run /app/entrypoint.ts`) were -1 each before; the owner confirmed them in round 2 (answer 13) and the Phase 4 plan lists the signatures as final, so those deductions are removed. Not deducted but real: the `JobRunner` class and the outbound handler were type-checked but never run in a container (Docker was not running at planning time), which is exactly what Task 1 settles. No independent reviewer was run (planners may not spawn agents).
**NOT building:**
- Retention runner and the daily retention step (Phase 6 appends it to `runCronTick`).
- Restore jobs, restore routes, download URLs, `restores` sweeping (Phase 7 extends the message type, the callback, and the sweeper).
- Alerts on failure, timeout, or staleness (Phase 8). This phase only leaves the rows in the right state and `targets.last_status` updated.
- Any UI (Phase 9).
- Automatic retry of a failed job (`attempt` only counts claims; PLAN.md's `failed -> queued` edge is not built).
- A dead-letter queue. After 100 retries a message is dropped, and the sweeper fails the row with `queue_timeout`.
- Storing the detected `pg_version` on the target after a successful test.
- Any connection path other than the tunnel (owner answer 1). There is no `connection_mode` column.
- Test connection for unsaved targets. It runs on saved targets only, and the queue message carries ids only, never a plaintext connection URL, token, or credential.
- Any remote command: no `wrangler deploy`, no `--remote`, no `db:migrate:remote`, no `wrangler secret put`, no creation of a real Queue, Container, bucket, or Access app.
- New dependencies: none. Everything used is on the approved list (answers 7 to 9 of round 2: `wrangler`, `drizzle-kit`, `typescript`, `@cloudflare/workers-types`, `@types/bun`, `@types/react`, `@types/react-dom`; RustFS as the local S3 stand-in) or comes from earlier phases (`zod`, `hono`, `drizzle-orm`). The native Durable Object Container API is used instead of the unlisted `@cloudflare/containers` package.
- Creating the R2 lifecycle rule that aborts incomplete multipart uploads after 1 day. It is documented by Phase 4 and 10 and never created by code.

## Closed by owner (round 2)

The owner answered the three ASK items of the first draft on 2026-10-24 (`docs/plans/2026-10-24-phases-2-10-decisions.md`, "Owner answers, round 2"):

- **Q-direct: closed (answer 1).** Direct mode is removed. Every target uses the tunnel. There is no `connection_mode`, and the tunnel columns are NOT NULL, so the payload always has a `tunnel` block and the local end-to-end run uses a tunnel target (the tunnel the owner provided for the Phase 4 spike).
- **Q-maxinst: closed (answers 14 and 21).** `max_instances` is 2 (config value in `wrangler.jsonc`). `max_concurrent_jobs` defaults to `max_instances` - 1, which is 1, and counts scheduled and manual backups only. Connection tests and restores do not count toward it, so one instance stays free for them.
- **Q-contract: closed (answer 13).** Job JSON on stdin, entrypoint `bun run /app/entrypoint.ts`, and `signCallback` exported from `container/hmac.ts`. Phase 4 adds `container/contract.ts` (exports `CONTRACT_ENTRYPOINT`, `SAMPLE_JOBS`, `SIGNATURE_VECTOR`, `jobShape`) and `container/test/contract.test.ts`. Phase 5 imports those four exports by name instead of duplicating them: `JobRunner` uses `CONTRACT_ENTRYPOINT` as `RUNNER_COMMAND` (Task 5), the consumer test checks `buildJobPayload` output with `jobShape` against `SAMPLE_JOBS` (Task 7), and the callback test verifies `SIGNATURE_VECTOR` with the Worker-side verifier (Task 8), so the two cannot drift.

Also applied from round 2: part size 32 MiB (answer 12, `PART_SIZE_BYTES`); Test connection works on a saved, disabled target (answer 24: the UI saves with `enabled = false`, then tests, then enables).

**Open items:** none that block execution.

**Assumption to report (not asked):** `MAX_CONCURRENT_JOBS_LIMIT` stays 10 as a sanity cap on the setting. A value of `max_instances` or more leaves no free instance for tests and restores, so raise `max_instances` in `wrangler.jsonc` first. The owner may prefer a cap of `max_instances` - 1.

**Additions not in the PRD (flagged, from the register):** `GET /api/settings` and `PUT /api/settings` (Phase 9 needs them); polling for Test connection (`202 { testId }` plus `GET .../test/:testId`) with a new `connection_tests` table; cron every minute instead of every 5 minutes (register X13).

## Decisions that differ from the PRD / docs/PLAN.md

Task 12 updates `docs/PLAN.md` to match.

1. **Cron runs every minute** (`* * * * *`), not every 5 minutes (register X13, owner answer 14).
2. **Test connection is asynchronous.** `POST /api/targets/:id/test` returns `202 { testId }`. `GET /api/targets/:id/test/:testId` returns `{ status, result?, error? }`. PLAN.md had a synchronous `200`.
3. **The row is created before the queue message, not by the consumer.** PLAN.md section 1 says the consumer creates the `backups` row. Here the cron and the API create the `queued` row first, because the slot's unique index is what makes the cron idempotent (register). The message carries ids only: `{ jobId, type, targetId }` (no `attempt`).
4. **The consumer marks the job `running` when it claims it** (PRD item 3), not when the container's `started` callback arrives (PLAN.md section 6). Reason: the backup concurrency limit must count backups that are starting. The `started` callback only refreshes the heartbeat. The claim also sets `heartbeat_at`, so the sweeper has a baseline.
5. **One running job per target covers tests too.** A target can have at most one `queued` or `running` backup (partial unique index) and at most one `queued` or `running` test (partial unique index). The claim statement also refuses to start a backup while a test is `running` for the same target, and the reverse. `POST .../test` returns 409 while a backup is `queued` or `running`.
6. **Cron catch-up.** After enqueuing a slot, `next_run_at` becomes `nextRun(cron, tz, slot)`. If that is not in the future (the Worker was down for days), it becomes `nextRun(cron, tz, now)`. Missed slots are skipped, not replayed. If the target already has an active backup, the cron leaves `next_run_at` unchanged and tries again next minute.
7. **Container input goes through stdin, not env vars.** The Durable Object starts the container with `entrypoint: ["sleep", "infinity"]`, then `exec`s the runner and writes the job JSON to its stdin. This matches the register's "JSON on stdin" for Phase 4 and keeps secrets out of the container's environment and argv. [uncertain: `exec` with `stdin: "pipe"` was only type-checked, not run; Task 1 runs it.]
8. **Callback transport.** Default: the container POSTs to `http://cellar-callback.internal/internal/jobs/callback`; the `JobRunner` intercepts that host (`interceptOutboundHttp`) and forwards the request to a `CallbackEntrypoint` that calls the Hono app. Fallback if Task 1 fails: set `CALLBACK_BASE_URL` to the public Worker URL and add an Access bypass for the exact path `/internal/jobs/callback`. HMAC, the 5 minute window, and `seq` checks apply in both cases.
9. **`wrangler.jsonc` uses `migrations` with `new_sqlite_classes` for the Durable Object class**, as the register says. Wrangler also offers a declarative `exports` block that is mutually exclusive with `migrations`; it is not used. `max_batch_size` is 1 and `max_retries` is 100 (the Queues maximum), because a message that hits the concurrency limit is retried every 30 seconds.
10. **R2 credentials** (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` secrets; `R2_ENDPOINT`, `R2_BUCKET` vars) go into the job payload only. They are never in queue messages or logs.

## Phase gate

Run before Task 0. If any check fails, STOP and report: an earlier phase moved, and this plan's anchors are wrong.

- [ ] Gate 1: Run: `bun run test && bun run typecheck` - Expected: both exit 0. Record the test count as `BASELINE_TESTS` (the Task 12 Expected is `BASELINE_TESTS + 85`).
- [ ] Gate 2: Run: `for f in src/worker/env.ts src/worker/app.ts src/worker/index.ts src/worker/middleware/access.ts src/worker/middleware/error.ts src/worker/lib/crypto.ts src/worker/lib/redact.ts src/worker/lib/uuidv7.ts src/worker/lib/validate.ts src/worker/lib/audit.ts src/worker/db/schema.ts src/worker/db/client.ts src/shared/cron.ts src/shared/tz.ts test/helpers/env.ts container/hmac.ts container/Dockerfile wrangler.jsonc .dev.vars.example; do test -f $f || echo MISSING $f; done` - Expected: no output
- [ ] Gate 3: Run: `grep -n "export class ApiError" src/worker/middleware/error.ts; grep -n "export function nextRun" src/shared/cron.ts; grep -n "export function getDb" src/worker/db/client.ts; grep -n "export function uuidv7" src/worker/lib/uuidv7.ts; grep -n "export async function writeAudit" src/worker/lib/audit.ts; grep -n "export async function parseBody\|export function parseQuery" src/worker/lib/validate.ts; grep -n "export async function createTestEnv" test/helpers/env.ts; grep -n "export async function signCallback" container/hmac.ts; grep -n "onError" src/worker/app.ts` - Expected: each grep prints one line. If a signature differs from the "Consumes" lines in the tasks (for example `parseBody` returns something other than `Promise<T>`, or `signCallback` has other parameters), adapt the call sites only and record a `> Deviation:`.
- [ ] Gate 4 (Phase 4 contract): Run: `test -f container/contract.ts && echo contract-ok; grep -cE "export (const|function) (CONTRACT_ENTRYPOINT|SAMPLE_JOBS|SIGNATURE_VECTOR|jobShape)\b" container/contract.ts; test -f container/test/contract.test.ts && echo contract-test-ok; grep -rn "sizeBytes\|sha256\|pgServerVersion\|hasReadAllData\|dbSizeBytes" container --include=*.ts | head -20` - Expected: `contract-ok`, `4`, `contract-test-ok`; `bun run test` in Gate 1 already ran the contract test green; the callback result field names match `callbackSchema` in Task 8 (add any missing optional field there, never rename). Phase 5 imports `CONTRACT_ENTRYPOINT` (Task 5), `SAMPLE_JOBS` and `jobShape` (Task 7), and `SIGNATURE_VECTOR` (Task 8) from `container/contract.ts`, and `signCallback` from `container/hmac.ts`. Never copy the contract into a Phase 5 file. If any of the four exports is missing, STOP and report: Phase 4 is not done.
- [ ] Gate 5: Run: `ls migrations | tail -3 && git status --short` - Expected: migrations from Phases 1 and 2 are present (Task 2 must not hard-code a number) and the tree is clean.

## Global Constraints

- TypeScript strict, `noUncheckedIndexedAccess` on. Hono routes use `Hono<AppEnv>`. Drizzle uses the schema from Phase 1 plus Task 2. Files are `kebab-case.ts`. Worker code in `src/worker/`, tests in `test/worker/` (X1).
- Cron is one `* * * * *` trigger. The cron handler runs, in order: enqueue due targets, stale sweeper. A failing step never blocks the next step.
- Queue message is `{ jobId, type: "backup" | "test", targetId }` and nothing else. `max_batch_size: 1`. The consumer is idempotent: a message whose row is not `queued` is acked and ignored.
- `schedule_slot` is the UTC ISO minute of the `next_run_at` being enqueued. The insert uses `ON CONFLICT DO NOTHING`; the message is sent only if a row was inserted.
- Connection URLs, tunnel service tokens, and R2 credentials: decrypt only inside the consumer, only into the container payload. Never in queue messages, logs, API responses, errors, or audit details. Log job ids and error class names only.
- R2 credentials are the bucket-scoped token in Worker secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, plus vars `R2_ENDPOINT` and `R2_BUCKET`. Document every secret in `.dev.vars.example`.
- `/internal/jobs/callback` is registered outside `/api/*`, so Access does not apply. HMAC-SHA256 over `timestamp + "." + jobId + "." + rawBody` with the per-job key, constant-time compare, timestamp within 5 minutes (300 seconds), `seq` greater than the last applied one, terminal states never change. The job key is derived from `jobId` and `ENCRYPTION_KEY`; nothing is stored.
- Sweeper rules (docs/PLAN.md section 6): `running` with no heartbeat for 5 minutes or past its deadline becomes `timed_out`; `queued` for more than 1 hour becomes `failed` with `error_code = queue_timeout`. Deadline is `started_at + job_deadline_minutes` (tests: 5 minutes). Applies to `backups` and `connection_tests`.
- Settings keys have code defaults and no seed rows: `max_concurrent_jobs` default 1 (`max_instances` - 1, counts backups only). `PUT /api/settings` validates a known-key allowlist with Zod and writes an audit row `settings.update`.
- Errors use the Phase 2 shape through `ApiError(status, code, message, details?)`. Lists use `?limit` (default 50, max 200) and `?cursor` and return `{ items, nextCursor }` (X7). IDs are UUIDv7 (X8).
- Additive migration only: `bun run db:generate -- --name <what>`; never edit an applied migration; never hard-code a migration number (X3).
- Stop and ask before: `wrangler deploy` or any remote command, creating a real Cloudflare resource, adding an unlisted dependency, changing a locked decision, any data-deleting operation. If the same step fails 3 times, stop and report.
- No em dash in any file you write. Use a plain dash. Do not add the agent as co-author in commit messages.

## Patterns to Mirror

No code exists at the base commit. These patterns come from the Phase 1 plan (`docs/plans/2026-10-24-phase-1-foundation.md`, planned, not yet in tree) and the register. SOURCE lines name the plan section.

### Naming
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md "Patterns to Mirror" > Naming -->
Files are `kebab-case.ts`. Drizzle tables are plural `snake_case` SQL names with `camelCase` TS properties (`dbName: text("db_name")`). Indexes are `idx_<table>_<what>`, unique indexes `uq_<table>_<what>`.

### Error handling
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md Task 5 Step 1 (access.ts) -->
```ts
function unauthorized(reason: string): Response {
  console.warn(`access: rejected (${reason})`);
  return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
}
```
Phase 5 follows the same rule: log a short reason, never a token or a secret, and return the generic body. Phase 2's `ApiError` produces the same body shape for routes.

### Tests
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md "Patterns to Mirror" > Tests; register X4 -->
Vitest, files at `test/worker/<mirrors src/worker path>.test.ts`, Node environment. Hono apps are tested with `app.request(url, init, env)` against `http://localhost/...`. D1, R2, and Queue come from `createTestEnv(overrides?)` in `test/helpers/env.ts` (Phase 2, `getPlatformProxy` with `persist: false`). Phase 5 passes `{ JOBS: fakeQueue().queue }` as the override to capture queue messages.

## Preflight

### DURABLE - true until the repo itself changes

- **`getPlatformProxy` still works after the container, Durable Object, queue consumer, cron, and vars blocks are added to `wrangler.jsonc`.** Evidence: in the scratch project `/tmp/phase-5-scratch`, `getPlatformProxy({ persist: false })` with exactly the Task 5 config returned `DB`, `BACKUPS`, `JOBS`, `JOB_RUNNER`, and the vars, and `JOBS.send` worked. It prints two harmless warnings per call ("internal Durable Objects ... will not work in local development" and "no such Durable Object class is exported"). Consequence: Phase 2's `createTestEnv` keeps working; tests never call `JOB_RUNNER` (they inject fakes), so the warnings are expected noise. The warnings appear once per `createTestEnv` call, so test output is long; filter with `bun run test 2>&1 | grep -v "Durable Object"` when reading it.
- **The `JobRunner` / `CallbackEntrypoint` code in Task 5 type-checks** with `@cloudflare/workers-types` 5.20261024.1 and TypeScript 7.0.2, including `this.ctx.exports.CallbackEntrypoint({})`, `container.setInactivityTimeout`, `container.interceptOutboundHttp`, and `container.exec(..., { stdin: "pipe" })`. It needs `src/worker/globals.d.ts` (Task 5) so that `ctx.exports` knows the exports of the main module. Evidence: scratch `tsc --noEmit` exit 0.
- **The SQL behaves as the plan says in local D1.** Evidence (scratch, 83 Vitest tests through `getPlatformProxy` D1): `ON CONFLICT DO NOTHING` on the two partial unique indexes (`(target_id, schedule_slot)` and `(target_id) WHERE status IN ('queued','running')`) makes the cron insert idempotent and blocks a second active backup; the single-statement claim enforces the global and per-target limits even when four consumers run with `Promise.all`.
- **Register facts used here:** X2 (Phase 1 interfaces), X4 (`createTestEnv`), X5 to X11 (validate helper, `ApiError`, pagination, UUIDv7, `nextRun`, `writeAudit`, `getDb`), X13 (cron cadence), X14 (`container/hmac.ts`). They are planned, not yet in tree.
- **Dependency versions in the scratch run (informational; `bun.lock` is the source in the repo):** wrangler 4.152.0, vitest 5.0.5, zod 4.6.7, drizzle-orm 0.45.4, drizzle-kit 0.31.11, hono 4.13.13. No dependency is added by this plan.

### PERISHABLE - recapture before Task 0

- **Docker is running.** Check: `docker info >/dev/null 2>&1 && echo up || echo down` - Expected: `up`. At planning time it printed `down`. Needed by: Task 1 and the Manual items in End-to-end verification (`wrangler dev` builds the container image locally). If down: start Docker Desktop. If it cannot be started, STOP and ask; do not skip the spike.
- **Phase 4 local test stack can start.** Check: `docker compose -f test/docker-compose.test.yml config -q && echo ok` - Expected: `ok`. Needed by: End-to-end verification. Read the file for the Postgres host ports, the RustFS endpoint and credentials, and the bucket name; the Manual steps below call them `PG_PORT`, `RUSTFS_PORT`, `RUSTFS_USER`, `RUSTFS_PASSWORD`, `RUSTFS_BUCKET`.
- **Free ports.** Check: `lsof -i :8795` and `lsof -i :8796` - Expected: no output. Port 8795 serves `wrangler dev`. Port 8796 is for the spike. If used, pick other ports and use them in every command.
- **Dependencies installed in this checkout.** Check: `test -d node_modules && bun run typecheck` - Expected: exit 0.
- **No leftover `.dev.vars` and no leftover local state.** Check: `ls .dev.vars 2>&1; ls .wrangler 2>&1` - Expected: `.dev.vars` does not exist. The end-to-end section creates it and removes it.
- **Baseline red count.** Check: `bun run test 2>&1 | tail -6; bun run typecheck 2>&1 | tail -3` (Gate 1) - Expected: 0 failures, 0 type errors. If the tree is already red, name the failures here and treat them as pre-existing; do not widen the list.
- **Secrets.** None needed. Tests use fixed fake keys. The end-to-end `.dev.vars` uses fake values and the RustFS credentials from the Phase 4 compose file (test and dev only; never a real Cloudflare token). Check: `test -z "$CLOUDFLARE_API_TOKEN" || echo "unset it for this run"` - Expected: no output.

## Execution

**Tracks:** one track, sequential. The tasks share `app.ts`, `schema.ts`, `env.ts`, and `wrangler.jsonc`, and the whole phase is far below the cost floor for parallel tracks.
**Merge order:** not applicable (single track).
**Shared files:** `src/worker/app.ts` is edited by Tasks 4, 8, and 10 (one route line each, in that order). `src/worker/index.ts` is edited by Tasks 5 and 11. `src/worker/db/schema.ts` and `migrations/` are edited by Task 2 only. `src/worker/env.ts`, `wrangler.jsonc`, `.dev.vars.example`, and `test/helpers/env.ts` are edited by Task 5 only. `docs/PLAN.md` is edited by Task 12 only. `package.json` and `bun.lock` are not touched.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch off the Phase 4 branch: `git switch -c phase-5-orchestration`.
**treehouse:** not needed for a single track.

---
### Task 0: Branch

**Files:**
- none

**Interfaces:**
- Consumes: the Phase 4 branch tip (the Phase gate passed on it).
- Produces: branch `phase-5-orchestration`.

**Steps:**
- [ ] Step 1: Create the branch: `git switch -c phase-5-orchestration`
- [ ] Step 2: Verify - Run: `git status --short && git branch --show-current` - Expected: no file listed, then `phase-5-orchestration`

---

### Task 1: Spike - container to Worker callback through the outbound handler (scratch project, no repo change)

**Files:**
- Create outside the repo: `/tmp/phase-5-spike/package.json`, `wrangler.jsonc`, `tsconfig.json`, `src/index.ts`, `src/globals.d.ts`, `container/Dockerfile`, `container/runner.ts`
- The repo tree stays untouched. The result is one `> Spike result:` line recorded in this plan file (do not commit it).

**Interfaces:**
- Consumes: Docker running (Preflight). Nothing from the repo.
- Produces: the decision that fixes `CALLBACK_BASE_URL` for the rest of the phase: `OUTBOUND_OK` (leave `CALLBACK_BASE_URL` empty) or `FALLBACK` (use the public URL plus an Access bypass for `/internal/jobs/callback`). It also proves, or disproves, that `container.exec(..., { stdin: "pipe" })` delivers the job JSON.

**Gotcha:**
- The first `wrangler dev` run builds the image, which can take a few minutes.
- The spike uses a different port (8796) from the end-to-end run (8795) so a leftover process cannot be mistaken for the real one.
- Local `max_instances` is not enforced [register research note], so the spike does not test concurrency.
- Nothing here talks to Cloudflare. Do not run `wrangler login`, `deploy`, or `--remote`. If wrangler asks to log in or to create something, STOP.

**Rollback:** `rm -rf /tmp/phase-5-spike` and `docker ps -a` / `docker rm -f` for any container the run left behind.

**Steps:**
- [ ] Step 1: Create the scratch project: `mkdir -p /tmp/phase-5-spike/src /tmp/phase-5-spike/container && cd /tmp/phase-5-spike && printf '{"name":"cellar-spike","private":true,"type":"module"}' > package.json && bun add -d wrangler @cloudflare/workers-types typescript`
- [ ] Step 2: Create `/tmp/phase-5-spike/wrangler.jsonc`:
  ```jsonc
  {
    "name": "cellar-spike",
    "main": "src/index.ts",
    "compatibility_date": "2026-10-01",
    "containers": [{ "class_name": "JobRunner", "image": "./container/Dockerfile", "image_build_context": "./container", "instance_type": "basic", "max_instances": 2 }],
    "durable_objects": { "bindings": [{ "name": "JOB_RUNNER", "class_name": "JobRunner" }] },
    "migrations": [{ "tag": "v1", "new_sqlite_classes": ["JobRunner"] }]
  }
  ```
- [ ] Step 3: Create `/tmp/phase-5-spike/tsconfig.json`:
  ```json
  { "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "lib": ["ES2022"], "types": ["@cloudflare/workers-types"], "strict": true, "noEmit": true, "skipLibCheck": true }, "include": ["src"] }
  ```
- [ ] Step 4: Create `/tmp/phase-5-spike/src/globals.d.ts`:
  ```ts
  declare namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }

  ```
- [ ] Step 5: Create `/tmp/phase-5-spike/src/index.ts`. The `JobRunner` and `CallbackEntrypoint` classes are the exact classes Task 5 puts in the repo, with the Hono app replaced by a logger:
  ```ts
  import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
  interface Env {
    JOB_RUNNER: DurableObjectNamespace<JobRunner>;
  }

  const CALLBACK_HOST = "cellar-callback.internal";

  const RUNNER_COMMAND = ["bun", "run", "/app/entrypoint.ts"];
  const GRACE_MS = 10 * 60 * 1000;

  /** Outbound handler: forwards requests the container sends to CALLBACK_HOST into the Hono app. */
  export class CallbackEntrypoint extends WorkerEntrypoint<Env> {
    override fetch(request: Request): Promise<Response> {
      return request.text().then((body) => {
        console.log("SPIKE-CALLBACK", request.method, new URL(request.url).pathname, body);
        return new Response("ok");
      });
    }
  }

  export interface RunRequest {
    /** Job payload JSON, written to the runner's stdin. Contains secrets: never log it. */
    payloadJson: string;
    /** Epoch ms after which the container must be gone. */
    deadlineMs: number;
  }

  /** One Durable Object per job id; each owns one container that runs one job. */
  export class JobRunner extends DurableObject<Env> {
    async run(request: RunRequest): Promise<void> {
      const container = this.ctx.container;
      if (!container) throw new Error("No container is configured for JobRunner");
      if (container.running) throw new Error("Job already started");

      container.start({ enableInternet: true, entrypoint: ["sleep", "infinity"] });
      await container.setInactivityTimeout(Math.max(request.deadlineMs - Date.now(), 0) + GRACE_MS);
      await this.ctx.storage.setAlarm(request.deadlineMs + GRACE_MS);
      await container.interceptOutboundHttp(CALLBACK_HOST, this.ctx.exports.CallbackEntrypoint({}));

      const proc = await container.exec(RUNNER_COMMAND, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      const writer = proc.stdin?.getWriter();
      if (!writer) throw new Error("Runner stdin is not available");
      await writer.write(new TextEncoder().encode(request.payloadJson));
      await writer.close();
      this.ctx.waitUntil(proc.exitCode.then(() => this.stop()));
    }

    async stop(): Promise<void> {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.container?.destroy("job finished");
    }

    override async alarm(): Promise<void> {
      await this.ctx.container?.destroy("deadline passed");
    }
  }

  export default {
    async fetch(request, env) {
      if (new URL(request.url).pathname !== "/start") return new Response("not found", { status: 404 });
      const payloadJson = JSON.stringify({ jobId: "spike-1", note: "payload via stdin" });
      await env.JOB_RUNNER.getByName("spike-1").run({ payloadJson, deadlineMs: Date.now() + 120_000 });
      return new Response("started");
    },
  } satisfies ExportedHandler<Env>;

  ```
- [ ] Step 6: Create `/tmp/phase-5-spike/container/runner.ts`:
  ```ts
  const input = await Bun.stdin.text();
  const response = await fetch("http://cellar-callback.internal/internal/jobs/callback", { method: "POST", body: input });
  console.log("callback status", response.status);

  ```
- [ ] Step 7: Create `/tmp/phase-5-spike/container/Dockerfile`:
  ```dockerfile
  FROM oven/bun:1.3.9-slim
  COPY runner.ts /app/entrypoint.ts

  ```
- [ ] Step 8: Verify - Run: `cd /tmp/phase-5-spike && bunx tsc --noEmit -p . && echo typecheck-ok` - Expected: `typecheck-ok`. If `container.exec`, `interceptOutboundHttp`, or `setInactivityTimeout` are rejected by the installed types, the Durable Object Container API changed: STOP and report before Task 5.
- [ ] Step 9: Start the dev server in the background and log to a file: `cd /tmp/phase-5-spike && bunx wrangler dev --local --port 8796 > dev.log 2>&1 &` - Expected: within about 5 minutes `dev.log` contains `Ready on http://localhost:8796`. If the log asks for a login, a remote resource, or fails to find Docker, STOP.
- [ ] Step 10: Verify - Manual: `curl -s localhost:8796/start; sleep 20; grep -c "SPIKE-CALLBACK POST /internal/jobs/callback" /tmp/phase-5-spike/dev.log; grep "SPIKE-CALLBACK" /tmp/phase-5-spike/dev.log | head -2` (the sleep only gives the container time to boot; wait up to 3 minutes on the first run by repeating the grep) - Expected: `started`, then a count of at least `1`, then a log line whose body is `{"jobId":"spike-1","note":"payload via stdin"}`. That one line proves the stdin delivery and the outbound handler together.
- [ ] Step 11: Record the result. If Step 10 passed, add `> Spike result: OUTBOUND_OK (date, wrangler version)` under this task in the plan file. If the callback never arrived but the container ran (`docker ps` shows it, or the log shows `callback status`), wait 2 more minutes and re-run Step 10 once; if it still fails, record `> Spike result: FALLBACK (outbound intercept did not deliver)` and use the fallback from "Decisions" item 8 for the rest of the phase. If `exec` or stdin fails, record `> Spike result: STDIN_FAILED` and STOP: Phase 4 must accept the job another way, and the owner decides.
- [ ] Step 12: Stop the dev server (`pkill -f "wrangler dev --local --port 8796"`) and clean up (`docker ps -a`, then `docker rm -f` any container started during the spike). Verify - Run: `lsof -i :8796` - Expected: no output

> Spike result: INCONCLUSIVE (2026-10-24, wrangler 4.152.0). Image build, DO start, and `container.start()` worked, but `wrangler dev` under podman failed to start its egress sidecar (cloudflare/proxy-everything) with `crun: cannot set memory swappiness with cgroupv2`, so the container never ran and neither OUTBOUND_OK nor FALLBACK was observed. The code keeps the default: empty `CALLBACK_BASE_URL`, outbound intercept path; the fallback config (Decisions item 8) stays documented. Confirm the outbound intercept with Docker Desktop or on a deployed Worker.

---
### Task 2: Schema additions and migration (local D1 only)

**Files:**
- Modify: `src/worker/db/schema.ts` (anchors: `deletedReason: text("deleted_reason")` in `backups`; `uq_backups_target_slot`; insert the new table after the `backups` table, before `restores`)
- Create (emitted by `drizzle-kit generate`): `migrations/NNNN_jobs-orchestration.sql`, `migrations/meta/NNNN_snapshot.json`; modified: `migrations/meta/_journal.json`

**Interfaces:**
- Consumes: Phase 1 `backups` and `targets` tables.
- Produces: `backups.lastSeq` (integer NOT NULL DEFAULT 0, highest callback `seq` applied); partial unique index `uq_backups_active_target` (one `queued` or `running` backup per target); table `connectionTests` (`id, targetId, status, resultJson, errorCode, errorMessage, lastSeq, queuedAt, startedAt, finishedAt, heartbeatAt`) with partial unique index `uq_connection_tests_active_target` and indexes `idx_connection_tests_status (status, heartbeat_at)` and `idx_connection_tests_queued (queued_at)`.

**Gotcha:**
- Blast radius of the inferred type: `typeof backups.$inferSelect` gains `lastSeq: number`. The insert type gains an optional `lastSeq` (it has a default), so existing inserts compile. Hand-built objects typed as the SELECT type need `lastSeq: 0`. Find them first: `grep -rn "inferSelect" src test` and `grep -rn "typeof backups" src test`. Phase 6 maps rows into its own `RetentionBackup` type, so it is not affected. List any file you change in the commit message.
- `drizzle-kit` emits `ALTER TABLE ... ADD last_seq integer DEFAULT 0 NOT NULL`, which SQLite accepts because of the default.
- The unique index on `backups(target_id)` fails to create if a target already has two `queued` or `running` backups. Fresh local D1 has none. Remote D1 has none either, because no code created backup rows before this phase.
- Do not run `db:migrate:remote`. The owner applies the migration at deploy time.
- Run `ls migrations` first and never assume the number.

**Rollback:** local D1 only. `rm -rf .wrangler/state/v3/d1` then `bun run db:migrate:local` re-applies everything. To discard the files: `git revert <commit>`. Nothing remote is touched.

**Steps:**
- [ ] Step 1: Run `ls migrations` and `grep -rn "inferSelect" src test` and note the results (migration count before; consumers of the select type).
- [ ] Step 2: In `src/worker/db/schema.ts`, add `lastSeq` to the end of the `backups` columns. Replace:
  ```ts
      deletedReason: text("deleted_reason"),
    },
  ```
      with:
  ```ts
      deletedReason: text("deleted_reason"),
      lastSeq: integer("last_seq").notNull().default(0),
    },
  ```
- [ ] Step 3: In the `backups` index list, add the active-backup index. Replace the `uq_backups_target_slot` entry and the closing of the list:
  ```ts
      uniqueIndex("uq_backups_target_slot")
        .on(t.targetId, t.scheduleSlot)
        .where(sql`${t.scheduleSlot} IS NOT NULL`),
    ],
  );
  ```
      with:
  ```ts
      uniqueIndex("uq_backups_target_slot")
        .on(t.targetId, t.scheduleSlot)
        .where(sql`${t.scheduleSlot} IS NOT NULL`),
      uniqueIndex("uq_backups_active_target")
        .on(t.targetId)
        .where(sql`${t.status} IN ('queued', 'running')`),
    ],
  );
  ```
- [ ] Step 4: Add the `connectionTests` table directly after the `backups` table (before `restores`):
  ```ts
  export const connectionTests = sqliteTable(
    "connection_tests",
    {
      id: text("id").primaryKey(),
      targetId: text("target_id")
        .notNull()
        .references(() => targets.id),
      status: text("status", { enum: ["queued", "running", "success", "failed", "timed_out"] }).notNull(),
      resultJson: text("result_json"),
      errorCode: text("error_code"),
      errorMessage: text("error_message"),
      lastSeq: integer("last_seq").notNull().default(0),
      queuedAt: text("queued_at").notNull(),
      startedAt: text("started_at"),
      finishedAt: text("finished_at"),
      heartbeatAt: text("heartbeat_at"),
    },
    (t) => [
      uniqueIndex("uq_connection_tests_active_target")
        .on(t.targetId)
        .where(sql`${t.status} IN ('queued', 'running')`),
      index("idx_connection_tests_status").on(t.status, t.heartbeatAt),
      index("idx_connection_tests_queued").on(t.queuedAt),
    ],
  );
  ```
- [ ] Step 5: Generate the migration: `bun run db:generate -- --name jobs-orchestration` - Expected: prints a summary and `migrations/NNNN_jobs-orchestration.sql` (NNNN is the next free number)
- [ ] Step 6: Verify - Run: `f=$(ls migrations/*_jobs-orchestration.sql); grep -c "CREATE TABLE" $f; grep -c "CREATE UNIQUE INDEX" $f; grep -c "ADD .last_seq. integer DEFAULT 0 NOT NULL" $f` - Expected: `1`, `2`, `1` (one new table; two partial unique indexes; one added column). Run in scratch: the generated SQL for this schema was exactly these statements.
- [ ] Step 7: Apply to LOCAL D1 only: `bun run db:migrate:local` - Expected: output mentions `Executing on local database cellar` and the new file with a check mark; it must NOT mention `remote`
- [ ] Step 8: Verify - Run: `bunx wrangler d1 execute cellar --local --json --command "SELECT name FROM sqlite_master WHERE name IN ('connection_tests','uq_backups_active_target','uq_connection_tests_active_target','idx_connection_tests_status','idx_connection_tests_queued')" | grep -c '"name"'` - Expected: `5`
- [ ] Step 9: Verify - Run: `bun run typecheck && bun run test` - Expected: exit 0, test count = `BASELINE_TESTS`
- [ ] Step 10: Commit - `git add src/worker/db/schema.ts migrations && git commit -m "feat: add connection_tests table, backups.last_seq, and one-active-backup-per-target index"`

---
### Task 3: Shared job constants and small helpers

**Files:**
- Create: `src/worker/jobs/types.ts`, `src/worker/lib/job-key.ts`, `src/worker/lib/r2-key.ts`, `src/worker/lib/cursor.ts`
- Test: `test/worker/lib/job-helpers.test.ts`

**Interfaces:**
- Consumes: `getDb(env: Env)` from `src/worker/db/client.ts` (type only, for `Db`); `zod`.
- Produces (all used by later tasks):
  - `type Db = ReturnType<typeof getDb>`; `jobMessageSchema` (strict Zod object `{ jobId, type: "backup" | "test", targetId }`); `type JobMessage`; `type JobType = "backup" | "test"`.
  - Constants: `CALLBACK_HOST = "cellar-callback.internal"`, `CALLBACK_PATH = "/internal/jobs/callback"`, `TUNNEL_LOCAL_PORT = 15432`, `PART_SIZE_BYTES = 33_554_432`, `TEST_DEADLINE_MINUTES = 5`, `HEARTBEAT_TIMEOUT_MS`, `QUEUE_TIMEOUT_MS`, `CONNECTION_TEST_RETENTION_MS`, `CALLBACK_WINDOW_SECONDS = 300`, `MAX_CALLBACK_BODY_BYTES = 65536`, `QUEUE_RETRY_DELAY_SECONDS = 30`, `DUE_BATCH_LIMIT = 50`.
  - `deriveJobKey(encryptionKeyBase64: string, jobId: string): Promise<string>` - base64 of 32 bytes, `HMAC(HMAC(ENCRYPTION_KEY, "cellar-job-signing-v1"), jobId)`.
  - `buildBackupKey(targetId: string, dbName: string, at: Date): string` - `backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump`, date parts in UTC.
  - `encodeCursor(parts: string[]): string`, `decodeCursor(cursor: string): string[] | null`.

**Gotcha:**
- `deriveJobKey` uses a two-step HMAC so the callback signing key is separate from the AES use of `ENCRYPTION_KEY`. Do not log the key or the derived key.
- `dbName` is already sanitized to `[A-Za-z0-9_-]` by Phase 2, so the R2 key needs no further escaping.
- If Phase 2 already added a cursor helper (`grep -rn "nextCursor\|encodeCursor" src/worker`), delete `cursor.ts` and its test and import Phase 2's instead (one source of truth), keeping the call shape used in Task 10.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/types.ts`:
  ```ts
  import { z } from "zod";
  import type { getDb } from "../db/client";

  export type Db = ReturnType<typeof getDb>;

  export const jobMessageSchema = z
    .object({
      jobId: z.string().min(1),
      type: z.enum(["backup", "test"]),
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
  ```
- [ ] Step 2: Create `src/worker/lib/job-key.ts` (run in scratch against a Node `createHmac` reference):
  ```ts
  function toBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(value: string): Uint8Array {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  }

  async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  }

  /**
   * Per-job callback key: HMAC(HMAC(ENCRYPTION_KEY, "cellar-job-signing-v1"), jobId), base64 of 32 bytes.
   * The intermediate step keeps the signing key separate from the AES key use of ENCRYPTION_KEY.
   * Nothing is stored: the Worker recomputes it from the job id when a callback arrives.
   */
  export async function deriveJobKey(encryptionKeyBase64: string, jobId: string): Promise<string> {
    const signingKey = await hmacSha256(fromBase64(encryptionKeyBase64), "cellar-job-signing-v1");
    return toBase64(await hmacSha256(signingKey, jobId));
  }
  ```
- [ ] Step 3: Create `src/worker/lib/r2-key.ts`:
  ```ts
  /** backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump - date parts are UTC. */
  export function buildBackupKey(targetId: string, dbName: string, at: Date): string {
    const iso = at.toISOString();
    const [year, month, day] = [iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)];
    return `backups/${targetId}/${year}/${month}/${day}/${iso}_${dbName}.dump`;
  }
  ```
- [ ] Step 4: Create `src/worker/lib/cursor.ts`:
  ```ts
  /** Opaque pagination cursor: base64url of a JSON array of strings (the last row's sort key parts). */
  export function encodeCursor(parts: string[]): string {
    return btoa(JSON.stringify(parts)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  export function decodeCursor(cursor: string): string[] | null {
    try {
      const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(cursor.length / 4) * 4, "=");
      const parsed: unknown = JSON.parse(atob(padded));
      return Array.isArray(parsed) && parsed.every((part) => typeof part === "string") ? parsed : null;
    } catch {
      return null;
    }
  }
  ```
- [ ] Step 5: Create `test/worker/lib/job-helpers.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { decodeCursor, encodeCursor } from "../../../src/worker/lib/cursor";
  import { deriveJobKey } from "../../../src/worker/lib/job-key";
  import { buildBackupKey } from "../../../src/worker/lib/r2-key";

  const master = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));

  describe("deriveJobKey", () => {
    it("is deterministic per job, differs between jobs and keys, and is 32 bytes of base64", async () => {
      const a = await deriveJobKey(master, "job-1");
      expect(await deriveJobKey(master, "job-1")).toBe(a);
      expect(await deriveJobKey(master, "job-2")).not.toBe(a);
      expect(await deriveJobKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(2))), "job-1")).not.toBe(a);
      expect(atob(a)).toHaveLength(32);
    });
  });

  describe("buildBackupKey", () => {
    it("follows backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump in UTC", () => {
      expect(buildBackupKey("t1", "shop", new Date("2026-10-24T02:00:00.123Z"))).toBe("backups/t1/2026/10/24/2026-10-24T02:00:00.123Z_shop.dump");
      expect(buildBackupKey("t1", "shop", new Date("2026-12-31T23:59:59.000Z"))).toBe("backups/t1/2026/12/31/2026-12-31T23:59:59.000Z_shop.dump");
    });
  });

  describe("cursor", () => {
    it("roundtrips and rejects garbage", () => {
      const cursor = encodeCursor(["2026-10-24T02:00:00.000Z", "id/with+chars"]);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeCursor(cursor)).toEqual(["2026-10-24T02:00:00.000Z", "id/with+chars"]);
      expect(decodeCursor("!!!")).toBeNull();
      expect(decodeCursor(btoa('{"a":1}'))).toBeNull();
    });
  });
  ```
- [ ] Step 6: Verify - Run: `bunx vitest run test/worker/lib/job-helpers.test.ts && bun run typecheck` - Expected: 3 pass, 0 fail; typecheck exit 0
- [ ] Step 7: Commit - `git add src/worker/jobs/types.ts src/worker/lib/job-key.ts src/worker/lib/r2-key.ts src/worker/lib/cursor.ts test/worker/lib/job-helpers.test.ts && git commit -m "feat: add job constants, job key derivation, R2 key builder, and cursor helpers"`

---
### Task 4: Settings store and routes

**Files:**
- Create: `src/worker/lib/settings.ts`, `src/worker/routes/settings.ts`
- Modify: `src/worker/app.ts` (anchor: the last `app.route(` line Phase 2 added; if none, directly after `app.use("/api/*", access())`)
- Test: `test/worker/routes/settings.test.ts`

**Interfaces:**
- Consumes: `Db` (Task 3); `settings` table; `writeAudit(db, entry)` (X10); `parseBody(c, schema)` (X5, assumed `Promise<T>`); `AppEnv` from `src/worker/middleware/access.ts`.
- Produces:
  - `getSettings(db: Db): Promise<Settings>` where `Settings = { max_concurrent_jobs: number }`. A stored value is used only if it passes its validator; otherwise the code default applies.
  - `updateSettings(db: Db, patch: SettingsInput, now: Date): Promise<Settings>`.
  - `settingsInputSchema` (Zod, strict, partial, at least one key), `settingValidators`, `SETTING_DEFAULTS`, `MAX_CONCURRENT_JOBS_LIMIT = 10`. **Phase 6 adds `retention_dry_run` by adding one entry to `settingValidators`, one default, and one line in `getSettings`.**
  - Routes `GET /api/settings`, `PUT /api/settings` (`settingsRoutes`, a `Hono<AppEnv>`).

**Gotcha:**
- `PUT` takes a partial object and returns the full settings object. Unknown keys, wrong types, out-of-range numbers, and `{}` are all 400 and write nothing, including no audit row.
- No seed rows. `GET` on an empty table returns the defaults.
- `settingsInputSchema` is `.strict()` on purpose: an unknown key must be rejected, not ignored.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/settings.ts`:
  ```ts
  import { z } from "zod";
  import { settings } from "../db/schema";
  import type { Db } from "../jobs/types";

  export const MAX_CONCURRENT_JOBS_LIMIT = 10;

  /** Known settings keys and their validators. Later phases add keys here. */
  export const settingValidators = {
    max_concurrent_jobs: z.number().int().min(1).max(MAX_CONCURRENT_JOBS_LIMIT),
  } as const;

  export const SETTING_DEFAULTS = { max_concurrent_jobs: 1 } as const;

  export type Settings = { max_concurrent_jobs: number };

  export const settingsInputSchema = z
    .object(settingValidators)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, { message: "At least one setting is required" });
  export type SettingsInput = z.infer<typeof settingsInputSchema>;

  /** Stored value if present and valid, otherwise the code default. */
  export async function getSettings(db: Db): Promise<Settings> {
    const rows = await db.select().from(settings);
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const maxConcurrent = parseStored(stored.get("max_concurrent_jobs"), settingValidators.max_concurrent_jobs);
    return { max_concurrent_jobs: maxConcurrent ?? SETTING_DEFAULTS.max_concurrent_jobs };
  }

  function parseStored<T>(raw: string | undefined, validator: z.ZodType<T>): T | undefined {
    if (raw === undefined) return undefined;
    try {
      const parsed = validator.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  export async function updateSettings(db: Db, patch: SettingsInput, now: Date): Promise<Settings> {
    for (const [key, value] of Object.entries(patch)) {
      const row = { key, value: JSON.stringify(value), updatedAt: now.toISOString() };
      await db.insert(settings).values(row).onConflictDoUpdate({ target: settings.key, set: { value: row.value, updatedAt: row.updatedAt } });
    }
    return getSettings(db);
  }
  ```
- [ ] Step 2: Create `src/worker/routes/settings.ts`:
  ```ts
  import { Hono } from "hono";
  import { getDb } from "../db/client";
  import { writeAudit } from "../lib/audit";
  import { getSettings, settingsInputSchema, updateSettings } from "../lib/settings";
  import { parseBody } from "../lib/validate";
  import type { AppEnv } from "../middleware/access";

  export const settingsRoutes = new Hono<AppEnv>();

  settingsRoutes.get("/", async (c) => c.json(await getSettings(getDb(c.env))));

  settingsRoutes.put("/", async (c) => {
    const db = getDb(c.env);
    const patch = await parseBody(c, settingsInputSchema);
    const updated = await updateSettings(db, patch, new Date());
    await writeAudit(db, { actor: c.get("actorEmail"), action: "settings.update", entityType: "settings", details: patch });
    return c.json(updated);
  });
  ```
- [ ] Step 3: Edit `src/worker/app.ts`: add the import at the top and the route line below the existing `app.route(...)` lines (or below `app.use("/api/*", access())` if there are none):
  ```ts
  import { settingsRoutes } from "./routes/settings";
  // ... below the existing app.route(...) lines:
  app.route("/api/settings", settingsRoutes);
  ```
- [ ] Step 4: Create `test/worker/routes/settings.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { auditLogs } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import { app } from "../../../src/worker/app";
  import { createTestEnv } from "../../helpers/env";

  let env: Env;
  let dispose: () => Promise<void>;
  beforeEach(async () => {
    const created = await createTestEnv();
    env = created.env;
    dispose = created.dispose;
  });
  afterEach(async () => {
    await dispose();
  });

  const put = (body: unknown) =>
    app.request("http://localhost/api/settings", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, env);
  const get = () => app.request("http://localhost/api/settings", {}, env);

  describe("settings routes", () => {
    it("returns code defaults when nothing is stored", async () => {
      expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 1 });
    });

    it("stores a valid value, returns it from GET, and writes an audit row", async () => {
      const response = await put({ max_concurrent_jobs: 4 });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ max_concurrent_jobs: 4 });
      expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 4 });
      const audit = await getDb(env).select().from(auditLogs);
      expect(audit[0]).toMatchObject({ action: "settings.update", actor: "dev@localhost", entityType: "settings", details: '{"max_concurrent_jobs":4}' });
    });

    it.each([[{ max_concurrent_jobs: 0 }], [{ max_concurrent_jobs: 11 }], [{ max_concurrent_jobs: 1.5 }], [{ max_concurrent_jobs: "3" }], [{ unknown_key: 1 }], [{}]])(
      "rejects %j with 400 and stores nothing",
      async (body) => {
        expect((await put(body)).status).toBe(400);
        expect(await (await get()).json()).toEqual({ max_concurrent_jobs: 1 });
        expect(await getDb(env).select().from(auditLogs)).toHaveLength(0);
      },
    );

    it("is protected by Access", async () => {
      const prod = { ...env, DEV_BYPASS: "" } as Env;
      expect((await app.request("http://localhost/api/settings", {}, prod)).status).toBe(401);
    });
  });
  ```
- [ ] Step 5: Verify - Run: `bunx vitest run test/worker/routes/settings.test.ts && bun run typecheck` - Expected: 9 pass, 0 fail; typecheck exit 0
- [ ] Step 6: Commit - `git add src/worker/lib/settings.ts src/worker/routes/settings.ts src/worker/app.ts test/worker/routes/settings.test.ts && git commit -m "feat: add settings store with max_concurrent_jobs and settings routes"`

---
### Task 5: Container binding, `JobRunner`, environment, and configuration

**Files:**
- Create: `src/worker/container/job-runner.ts`, `src/worker/globals.d.ts`
- Modify: `src/worker/env.ts` (anchor: `export interface Env`), `src/worker/index.ts` (anchor: `export default`), `wrangler.jsonc` (anchors: `"queues"`, end of the object), `.dev.vars.example` (append), `test/helpers/env.ts` (anchor: `DEV_BYPASS: "true"`)
- This task has six files on purpose: the `Env` type, the Durable Object class, and the config only build together, and each commit must build.

**Interfaces:**
- Consumes: `app` from `src/worker/app.ts`; `CALLBACK_HOST` and `JobMessage` from Task 3; `Env`; `CONTRACT_ENTRYPOINT: readonly ["bun", "run", "/app/entrypoint.ts"]` from `container/contract.ts` (Phase 4, Gate 4).
- Produces:
  - `Env` gains `JOBS: Queue<JobMessage>` (was `Queue`), `JOB_RUNNER: DurableObjectNamespace<JobRunner>`, `R2_ENDPOINT: string`, `R2_BUCKET: string`, `R2_ACCESS_KEY_ID: string`, `R2_SECRET_ACCESS_KEY: string`, `CALLBACK_BASE_URL?: string`.
  - `class JobRunner extends DurableObject<Env>` with `run(request: RunRequest): Promise<void>` and `stop(): Promise<void>`; `interface RunRequest { payloadJson: string; deadlineMs: number }`.
  - `class CallbackEntrypoint extends WorkerEntrypoint<Env>` (forwards intercepted container requests into `app.fetch`).
  - Both classes are re-exported from `src/worker/index.ts` (wrangler requires Durable Object classes and entrypoints to be exports of the main module).
  - `wrangler.jsonc` cron `* * * * *`, queue consumer (`max_batch_size: 1`, `max_retries: 100`), `containers`, `durable_objects`, `migrations`, and `vars` `R2_BUCKET`, `R2_ENDPOINT`.

**Gotcha:**
- One Durable Object per job: `env.JOB_RUNNER.getByName(jobId)`. The job id is a UUIDv7, so ids never collide between backups and tests.
- `container.start()` returns before the container is ready; `exec()` waits for a starting container. The container's main process is `sleep infinity` so it stays up until `stop()` or the alarm destroys it. The runner is a second process started with `exec`, and its exit triggers `stop()`.
- Three independent guards stop a leaked container: `stop()` after the runner exits, the Durable Object alarm at `deadline + 10 min`, and `setInactivityTimeout` of the same length. [uncertain: `setInactivityTimeout` and the alarm were not run against a real container.]
- Never log `payloadJson`: it contains the decrypted secrets. `stdout` and `stderr` of the runner are ignored on purpose, because Phase 4's runner may print connection details.
- `RUNNER_COMMAND` is `CONTRACT_ENTRYPOINT` from `container/contract.ts` (Gate 4), whose test pins it to the Phase 4 Dockerfile `ENTRYPOINT`. Never retype the command.
- `max_instances` is 2 (round 2, answer 14) and is a config value, like `instance_type` (`basic`). `max_concurrent_jobs` defaults to `max_instances` - 1, so one instance stays free for a connection test or a restore. If you raise `max_instances`, the default in `SETTING_DEFAULTS` is still a stored setting, not derived from `wrangler.jsonc` at runtime; change it deliberately.
- `R2_ENDPOINT` in `wrangler.jsonc` is the placeholder `https://ACCOUNT_ID.r2.cloudflarestorage.com`. Never commit a real account id. Local development overrides both vars in `.dev.vars` (RustFS).
- Existing hand-built `Env` objects: `grep -rn "as Env\|as AppEnv\|: Env = {" src test` lists them. Casts compile unchanged. `test/helpers/env.ts` builds the real test env and needs the four `R2_*` values (Step 6) because the payload tests read them.

**Steps:**
- [ ] Step 1: Create `src/worker/globals.d.ts` (types `this.ctx.exports.CallbackEntrypoint` inside the Durable Object):
  ```ts
  // Types `this.ctx.exports.CallbackEntrypoint` inside the JobRunner Durable Object.
  declare namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }
  ```
- [ ] Step 2: Create `src/worker/container/job-runner.ts` (run in scratch: type-checks; not run in a container):
  ```ts
  import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
  import { app } from "../app";
  import type { Env } from "../env";
  import { CALLBACK_HOST } from "../jobs/types";
  import { CONTRACT_ENTRYPOINT } from "../../../container/contract";

  const RUNNER_COMMAND = [...CONTRACT_ENTRYPOINT];
  const GRACE_MS = 10 * 60 * 1000;

  /** Outbound handler: forwards requests the container sends to CALLBACK_HOST into the Hono app. */
  export class CallbackEntrypoint extends WorkerEntrypoint<Env> {
    override fetch(request: Request): Promise<Response> {
      return Promise.resolve(app.fetch(request, this.env, this.ctx));
    }
  }

  export interface RunRequest {
    /** Job payload JSON, written to the runner's stdin. Contains secrets: never log it. */
    payloadJson: string;
    /** Epoch ms after which the container must be gone. */
    deadlineMs: number;
  }

  /** One Durable Object per job id; each owns one container that runs one job. */
  export class JobRunner extends DurableObject<Env> {
    async run(request: RunRequest): Promise<void> {
      const container = this.ctx.container;
      if (!container) throw new Error("No container is configured for JobRunner");
      if (container.running) throw new Error("Job already started");

      container.start({ enableInternet: true, entrypoint: ["sleep", "infinity"] });
      await container.setInactivityTimeout(Math.max(request.deadlineMs - Date.now(), 0) + GRACE_MS);
      await this.ctx.storage.setAlarm(request.deadlineMs + GRACE_MS);
      await container.interceptOutboundHttp(CALLBACK_HOST, this.ctx.exports.CallbackEntrypoint({}));

      const proc = await container.exec(RUNNER_COMMAND, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      const writer = proc.stdin?.getWriter();
      if (!writer) throw new Error("Runner stdin is not available");
      await writer.write(new TextEncoder().encode(request.payloadJson));
      await writer.close();
      this.ctx.waitUntil(proc.exitCode.then(() => this.stop()));
    }

    async stop(): Promise<void> {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.container?.destroy("job finished");
    }

    override async alarm(): Promise<void> {
      await this.ctx.container?.destroy("deadline passed");
    }
  }
  ```
- [ ] Step 3: Replace `src/worker/env.ts` with (Phase 1 members kept, new members added):
  ```ts
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
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    /** Public Worker URL. Set only when the outbound-handler spike failed; empty means "use the outbound handler". */
    CALLBACK_BASE_URL?: string;
  }
  ```
- [ ] Step 4: Edit `src/worker/index.ts`: keep the Phase 1/2 default export for now and add the re-export line directly under the `import` lines:
  ```ts
  export { CallbackEntrypoint, JobRunner } from "./container/job-runner";
  ```
- [ ] Step 5: Edit `wrangler.jsonc`: replace the `queues` block with the one below and add the other keys (all other Phase 1 keys stay). This is the shape run in scratch through `getPlatformProxy`:
  ```jsonc
    // Added in Phase 5. Replace the existing "queues" block and add the rest before the closing brace.
    "queues": {
      "producers": [{ "binding": "JOBS", "queue": "cellar-jobs" }],
      "consumers": [{ "queue": "cellar-jobs", "max_batch_size": 1, "max_retries": 100 }]
    },
    "triggers": { "crons": ["* * * * *"] },
    // Placeholders. Local development overrides them in .dev.vars. Never commit a real account id.
    "vars": { "R2_BUCKET": "cellar-backups", "R2_ENDPOINT": "https://ACCOUNT_ID.r2.cloudflarestorage.com" },
    "containers": [
      {
        "class_name": "JobRunner",
        "image": "./container/Dockerfile",
        "image_build_context": "./container",
        "instance_type": "basic",
        "max_instances": 2
      }
    ],
    "durable_objects": { "bindings": [{ "name": "JOB_RUNNER", "class_name": "JobRunner" }] },
    "migrations": [{ "tag": "v1", "new_sqlite_classes": ["JobRunner"] }]
  ```
- [ ] Step 6: Edit `test/helpers/env.ts`: in the object `createTestEnv` builds, next to `DEV_BYPASS: "true"`, add the fake R2 values (they come before `...overrides` so tests can still override them):
  ```ts
      R2_ENDPOINT: "http://rustfs.test:9000",
      R2_BUCKET: "cellar-test",
      R2_ACCESS_KEY_ID: "test-access-key",
      R2_SECRET_ACCESS_KEY: "test-secret-key",
  ```
- [ ] Step 7: Append to `.dev.vars.example`:
  ```dotenv

  # R2 S3 credentials injected into each job's container. Create a bucket-scoped token
  # (Object Read & Write on the backup bucket only). Never reuse an account-wide token.
  R2_ACCESS_KEY_ID=
  R2_SECRET_ACCESS_KEY=

  # Local development only: point the container at RustFS (test and dev only) from test/docker-compose.test.yml.
  # These override the placeholder vars in wrangler.jsonc. Example values:
  #   R2_ENDPOINT=http://host.docker.internal:9000
  #   R2_BUCKET=cellar-test

  # Public URL of this Worker for container callbacks. Leave empty to use the outbound handler
  # (the container calls http://cellar-callback.internal and the Worker intercepts it).
  # Set it only if the outbound handler does not work; then also add an Access bypass for the
  # exact path /internal/jobs/callback.
  CALLBACK_BASE_URL=
  ```
- [ ] Step 8: Verify - Run: `bun run typecheck && bun run test 2>&1 | grep -v "Durable Object" | tail -8` - Expected: typecheck exit 0; the test summary shows `BASELINE_TESTS + 12` passing (the 3 helper tests and 9 settings tests from Tasks 3 and 4), 0 failed. This also proves `createTestEnv` still works with the container, Durable Object, queue consumer, and cron blocks in `wrangler.jsonc`.
- [ ] Step 9: Verify - Run: `grep -c "R2_SECRET_ACCESS_KEY" .dev.vars.example && git check-ignore .dev.vars && echo ignored` - Expected: `1` (or more), then `.dev.vars` and `ignored`
- [ ] Step 10: Commit - `git add src/worker/container/job-runner.ts src/worker/globals.d.ts src/worker/env.ts src/worker/index.ts wrangler.jsonc .dev.vars.example test/helpers/env.ts && git commit -m "feat: add JobRunner container class, callback entrypoint, bindings, and R2 env"`

---
### Task 6: Job state helpers and dispatch (cron enqueue, Backup now, Test connection)

**Files:**
- Create: `src/worker/jobs/state.ts`, `src/worker/jobs/dispatch.ts`
- Test: `test/worker/jobs/fixtures.ts` (shared by Tasks 6 to 10), `test/worker/jobs/dispatch.test.ts`

**Interfaces:**
- Consumes: `getDb`, tables `targets`, `backups`, `connectionTests`; `nextRun(expr: string, tz: string, after: Date): Date` from `src/shared/cron.ts` (X9, strictly after); `uuidv7(now?: number): string`; `ApiError(status, code, message, details?)`; `Env.JOBS`; `createTestEnv`; `encrypt` (Phase 1); `signCallback` and `deriveJobKey` (used by the fixture helper `signedHeaders`, needed from Task 8 on).
- Produces:
  - `scheduleSlot(at: Date): string` - `2026-10-24T02:00:00.000Z` style, UTC minute.
  - `enqueueDueBackups(env: Env, now: Date): Promise<EnqueueResult>` with `EnqueueResult = { enqueued: string[]; blocked: string[] }` (cron step 1).
  - `queueManualBackup(env: Env, targetId: string, now: Date): Promise<string>` (backup id; 409 `conflict` if active; 503 `enqueue_failed` if the send failed).
  - `queueConnectionTest(env: Env, targetId: string, now: Date): Promise<string>` (test id; 409 if a backup or test is active).
  - `claimJob(env: Env, options: ClaimOptions): Promise<boolean>`, `readJobStatus(env: Env, type: JobType, jobId: string): Promise<string | null>`, `failJob(env: Env, type: JobType, jobId: string, error: { code: string; message: string }, nowIso: string): Promise<boolean>`.
  - Test helpers (fixtures.ts): `insertTarget(env, id, overrides?)`, `insertBackup(env, id, targetId, overrides?)`, `insertTest(env, id, targetId, overrides?)`, `fakeQueue(options?)`, `signedHeaders(env, jobId, rawBody, timestamp?)`, `captureLogs()`, `NOW`, `DUE_SLOT`, `SECRETS`.

**Gotcha:**
- Idempotency comes from the database, not from a lock: `INSERT ... ON CONFLICT DO NOTHING` hits `uq_backups_target_slot` (same slot) or `uq_backups_active_target` (a backup is already active). The two cases are told apart by looking up the slot: a row with this slot means "already enqueued, advance"; no row means "blocked by an active backup, leave `next_run_at` alone".
- `next_run_at` is advanced with a compare-and-set (`WHERE next_run_at = <value read>`), so a concurrent PATCH of the schedule is not overwritten.
- If `JOBS.send` throws after the row was inserted, the row is marked `failed` with `enqueue_failed` so it never sits `queued` for an hour, and the slot is still consumed (the failed row is the visible record).
- A failure for one target must not stop the loop: each target is wrapped in try/catch and logs only the error class name.
- The cron test uses slot `2026-10-23T19:00:00.000Z` (= 02:00 Asia/Bangkok on 2026-10-24, no DST) and expects the next `next_run_at` `2026-10-24T19:00:00.000Z`. These values come from Phase 2's `nextRun` for the default schedule `0 2 * * *`; in scratch a stub with the same behavior was used. If the real `nextRun` disagrees, the plan or Phase 2 is wrong: STOP and report.
- Drizzle wraps D1 errors; `isUniqueViolation` walks the `cause` chain for the SQLite message `UNIQUE constraint failed`.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/state.ts` (the claim statement was run in scratch with SQLite and through D1 with 4 concurrent consumers):
  ```ts
  import { and, eq, inArray } from "drizzle-orm";
  import { getDb } from "../db/client";
  import { backups, connectionTests, targets } from "../db/schema";
  import type { Env } from "../env";
  import type { JobType } from "./types";

  export interface ClaimOptions {
    jobId: string;
    type: JobType;
    nowIso: string;
    /** Backups only: the R2 key chosen for this run. */
    r2Key?: string;
    /** Limit on running backups. Ignored for test jobs. */
    maxConcurrent: number;
  }

  /**
   * Atomically moves one `queued` job to `running`. Returns false when the row is not `queued`, when the
   * number of running backups is at the limit (tests and restores are not counted), or when the other job
   * type is running for the same target. One SQL statement, so two consumers cannot both pass the checks.
   */
  export async function claimJob(env: Env, options: ClaimOptions): Promise<boolean> {
    const { jobId, type, nowIso, r2Key, maxConcurrent } = options;
    const runningBackups = "(SELECT count(*) FROM backups WHERE status = 'running')";
    const statement =
      type === "backup"
        ? env.DB.prepare(
            `UPDATE backups SET status = 'running', started_at = ?, heartbeat_at = ?, attempt = attempt + 1, r2_key = ?
             WHERE id = ? AND status = 'queued'
             AND NOT EXISTS (SELECT 1 FROM connection_tests t WHERE t.target_id = backups.target_id AND t.status = 'running')
             AND ${runningBackups} < ?`,
          ).bind(nowIso, nowIso, r2Key ?? null, jobId, maxConcurrent)
        : env.DB.prepare(
            `UPDATE connection_tests SET status = 'running', started_at = ?, heartbeat_at = ?
             WHERE id = ? AND status = 'queued'
             AND NOT EXISTS (SELECT 1 FROM backups b WHERE b.target_id = connection_tests.target_id AND b.status = 'running')`,
          ).bind(nowIso, nowIso, jobId);
    const result = await statement.run();
    return result.meta.changes > 0;
  }

  /** Current status of a job row, or null when it does not exist. */
  export async function readJobStatus(env: Env, type: JobType, jobId: string): Promise<string | null> {
    const db = getDb(env);
    const [row] =
      type === "backup"
        ? await db.select({ status: backups.status }).from(backups).where(eq(backups.id, jobId)).limit(1)
        : await db.select({ status: connectionTests.status }).from(connectionTests).where(eq(connectionTests.id, jobId)).limit(1);
    return row?.status ?? null;
  }

  /** Moves a `queued` or `running` job to `failed`. Terminal rows are left alone. Returns true when a row changed. */
  export async function failJob(
    env: Env,
    type: JobType,
    jobId: string,
    error: { code: string; message: string },
    nowIso: string,
  ): Promise<boolean> {
    const db = getDb(env);
    const changes = { status: "failed" as const, errorCode: error.code, errorMessage: error.message, finishedAt: nowIso };
    if (type === "test") {
      const rows = await db
        .update(connectionTests)
        .set(changes)
        .where(and(eq(connectionTests.id, jobId), inArray(connectionTests.status, ["queued", "running"])))
        .returning({ id: connectionTests.id });
      return rows.length > 0;
    }
    const rows = await db
      .update(backups)
      .set(changes)
      .where(and(eq(backups.id, jobId), inArray(backups.status, ["queued", "running"])))
      .returning({ targetId: backups.targetId });
    const [row] = rows;
    if (!row) return false;
    await db.update(targets).set({ lastStatus: "failed" }).where(eq(targets.id, row.targetId));
    return true;
  }
  ```
- [ ] Step 2: Create `src/worker/jobs/dispatch.ts`:
  ```ts
  import { and, asc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
  import { nextRun } from "../../shared/cron";
  import { getDb } from "../db/client";
  import { backups, connectionTests, targets } from "../db/schema";
  import type { Env } from "../env";
  import { uuidv7 } from "../lib/uuidv7";
  import { ApiError } from "../middleware/error";
  import { failJob } from "./state";
  import { DUE_BATCH_LIMIT, type JobMessage } from "./types";

  /** UTC ISO minute of an instant, for example 2026-10-24T02:00:00.000Z. */
  export function scheduleSlot(at: Date): string {
    return `${at.toISOString().slice(0, 16)}:00.000Z`;
  }

  function isUniqueViolation(error: unknown): boolean {
    for (let current: unknown = error; current instanceof Error; current = current.cause) {
      if (current.message.includes("UNIQUE constraint failed")) return true;
    }
    return false;
  }

  /** Sends the queue message. If the send fails, the row is marked failed so it never sits `queued` for an hour. */
  async function enqueue(env: Env, message: JobMessage, now: Date): Promise<boolean> {
    try {
      await env.JOBS.send(message);
      return true;
    } catch {
      console.error(`jobs: enqueue failed for ${message.type} ${message.jobId}`);
      await failJob(env, message.type, message.jobId, { code: "enqueue_failed", message: "The job could not be queued" }, now.toISOString());
      return false;
    }
  }

  export interface EnqueueResult {
    enqueued: string[];
    /** Targets whose slot was due but which already have a queued or running backup. They are retried next tick. */
    blocked: string[];
  }

  /**
   * Cron step 1. For each due target: insert the `queued` row for the slot (the unique indexes make this
   * idempotent), send the queue message only if a row was inserted, then advance `next_run_at`.
   */
  export async function enqueueDueBackups(env: Env, now: Date): Promise<EnqueueResult> {
    const db = getDb(env);
    const nowIso = now.toISOString();
    const due = await db
      .select({ id: targets.id, scheduleCron: targets.scheduleCron, timezone: targets.timezone, nextRunAt: targets.nextRunAt })
      .from(targets)
      .where(and(eq(targets.enabled, true), isNull(targets.deletedAt), isNotNull(targets.nextRunAt), lte(targets.nextRunAt, nowIso)))
      .orderBy(asc(targets.nextRunAt))
      .limit(DUE_BATCH_LIMIT);

    const result: EnqueueResult = { enqueued: [], blocked: [] };
    for (const target of due) {
      if (!target.nextRunAt) continue;
      try {
        const slotTime = new Date(target.nextRunAt);
        const slot = scheduleSlot(slotTime);
        const jobId = uuidv7(now.getTime());
        const inserted = await db
          .insert(backups)
          .values({ id: jobId, targetId: target.id, status: "queued", trigger: "schedule", scheduleSlot: slot, queuedAt: nowIso })
          .onConflictDoNothing()
          .returning({ id: backups.id });

        if (inserted.length === 0) {
          const [sameSlot] = await db
            .select({ id: backups.id })
            .from(backups)
            .where(and(eq(backups.targetId, target.id), eq(backups.scheduleSlot, slot)))
            .limit(1);
          if (!sameSlot) {
            result.blocked.push(target.id);
            continue;
          }
        } else if (await enqueue(env, { jobId, type: "backup", targetId: target.id }, now)) {
          result.enqueued.push(jobId);
        }

        let next = nextRun(target.scheduleCron, target.timezone, slotTime);
        if (next.getTime() <= now.getTime()) next = nextRun(target.scheduleCron, target.timezone, now);
        await db
          .update(targets)
          .set({ nextRunAt: next.toISOString(), updatedAt: nowIso })
          .where(and(eq(targets.id, target.id), eq(targets.nextRunAt, target.nextRunAt)));
      } catch (error) {
        console.error(`jobs: scheduling target ${target.id} failed`, error instanceof Error ? error.name : "unknown");
      }
    }
    return result;
  }

  /** Backup now. Throws 409 when the target already has a queued or running backup. Returns the backup id. */
  export async function queueManualBackup(env: Env, targetId: string, now: Date): Promise<string> {
    const db = getDb(env);
    const jobId = uuidv7(now.getTime());
    try {
      await db.insert(backups).values({ id: jobId, targetId, status: "queued", trigger: "manual", queuedAt: now.toISOString() });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "conflict", "A backup is already queued or running for this target");
      throw error;
    }
    if (!(await enqueue(env, { jobId, type: "backup", targetId }, now))) {
      throw new ApiError(503, "enqueue_failed", "The backup could not be queued");
    }
    return jobId;
  }

  /** Test connection. Throws 409 when the target has a queued or running test or backup. Returns the test id. */
  export async function queueConnectionTest(env: Env, targetId: string, now: Date): Promise<string> {
    const db = getDb(env);
    const [activeBackup] = await db
      .select({ id: backups.id })
      .from(backups)
      .where(and(eq(backups.targetId, targetId), inArray(backups.status, ["queued", "running"])))
      .limit(1);
    if (activeBackup) throw new ApiError(409, "conflict", "A backup is queued or running for this target");

    const jobId = uuidv7(now.getTime());
    try {
      await db.insert(connectionTests).values({ id: jobId, targetId, status: "queued", queuedAt: now.toISOString() });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(409, "conflict", "A connection test is already queued or running for this target");
      throw error;
    }
    if (!(await enqueue(env, { jobId, type: "test", targetId }, now))) {
      throw new ApiError(503, "enqueue_failed", "The connection test could not be queued");
    }
    return jobId;
  }
  ```
- [ ] Step 3: Create `test/worker/jobs/fixtures.ts`:
  ```ts
  import { vi } from "vitest";
  import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import type { JobMessage } from "../../../src/worker/jobs/types";
  import { signCallback } from "../../../container/hmac";
  import { encrypt } from "../../../src/worker/lib/crypto";
  import { deriveJobKey } from "../../../src/worker/lib/job-key";

  export const SECRETS = { password: "s3cr3tpw", tokenId: "tok-id-123", tokenSecret: "tok-secret-456" };
  export const NOW = new Date("2026-10-24T02:00:30.000Z");
  /** 02:00 Asia/Bangkok on 2026-10-24, the slot that is due at NOW. */
  export const DUE_SLOT = "2026-10-23T19:00:00.000Z";

  export function fakeQueue(options: { failSend?: boolean } = {}): { queue: Queue<JobMessage>; sent: JobMessage[] } {
    const sent: JobMessage[] = [];
    const queue = {
      send: async (message: JobMessage) => {
        if (options.failSend) throw new Error("queue down");
        sent.push(message);
      },
    } as unknown as Queue<JobMessage>;
    return { queue, sent };
  }

  type TargetOverrides = Partial<typeof targets.$inferInsert>;

  export async function insertTarget(env: Env, id: string, overrides: TargetOverrides = {}): Promise<void> {
    const key = env.ENCRYPTION_KEY;
    await getDb(env)
      .insert(targets)
      .values({
        id,
        name: `target-${id}`,
        dbName: "shop",
        connectionUrlEnc: await encrypt(`postgres://app:${SECRETS.password}@db.internal:5432/shop?sslmode=require`, key),
          tunnelHostname: "db.example.com",
        tunnelTokenIdEnc: await encrypt(SECRETS.tokenId, key),
        tunnelTokenSecretEnc: await encrypt(SECRETS.tokenSecret, key),
        nextRunAt: DUE_SLOT,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        ...overrides,
      });
  }

  export async function insertBackup(env: Env, id: string, targetId: string, overrides: Partial<typeof backups.$inferInsert> = {}) {
    await getDb(env)
      .insert(backups)
      .values({ id, targetId, status: "queued", trigger: "manual", queuedAt: NOW.toISOString(), ...overrides });
  }

  export async function insertTest(env: Env, id: string, targetId: string, overrides: Partial<typeof connectionTests.$inferInsert> = {}) {
    await getDb(env)
      .insert(connectionTests)
      .values({ id, targetId, status: "queued", queuedAt: NOW.toISOString(), ...overrides });
  }

  export async function signedHeaders(env: Env, jobId: string, rawBody: string, timestamp: number = NOW.getTime() / 1000) {
    const ts = String(Math.floor(timestamp));
    const signature = await signCallback(await deriveJobKey(env.ENCRYPTION_KEY, jobId), ts, jobId, rawBody);
    return { timestamp: ts, signature };
  }

  export function captureLogs(): { text(): string } {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      });
    }
    return { text: () => lines.join("\n") };
  }
  ```
- [ ] Step 4: Create `test/worker/jobs/dispatch.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { eq } from "drizzle-orm";
  import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import { enqueueDueBackups, queueConnectionTest, queueManualBackup, scheduleSlot } from "../../../src/worker/jobs/dispatch";
  import { createTestEnv } from "../../helpers/env";
  import { DUE_SLOT, fakeQueue, insertBackup, insertTarget, NOW } from "./fixtures";

  let env: Env;
  let sent: ReturnType<typeof fakeQueue>["sent"];
  let dispose: () => Promise<void>;

  beforeEach(async () => {
    const fake = fakeQueue();
    sent = fake.sent;
    const created = await createTestEnv({ JOBS: fake.queue });
    env = created.env;
    dispose = created.dispose;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await dispose();
  });

  const allBackups = () => getDb(env).select().from(backups);
  const nextRunOf = async (id: string) => (await getDb(env).select().from(targets).where(eq(targets.id, id)))[0]?.nextRunAt;

  describe("scheduleSlot", () => {
    it("truncates to the UTC minute", () => {
      expect(scheduleSlot(new Date("2026-10-24T02:00:37.123Z"))).toBe("2026-10-24T02:00:00.000Z");
    });
  });

  describe("enqueueDueBackups", () => {
    it("queues one backup for a due target, sends one message, and advances next_run_at to tomorrow", async () => {
      await insertTarget(env, "t1");
      const result = await enqueueDueBackups(env, NOW);
      expect(result.enqueued).toHaveLength(1);
      const rows = await allBackups();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ targetId: "t1", status: "queued", trigger: "schedule", scheduleSlot: DUE_SLOT });
      expect(sent).toEqual([{ jobId: rows[0]?.id, type: "backup", targetId: "t1" }]);
      expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
    });

    it("does not enqueue twice when the cron fires twice", async () => {
      await insertTarget(env, "t1");
      await enqueueDueBackups(env, NOW);
      await enqueueDueBackups(env, new Date(NOW.getTime() + 1000));
      expect(await allBackups()).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it("does not enqueue twice when two ticks run at the same time", async () => {
      await insertTarget(env, "t1");
      await Promise.all([enqueueDueBackups(env, NOW), enqueueDueBackups(env, NOW)]);
      expect(await allBackups()).toHaveLength(1);
      expect(sent).toHaveLength(1);
    });

    it("does not enqueue twice when a first tick died before advancing next_run_at", async () => {
      await insertTarget(env, "t1");
      await enqueueDueBackups(env, NOW);
      await getDb(env).update(targets).set({ nextRunAt: DUE_SLOT }).where(eq(targets.id, "t1"));
      await getDb(env).update(backups).set({ status: "success" });
      const result = await enqueueDueBackups(env, NOW);
      expect(result.enqueued).toHaveLength(0);
      expect(await allBackups()).toHaveLength(1);
      expect(sent).toHaveLength(1);
      expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
    });

    it("ignores targets that are not due, disabled, deleted, or have no next_run_at", async () => {
      await insertTarget(env, "future", { nextRunAt: "2026-10-24T19:00:00.000Z" });
      await insertTarget(env, "disabled", { enabled: false });
      await insertTarget(env, "deleted", { deletedAt: NOW.toISOString() });
      await insertTarget(env, "none", { nextRunAt: null });
      expect((await enqueueDueBackups(env, NOW)).enqueued).toHaveLength(0);
      expect(await allBackups()).toHaveLength(0);
    });

    it("skips a target that already has an active backup and retries on the next tick", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "manual-1", "t1", { status: "running" });
      const result = await enqueueDueBackups(env, NOW);
      expect(result).toEqual({ enqueued: [], blocked: ["t1"] });
      expect(await nextRunOf("t1")).toBe(DUE_SLOT);
      await getDb(env).update(backups).set({ status: "success" });
      expect((await enqueueDueBackups(env, new Date(NOW.getTime() + 60_000))).enqueued).toHaveLength(1);
    });

    it("jumps next_run_at past now after a long outage instead of queueing every missed slot", async () => {
      await insertTarget(env, "t1", { nextRunAt: "2026-10-19T19:00:00.000Z" });
      await enqueueDueBackups(env, NOW);
      expect(await allBackups()).toHaveLength(1);
      expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
    });

    it("marks the row failed and still advances when the queue send fails", async () => {
      const failing = fakeQueue({ failSend: true });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const failingEnv = { ...env, JOBS: failing.queue } as Env;
      await insertTarget(env, "t1");
      await enqueueDueBackups(failingEnv, NOW);
      const [row] = await allBackups();
      expect(row).toMatchObject({ status: "failed", errorCode: "enqueue_failed" });
      expect(await nextRunOf("t1")).toBe("2026-10-24T19:00:00.000Z");
    });

    it("keeps going when one target fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await insertTarget(env, "a", { nextRunAt: `${DUE_SLOT}garbage` });
      await insertTarget(env, "b");
      const result = await enqueueDueBackups(env, NOW);
      expect(result.enqueued).toHaveLength(1);
      expect((await allBackups())[0]?.targetId).toBe("b");
    });
  });

  describe("queueManualBackup", () => {
    it("creates a queued manual backup and sends one message", async () => {
      await insertTarget(env, "t1");
      const id = await queueManualBackup(env, "t1", NOW);
      expect(sent).toEqual([{ jobId: id, type: "backup", targetId: "t1" }]);
      expect((await allBackups())[0]).toMatchObject({ id, trigger: "manual", status: "queued", scheduleSlot: null });
    });

    it("rejects a second backup while one is queued or running with 409", async () => {
      await insertTarget(env, "t1");
      await queueManualBackup(env, "t1", NOW);
      await expect(queueManualBackup(env, "t1", NOW)).rejects.toMatchObject({ status: 409 });
      expect(sent).toHaveLength(1);
    });

    it("allows a new backup once the previous one is finished", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "old", "t1", { status: "success" });
      await expect(queueManualBackup(env, "t1", NOW)).resolves.toBeTruthy();
    });
  });

  describe("queueConnectionTest", () => {
    it("creates a queued test and sends a test message", async () => {
      await insertTarget(env, "t1");
      const id = await queueConnectionTest(env, "t1", NOW);
      expect(sent).toEqual([{ jobId: id, type: "test", targetId: "t1" }]);
      expect((await getDb(env).select().from(connectionTests))[0]).toMatchObject({ id, status: "queued" });
    });

    it("rejects with 409 while a test or a backup is active for the target", async () => {
      await insertTarget(env, "t1");
      await queueConnectionTest(env, "t1", NOW);
      await expect(queueConnectionTest(env, "t1", NOW)).rejects.toMatchObject({ status: 409 });
      await insertTarget(env, "t2");
      await insertBackup(env, "b", "t2", { status: "running" });
      await expect(queueConnectionTest(env, "t2", NOW)).rejects.toMatchObject({ status: 409 });
    });
  });
  ```
- [ ] Step 5: Verify - Run: `bunx vitest run test/worker/jobs/dispatch.test.ts && bun run typecheck` - Expected: 15 pass, 0 fail; typecheck exit 0
- [ ] Step 6: Negative control (once): in `dispatch.ts` remove `.onConflictDoNothing()` from the cron insert, run the file, and expect `does not enqueue twice when a first tick died before advancing next_run_at` and `skips a target that already has an active backup and retries on the next tick` to FAIL (run in scratch: exactly these two failed); then restore it and re-run - Expected: 15 pass
- [ ] Step 7: Commit - `git add src/worker/jobs/state.ts src/worker/jobs/dispatch.ts test/worker/jobs/fixtures.ts test/worker/jobs/dispatch.test.ts && git commit -m "feat: add idempotent cron enqueue, Backup now, and Test connection dispatch"`

---
### Task 7: Job payload, queue consumer, and container client

**Files:**
- Create: `src/worker/jobs/payload.ts`, `src/worker/jobs/consumer.ts`, `src/worker/jobs/runner-client.ts`
- Test: `test/worker/jobs/consumer.test.ts`

**Interfaces:**
- Consumes: Task 3 constants and `deriveJobKey`, `buildBackupKey`; Task 4 `getSettings(db: Db): Promise<Settings>`; Task 6 `claimJob`, `failJob`, `readJobStatus`; `decrypt(payload: string, keyBase64: string): Promise<string>` (Phase 1); `Env.JOB_RUNNER` (Task 5); Task 6 fixtures; `SAMPLE_JOBS` and `jobShape(value: unknown, prefix?: string): string[]` from `container/contract.ts` (Phase 4, Gate 4, test only).
- Produces:
  - `type JobPayload` (the Worker-to-container JSON of docs/PLAN.md section 5: `jobId, type, callbackUrl, jobKey, deadlineAt, db { url, name }, tunnel?, r2?`), `buildJobPayload(env: Env, target: TargetRow, job: { id: string; type: JobType; r2Key?: string }, startedAt: Date): Promise<JobPayload>`, `rewriteForTunnel(connectionUrl: string, localPort: number): string`, `jobDeadline(type: JobType, target: TargetRow, startedAt: Date): Date`.
  - `handleJobMessage(env: Env, message: QueueMessageLike, deps: ConsumerDeps): Promise<void>` with `ConsumerDeps = { startJob(payload: JobPayload): Promise<void>; now(): Date }` and `QueueMessageLike = { body: unknown; ack(): void; retry(options?: { delaySeconds?: number }): void }`.
  - `startJob(env: Env, payload: JobPayload): Promise<void>` and `stopJob(env: Env, jobId: string): Promise<void>` (best effort, never throws).

**Gotcha:**
- Order inside `handleJobMessage` matters: validate message, check the row is `queued` (else ack), load the target (deleted target fails the row), choose the R2 key, read the concurrency setting, `claimJob` (the atomic step), and only then decrypt and build the payload. A claim refusal re-reads the status: still `queued` means the backup limit or the per-target rule blocked it (a test job is only ever blocked by the per-target rule), so `retry({ delaySeconds: 30 })`; anything else means another consumer won, so ack.
- Start failures (decrypt error, Durable Object error) mark the row `failed` with code `START_FAILED` and a fixed message, and log only `error.name`. The error message can contain secrets, so it is never stored or logged.
- A tunnel-mode URL is rewritten to `127.0.0.1:15432` by the `URL` class, which keeps user, percent-encoded password, database, and query. Verified in scratch for raw `@` and `:` in passwords.
- Every target has tunnel settings (the columns are NOT NULL), so `buildJobPayload` always builds the `tunnel` block and rewrites the URL. A secret that cannot be decrypted throws before anything is sent.
- `startJob` passes `deadlineMs` so the Durable Object can set its alarm and inactivity timeout.
- Test payload: no `r2` block, deadline `now + 5 minutes`.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/payload.ts`:
  ```ts
  import type { targets } from "../db/schema";
  import type { Env } from "../env";
  import { decrypt } from "../lib/crypto";
  import { deriveJobKey } from "../lib/job-key";
  import {
    CALLBACK_HOST,
    CALLBACK_PATH,
    PART_SIZE_BYTES,
    TEST_DEADLINE_MINUTES,
    TUNNEL_LOCAL_PORT,
    type JobType,
  } from "./types";

  export type TargetRow = typeof targets.$inferSelect;

  /** Worker-to-container job input (docs/PLAN.md section 5). Contains secrets: never log or queue it. */
  export interface JobPayload {
    jobId: string;
    type: JobType;
    callbackUrl: string;
    jobKey: string;
    deadlineAt: string;
    db: { url: string; name: string };
    tunnel: { hostname: string; tokenId: string; tokenSecret: string; localPort: number };
    r2?: {
      endpoint: string;
      bucket: string;
      key: string;
      accessKeyId: string;
      secretAccessKey: string;
      partSizeBytes: number;
    };
  }

  /** Points the connection URL at the local end of the tunnel, keeping user, password, database, and query. */
  export function rewriteForTunnel(connectionUrl: string, localPort: number): string {
    const url = new URL(connectionUrl);
    url.hostname = "127.0.0.1";
    url.port = String(localPort);
    return url.toString();
  }

  export function jobDeadline(type: JobType, target: TargetRow, startedAt: Date): Date {
    const minutes = type === "backup" ? target.jobDeadlineMinutes : TEST_DEADLINE_MINUTES;
    return new Date(startedAt.getTime() + minutes * 60_000);
  }

  export async function buildJobPayload(
    env: Env,
    target: TargetRow,
    job: { id: string; type: JobType; r2Key?: string },
    startedAt: Date,
  ): Promise<JobPayload> {
    const key = env.ENCRYPTION_KEY;
    const connectionUrl = await decrypt(target.connectionUrlEnc, key);
    const callbackBase = env.CALLBACK_BASE_URL ? env.CALLBACK_BASE_URL.replace(/\/+$/, "") : `http://${CALLBACK_HOST}`;

    const payload: JobPayload = {
      jobId: job.id,
      type: job.type,
      callbackUrl: `${callbackBase}${CALLBACK_PATH}`,
      jobKey: await deriveJobKey(key, job.id),
      deadlineAt: jobDeadline(job.type, target, startedAt).toISOString(),
      db: { url: rewriteForTunnel(connectionUrl, TUNNEL_LOCAL_PORT), name: target.dbName },
      tunnel: {
        hostname: target.tunnelHostname,
        tokenId: await decrypt(target.tunnelTokenIdEnc, key),
        tokenSecret: await decrypt(target.tunnelTokenSecretEnc, key),
        localPort: TUNNEL_LOCAL_PORT,
      },
    };

    if (job.type === "backup") {
      if (!job.r2Key) throw new Error("A backup job needs an R2 key");
      payload.r2 = {
        endpoint: env.R2_ENDPOINT,
        bucket: env.R2_BUCKET,
        key: job.r2Key,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        partSizeBytes: PART_SIZE_BYTES,
      };
    }
    return payload;
  }
  ```
- [ ] Step 2: Create `src/worker/jobs/runner-client.ts`:
  ```ts
  import type { Env } from "../env";
  import type { JobPayload } from "./payload";

  /** Starts the job's container through its Durable Object. Returns once the runner has its input. */
  export async function startJob(env: Env, payload: JobPayload): Promise<void> {
    const stub = env.JOB_RUNNER.getByName(payload.jobId);
    await stub.run({ payloadJson: JSON.stringify(payload), deadlineMs: Date.parse(payload.deadlineAt) });
  }

  /** Best effort: stops the job's container. A missing or already stopped container is not an error. */
  export async function stopJob(env: Env, jobId: string): Promise<void> {
    try {
      await env.JOB_RUNNER.getByName(jobId).stop();
    } catch {
      console.warn(`jobs: could not stop container for ${jobId}`);
    }
  }
  ```
- [ ] Step 3: Create `src/worker/jobs/consumer.ts`:
  ```ts
  import { and, eq, isNull } from "drizzle-orm";
  import { getDb } from "../db/client";
  import { targets } from "../db/schema";
  import type { Env } from "../env";
  import { getSettings } from "../lib/settings";
  import { buildJobPayload, type JobPayload } from "./payload";
  import { buildBackupKey } from "../lib/r2-key";
  import { claimJob, failJob, readJobStatus } from "./state";
  import { jobMessageSchema, QUEUE_RETRY_DELAY_SECONDS } from "./types";

  export interface ConsumerDeps {
    startJob(payload: JobPayload): Promise<void>;
    now(): Date;
  }

  export interface QueueMessageLike {
    body: unknown;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
  }

  /**
   * Handles one queue message (`max_batch_size` is 1). Idempotent: a message whose row is not `queued` is acked
   * and ignored. Never logs the payload.
   */
  export async function handleJobMessage(env: Env, message: QueueMessageLike, deps: ConsumerDeps): Promise<void> {
    const parsed = jobMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      console.warn("jobs: dropped a malformed queue message");
      message.ack();
      return;
    }
    const { jobId, type, targetId } = parsed.data;
    const now = deps.now();
    const nowIso = now.toISOString();
    const db = getDb(env);

    const status = await readJobStatus(env, type, jobId);
    if (status !== "queued") {
      message.ack();
      return;
    }

    const [target] = await db
      .select()
      .from(targets)
      .where(and(eq(targets.id, targetId), isNull(targets.deletedAt)))
      .limit(1);
    if (!target) {
      await failJob(env, type, jobId, { code: "target_unavailable", message: "The target no longer exists" }, nowIso);
      message.ack();
      return;
    }

    const r2Key = type === "backup" ? buildBackupKey(target.id, target.dbName, now) : undefined;
    const { max_concurrent_jobs: maxConcurrent } = await getSettings(db);
    const claimed = await claimJob(env, { jobId, type, nowIso, r2Key, maxConcurrent });
    if (!claimed) {
      if ((await readJobStatus(env, type, jobId)) === "queued") message.retry({ delaySeconds: QUEUE_RETRY_DELAY_SECONDS });
      else message.ack();
      return;
    }

    try {
      const payload = await buildJobPayload(env, target, { id: jobId, type, r2Key }, now);
      await deps.startJob(payload);
    } catch (error) {
      console.error(`jobs: could not start ${type} ${jobId}`, error instanceof Error ? error.name : "unknown");
      await failJob(env, type, jobId, { code: "START_FAILED", message: "The container could not be started" }, deps.now().toISOString());
    }
    message.ack();
  }
  ```
- [ ] Step 4: Create `test/worker/jobs/consumer.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { eq } from "drizzle-orm";
  import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import { handleJobMessage, type QueueMessageLike } from "../../../src/worker/jobs/consumer";
  import { enqueueDueBackups, queueManualBackup } from "../../../src/worker/jobs/dispatch";
  import { rewriteForTunnel, type JobPayload } from "../../../src/worker/jobs/payload";
  import { jobShape, SAMPLE_JOBS } from "../../../container/contract";
  import { updateSettings } from "../../../src/worker/lib/settings";
  import { createTestEnv } from "../../helpers/env";
  import { captureLogs, fakeQueue, insertBackup, insertTarget, insertTest, NOW, SECRETS } from "./fixtures";

  let env: Env;
  let sent: ReturnType<typeof fakeQueue>["sent"];
  let dispose: () => Promise<void>;
  let started: JobPayload[];

  beforeEach(async () => {
    const fake = fakeQueue();
    sent = fake.sent;
    const created = await createTestEnv({ JOBS: fake.queue });
    env = created.env;
    dispose = created.dispose;
    started = [];
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await dispose();
  });

  function message(body: unknown) {
    return { body, ack: vi.fn<QueueMessageLike["ack"]>(), retry: vi.fn<QueueMessageLike["retry"]>() };
  }
  const deps = (failWith?: Error) => ({
    now: () => NOW,
    startJob: async (payload: JobPayload) => {
      if (failWith) throw failWith;
      started.push(payload);
    },
  });
  const backupRow = async (id: string) => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
  const testRow = async (id: string) => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, id)))[0];
  const backupMessage = (jobId: string, targetId = "t1") => message({ jobId, type: "backup", targetId });

  describe("handleJobMessage - backup", () => {
    it("claims the row, marks it running with an R2 key, starts the container, and acks", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1");
      const msg = backupMessage("b1");
      await handleJobMessage(env, msg, deps());
      expect(await backupRow("b1")).toMatchObject({
        status: "running",
        startedAt: NOW.toISOString(),
        heartbeatAt: NOW.toISOString(),
        attempt: 1,
        r2Key: "backups/t1/2026/10/24/2026-10-24T02:00:30.000Z_shop.dump",
      });
      expect(started).toHaveLength(1);
      expect(msg.ack).toHaveBeenCalledOnce();
    });

    it("builds the tunnel payload: rewritten URL, decrypted tunnel token, R2 block, deadline, callback URL", async () => {
      await insertTarget(env, "t1", { jobDeadlineMinutes: 90 });
      await insertBackup(env, "b1", "t1");
      await handleJobMessage(env, backupMessage("b1"), deps());
      const payload = started[0];
      expect(payload).toMatchObject({
        jobId: "b1",
        type: "backup",
        callbackUrl: "http://cellar-callback.internal/internal/jobs/callback",
        deadlineAt: "2026-10-24T03:30:30.000Z",
        db: { url: `postgres://app:${SECRETS.password}@127.0.0.1:15432/shop?sslmode=require`, name: "shop" },
        tunnel: { hostname: "db.example.com", tokenId: SECRETS.tokenId, tokenSecret: SECRETS.tokenSecret, localPort: 15432 },
        r2: {
          endpoint: "http://rustfs.test:9000",
          bucket: "cellar-test",
          key: "backups/t1/2026/10/24/2026-10-24T02:00:30.000Z_shop.dump",
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret-key",
          partSizeBytes: 33554432,
        },
      });
      expect(Buffer.from(payload?.jobKey ?? "", "base64")).toHaveLength(32);
    });

    it("uses CALLBACK_BASE_URL when it is set", async () => {
      const withBase = { ...env, CALLBACK_BASE_URL: "https://cellar.example.com/" } as Env;
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1");
      await handleJobMessage(withBase, backupMessage("b1"), deps());
      expect(started[0]?.callbackUrl).toBe("https://cellar.example.com/internal/jobs/callback");
    });

    it("acks and ignores a message whose row is not queued (idempotent redelivery)", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1", { status: "running" });
      const msg = backupMessage("b1");
      await handleJobMessage(env, msg, deps());
      expect(msg.ack).toHaveBeenCalledOnce();
      expect(started).toHaveLength(0);
      const unknown = backupMessage("missing");
      await handleJobMessage(env, unknown, deps());
      expect(unknown.ack).toHaveBeenCalledOnce();
    });

    it("starts a redelivered message only once", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1");
      await handleJobMessage(env, backupMessage("b1"), deps());
      await handleJobMessage(env, backupMessage("b1"), deps());
      expect(started).toHaveLength(1);
    });

    it("acks malformed messages without touching anything", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const msg = message({ jobId: "x", type: "restore", targetId: "t1", extra: true });
      await handleJobMessage(env, msg, deps());
      expect(msg.ack).toHaveBeenCalledOnce();
      expect(started).toHaveLength(0);
    });

    it("fails the job when the target was deleted", async () => {
      await insertTarget(env, "t1", { deletedAt: NOW.toISOString() });
      await insertBackup(env, "b1", "t1");
      await handleJobMessage(env, backupMessage("b1"), deps());
      expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "target_unavailable" });
    });

    it("marks the job failed START_FAILED when the container cannot start, and acks", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1");
      const msg = backupMessage("b1");
      await handleJobMessage(env, msg, deps(new Error("no capacity")));
      expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "START_FAILED" });
      expect((await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0]?.lastStatus).toBe("failed");
      expect(msg.ack).toHaveBeenCalledOnce();
    });

    it("marks the job failed when a tunnel secret cannot be decrypted", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await insertTarget(env, "t1", { tunnelTokenSecretEnc: "not-a-valid-payload" });
      await insertBackup(env, "b1", "t1");
      await handleJobMessage(env, backupMessage("b1"), deps());
      expect(await backupRow("b1")).toMatchObject({ status: "failed", errorCode: "START_FAILED" });
      expect(started).toHaveLength(0);
    });
  });

  describe("handleJobMessage - concurrency", () => {
    it("retries with a delay when the global limit is reached, then starts once a slot frees up", async () => {
      await updateSettings(getDb(env), { max_concurrent_jobs: 1 }, NOW);
      await insertTarget(env, "t1");
      await insertTarget(env, "t2");
      await insertBackup(env, "b1", "t1", { status: "running" });
      await insertBackup(env, "b2", "t2");
      const first = backupMessage("b2", "t2");
      await handleJobMessage(env, first, deps());
      expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
      expect(first.ack).not.toHaveBeenCalled();
      expect((await backupRow("b2"))?.status).toBe("queued");
      expect(started).toHaveLength(0);

      await getDb(env).update(backups).set({ status: "success" }).where(eq(backups.id, "b1"));
      const second = backupMessage("b2", "t2");
      await handleJobMessage(env, second, deps());
      expect(second.ack).toHaveBeenCalledOnce();
      expect((await backupRow("b2"))?.status).toBe("running");
    });

    it("does not count a running connection test against the backup limit", async () => {
      await updateSettings(getDb(env), { max_concurrent_jobs: 1 }, NOW);
      await insertTarget(env, "t1");
      await insertTarget(env, "t2");
      await insertTest(env, "c1", "t1", { status: "running" });
      await insertBackup(env, "b2", "t2");
      const msg = backupMessage("b2", "t2");
      await handleJobMessage(env, msg, deps());
      expect(msg.ack).toHaveBeenCalledOnce();
      expect((await backupRow("b2"))?.status).toBe("running");
    });

    it("starts a connection test even when the backup limit is reached", async () => {
      await updateSettings(getDb(env), { max_concurrent_jobs: 1 }, NOW);
      await insertTarget(env, "t1");
      await insertTarget(env, "t2");
      await insertBackup(env, "b1", "t1", { status: "running" });
      await insertTest(env, "c2", "t2");
      const msg = message({ jobId: "c2", type: "test", targetId: "t2" });
      await handleJobMessage(env, msg, deps());
      expect(msg.ack).toHaveBeenCalledOnce();
      expect((await testRow("c2"))?.status).toBe("running");
    });

    it("uses the default limit of 1 when no setting is stored", async () => {
      for (const id of ["t1", "t2"]) {
        await insertTarget(env, id);
        await insertBackup(env, `b-${id}`, id);
      }
      const messages = ["t1", "t2"].map((id) => backupMessage(`b-${id}`, id));
      for (const msg of messages) await handleJobMessage(env, msg, deps());
      expect(started).toHaveLength(1);
      expect(messages[1]?.retry).toHaveBeenCalledOnce();
    });

    it("never starts more than the limit when messages are handled concurrently", async () => {
      await updateSettings(getDb(env), { max_concurrent_jobs: 2 }, NOW);
      for (const id of ["t1", "t2", "t3", "t4"]) {
        await insertTarget(env, id);
        await insertBackup(env, `b-${id}`, id);
      }
      await Promise.all(["t1", "t2", "t3", "t4"].map((id) => handleJobMessage(env, backupMessage(`b-${id}`, id), deps())));
      expect(started).toHaveLength(2);
    });

    it("does not run a test and a backup for the same target at the same time", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1", { status: "running" });
      await insertTest(env, "c1", "t1");
      const msg = message({ jobId: "c1", type: "test", targetId: "t1" });
      await handleJobMessage(env, msg, deps());
      expect(msg.retry).toHaveBeenCalledOnce();
      expect((await testRow("c1"))?.status).toBe("queued");
    });
  });

  describe("handleJobMessage - test job", () => {
    it("starts a tunnel test with a 5 minute deadline and no R2 block", async () => {
      await insertTarget(env, "t1");
      await insertTest(env, "c1", "t1");
      await handleJobMessage(env, message({ jobId: "c1", type: "test", targetId: "t1" }), deps());
      expect((await testRow("c1"))?.status).toBe("running");
      expect(started[0]).toMatchObject({ jobId: "c1", type: "test", deadlineAt: "2026-10-24T02:05:30.000Z" });
      expect(started[0]?.r2).toBeUndefined();
    });
  });

  describe("secrets stay out of queue messages and logs", () => {
    it("never writes decrypted secrets to the queue or to console output across the whole flow", async () => {
      const logs = captureLogs();
      await insertTarget(env, "t1");
      await insertTarget(env, "t2", { nextRunAt: null });
      await enqueueDueBackups(env, NOW);
      await queueManualBackup(env, "t2", NOW);
      for (const body of sent) await handleJobMessage(env, message(body), deps(new Error(`start failed for ${SECRETS.password}`)));
      expect(sent).toHaveLength(2);
      const everything = JSON.stringify(sent) + logs.text();
      for (const secret of [SECRETS.password, SECRETS.tokenId, SECRETS.tokenSecret, env.ENCRYPTION_KEY, env.R2_SECRET_ACCESS_KEY]) {
        expect(everything).not.toContain(secret);
      }
      expect(sent.every((body) => Object.keys(body).sort().join() === "jobId,targetId,type")).toBe(true);
      expect(logs.text()).toContain("could not start backup");
    });

    it("positive control: the container payload does carry the decrypted secrets", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1");
      await handleJobMessage(env, backupMessage("b1"), deps());
      expect(JSON.stringify(started[0])).toContain(SECRETS.password);
      expect(JSON.stringify(started[0])).toContain(SECRETS.tokenSecret);
    });

    it("builds payloads with the same shape as the Phase 4 SAMPLE_JOBS", async () => {
      await insertTarget(env, "t1");
      await insertBackup(env, "b1", "t1");
      await insertTarget(env, "t2");
      await insertTest(env, "c1", "t2");
      await handleJobMessage(env, backupMessage("b1"), deps());
      await handleJobMessage(env, message({ jobId: "c1", type: "test", targetId: "t2" }), deps());
      expect(jobShape(started[0])).toEqual(jobShape(SAMPLE_JOBS.backup));
      expect(jobShape(started[1])).toEqual(jobShape(SAMPLE_JOBS.test));
    });
  });

  describe("rewriteForTunnel", () => {
    it.each([
      ["postgres://app:p%40ss@db.example.com:5432/shop?sslmode=require", "postgres://app:p%40ss@127.0.0.1:15432/shop?sslmode=require"],
      ["postgres://app:p@ss:w0rd@db.example.com/shop", "postgres://app:p%40ss%3Aw0rd@127.0.0.1:15432/shop"],
      ["postgresql://u:pw@host.docker.internal:5433/db", "postgresql://u:pw@127.0.0.1:15432/db"],
    ])("%s", (input, expected) => {
      expect(rewriteForTunnel(input, 15432)).toBe(expected);
    });
  });
  ```
- [ ] Step 5: Verify - Run: `bunx vitest run test/worker/jobs/consumer.test.ts && bun run typecheck` - Expected: 22 pass, 0 fail; typecheck exit 0. The suite includes: concurrency limit respected (sequential and `Promise.all`), per-target exclusion, idempotent redelivery, and "decrypted secrets never appear in queue messages or console output" with a positive control (the container payload does contain them).
- [ ] Step 6: Negative control (once): in `claimJob` (Task 6, `state.ts`) delete the line `AND ${runningBackups} < ?` and the bound value `maxConcurrent` in the backup statement, run the file, and expect exactly three tests to FAIL (`retries with a delay ...`, `uses the default limit of 1 ...`, `never starts more than the limit ...`; run in scratch); then restore the line and re-run - Expected: 22 pass
- [ ] Step 7: Commit - `git add src/worker/jobs/payload.ts src/worker/jobs/runner-client.ts src/worker/jobs/consumer.ts test/worker/jobs/consumer.test.ts && git commit -m "feat: add queue consumer with atomic claim, concurrency limits, and container payload"`

---
### Task 8: Job callback endpoint

**Files:**
- Create: `src/worker/jobs/callback.ts`, `src/worker/routes/internal.ts`
- Modify: `src/worker/app.ts` (anchor: the `app.route("/api/settings", ...)` line from Task 4)
- Test: `test/worker/jobs/callback.test.ts`

**Interfaces:**
- Consumes: `signCallback(jobKeyBase64: string, timestamp: string, jobId: string, rawBody: string): Promise<string>` from `container/hmac.ts` (X14, confirmed by owner answer 13; Phase 4 exports it); `SIGNATURE_VECTOR` from `container/contract.ts` (Phase 4, Gate 4, test only); `deriveJobKey` (Task 3); `redactSecrets` (Phase 1); `ApiError`; tables; Task 6 fixtures (`signedHeaders`).
- Produces:
  - `handleCallback(env: Env, rawBody: string, headers: CallbackHeaders, now: Date): Promise<CallbackOutcome>` with `CallbackHeaders = { timestamp: string | undefined; signature: string | undefined }` and `CallbackOutcome = { applied: boolean; type: JobType; event: "started" | "progress" | "succeeded" | "failed"; targetId: string }`. Throws `ApiError` 401 (any authentication failure, generic body), 413, 400, or 404.
  - `verifyCallbackSignature(jobKeyBase64: string, timestamp: string, jobId: string, rawBody: string, signatureHex: string): Promise<boolean>` (the Worker-side verifier, constant-time compare; the test checks it against `SIGNATURE_VECTOR`).
  - Route `POST /internal/jobs/callback` (`internal`, a `Hono<{ Bindings: Env }>` mounted at `/internal`) returning `200 { ok: true, applied: boolean }`.
  - **Extension points for later phases:** Phase 6 hooks retention after `outcome.type === "backup" && outcome.event === "succeeded" && outcome.applied` in `routes/internal.ts` (use `c.executionCtx.waitUntil`); Phase 7 adds a `restores` branch next to the `backups` and `connectionTests` lookups in `handleCallback`; Phase 8 fires alerts from the same hook site when `outcome.event === "failed"`.

**Gotcha:**
- Check order is fixed: body size (413), then signature, then timestamp window, then body shape (400), then state. Signature and timestamp failures share one generic 401 so an attacker learns nothing about which check failed. The job id is read with a minimal parse first, because the key depends on it.
- The signature is recomputed with `signCallback` and compared in constant time (`safeEqual`) in `verifyCallbackSignature`, so the Worker needs only the signing function from `container/hmac.ts`. The test checks that verifier against the Phase 4 `SIGNATURE_VECTOR`.
- `seq` starts at 1 in the container. A callback applies only if `seq > last_seq` and the row is `queued` or `running`, in ONE conditional `UPDATE ... RETURNING`. Duplicates, replays, late events after `timed_out`, and a second terminal event all return `200 { applied: false }`.
- `failed` needs `error`, `succeeded` needs `result`; otherwise 400 (the container sees a non-2xx and the sweeper eventually times the job out).
- Error messages are redacted again here (`redactSecrets`) and cut to 1000 characters, even though the container redacts first.
- Success updates `targets.last_backup_at` and `last_status = "success"`; failure sets `last_status = "failed"`. A failed connection test leaves `targets.last_status` alone.
- Unknown extra fields in the body are dropped by Zod (not rejected), so a newer container runner does not break an older Worker. Result fields kept: `sizeBytes, sha256, pgServerVersion, durationMs, partCount, dbSizeBytes, hasReadAllData`.
- `/internal` must stay mounted outside `/api/*`. The test `keeps /api routes behind Access while /internal is open` pins this.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/callback.ts`:
  ```ts
  import { and, eq, inArray, lt } from "drizzle-orm";
  import { z } from "zod";
  import { signCallback } from "../../../container/hmac";
  import { getDb } from "../db/client";
  import { backups, connectionTests, targets } from "../db/schema";
  import type { Env } from "../env";
  import { deriveJobKey } from "../lib/job-key";
  import { redactSecrets } from "../lib/redact";
  import { ApiError } from "../middleware/error";
  import { CALLBACK_WINDOW_SECONDS, MAX_CALLBACK_BODY_BYTES, type Db, type JobType } from "./types";

  const callbackSchema = z.object({
    jobId: z.string().min(1).max(64),
    event: z.enum(["started", "progress", "succeeded", "failed"]),
    at: z.string(),
    seq: z.number().int().min(1),
    result: z
      .object({
        sizeBytes: z.number().int().min(0).optional(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
        pgServerVersion: z.string().max(64).optional(),
        durationMs: z.number().int().min(0).optional(),
        partCount: z.number().int().min(0).optional(),
        dbSizeBytes: z.number().int().min(0).optional(),
        hasReadAllData: z.boolean().optional(),
      })
      .optional(),
    error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{0,39}$/), message: z.string().max(4000) }).optional(),
  });
  export type CallbackPayload = z.infer<typeof callbackSchema>;

  export interface CallbackHeaders {
    timestamp: string | undefined;
    signature: string | undefined;
  }

  export interface CallbackOutcome {
    applied: boolean;
    type: JobType;
    event: CallbackPayload["event"];
    targetId: string;
  }

  const unauthorized = () => new ApiError(401, "unauthorized", "Unauthorized");

  function safeEqual(a: string, b: string): boolean {
    const left = new TextEncoder().encode(a);
    const right = new TextEncoder().encode(b);
    let diff = left.length ^ right.length;
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
    return diff === 0;
  }

  async function verifySignature(env: Env, rawBody: string, headers: CallbackHeaders, now: Date): Promise<string> {
    const idOnly = z.object({ jobId: z.string().min(1).max(64) }).safeParse(safeJson(rawBody));
    const timestamp = headers.timestamp;
    if (!idOnly.success || !timestamp || !headers.signature || !/^\d{1,12}$/.test(timestamp)) throw unauthorized();
    const jobId = idOnly.data.jobId;

    const jobKey = await deriveJobKey(env.ENCRYPTION_KEY, jobId);
    if (!(await verifyCallbackSignature(jobKey, timestamp, jobId, rawBody, headers.signature))) throw unauthorized();
    if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > CALLBACK_WINDOW_SECONDS) throw unauthorized();
    return jobId;
  }

  export async function verifyCallbackSignature(jobKeyBase64: string, timestamp: string, jobId: string, rawBody: string, signatureHex: string): Promise<boolean> {
    return safeEqual(await signCallback(jobKeyBase64, timestamp, jobId, rawBody), signatureHex.toLowerCase());
  }

  function safeJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Verifies and applies one container callback. Order: size, signature (HMAC over `timestamp.jobId.rawBody`,
   * constant-time compare), 5 minute timestamp window, body shape, then the state change. `seq` must be higher
   * than the last applied one and terminal jobs never change, so replays and duplicates are acknowledged but ignored.
   */
  export async function handleCallback(env: Env, rawBody: string, headers: CallbackHeaders, now: Date): Promise<CallbackOutcome> {
    if (rawBody.length > MAX_CALLBACK_BODY_BYTES) throw new ApiError(413, "payload_too_large", "Callback body is too large");
    await verifySignature(env, rawBody, headers, now);

    const parsed = callbackSchema.safeParse(safeJson(rawBody));
    if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid callback body");
    const payload = parsed.data;
    if (payload.event === "failed" && !payload.error) throw new ApiError(400, "validation_error", "A failed event needs an error");
    if (payload.event === "succeeded" && !payload.result) throw new ApiError(400, "validation_error", "A succeeded event needs a result");

    const db = getDb(env);
    const nowIso = now.toISOString();
    const [backup] = await db.select({ targetId: backups.targetId }).from(backups).where(eq(backups.id, payload.jobId)).limit(1);
    if (backup) {
      const applied = await applyBackupEvent(db, payload, nowIso);
      return { applied, type: "backup", event: payload.event, targetId: backup.targetId };
    }
    const [test] = await db
      .select({ targetId: connectionTests.targetId })
      .from(connectionTests)
      .where(eq(connectionTests.id, payload.jobId))
      .limit(1);
    if (test) {
      const applied = await applyTestEvent(db, payload, nowIso);
      return { applied, type: "test", event: payload.event, targetId: test.targetId };
    }
    throw new ApiError(404, "not_found", "Unknown job");
  }

  function errorFields(payload: CallbackPayload): { errorCode: string | null; errorMessage: string | null } {
    if (!payload.error) return { errorCode: null, errorMessage: null };
    return { errorCode: payload.error.code, errorMessage: redactSecrets(payload.error.message).slice(0, 1000) };
  }

  async function applyBackupEvent(db: Db, payload: CallbackPayload, nowIso: string): Promise<boolean> {
    const open = and(
      eq(backups.id, payload.jobId),
      inArray(backups.status, ["queued", "running"]),
      lt(backups.lastSeq, payload.seq),
    );
    const common = { lastSeq: payload.seq, heartbeatAt: nowIso };
    const result = payload.result;

    let rows: { targetId: string }[];
    if (payload.event === "succeeded") {
      rows = await db
        .update(backups)
        .set({
          ...common,
          status: "success",
          finishedAt: nowIso,
          sizeBytes: result?.sizeBytes ?? null,
          sha256: result?.sha256 ?? null,
          pgVersionServer: result?.pgServerVersion ?? null,
          durationMs: result?.durationMs ?? null,
        })
        .where(open)
        .returning({ targetId: backups.targetId });
    } else if (payload.event === "failed") {
      rows = await db
        .update(backups)
        .set({ ...common, status: "failed", finishedAt: nowIso, durationMs: result?.durationMs ?? null, ...errorFields(payload) })
        .where(open)
        .returning({ targetId: backups.targetId });
    } else {
      rows = await db.update(backups).set(common).where(open).returning({ targetId: backups.targetId });
    }

    const [row] = rows;
    if (!row) return false;
    if (payload.event === "succeeded") {
      await db.update(targets).set({ lastBackupAt: nowIso, lastStatus: "success" }).where(eq(targets.id, row.targetId));
    } else if (payload.event === "failed") {
      await db.update(targets).set({ lastStatus: "failed" }).where(eq(targets.id, row.targetId));
    }
    return true;
  }

  async function applyTestEvent(db: Db, payload: CallbackPayload, nowIso: string): Promise<boolean> {
    const open = and(
      eq(connectionTests.id, payload.jobId),
      inArray(connectionTests.status, ["queued", "running"]),
      lt(connectionTests.lastSeq, payload.seq),
    );
    const common = { lastSeq: payload.seq, heartbeatAt: nowIso };

    let rows: { id: string }[];
    if (payload.event === "succeeded") {
      rows = await db
        .update(connectionTests)
        .set({ ...common, status: "success", finishedAt: nowIso, resultJson: redactSecrets(JSON.stringify(payload.result ?? {})) })
        .where(open)
        .returning({ id: connectionTests.id });
    } else if (payload.event === "failed") {
      rows = await db
        .update(connectionTests)
        .set({ ...common, status: "failed", finishedAt: nowIso, ...errorFields(payload) })
        .where(open)
        .returning({ id: connectionTests.id });
    } else {
      rows = await db.update(connectionTests).set(common).where(open).returning({ id: connectionTests.id });
    }
    return rows.length > 0;
  }
  ```
- [ ] Step 2: Create `src/worker/routes/internal.ts`:
  ```ts
  import { Hono } from "hono";
  import type { Env } from "../env";
  import { handleCallback } from "../jobs/callback";

  /** Mounted at `/internal`, outside `/api/*`, so the Access middleware does not apply. HMAC is the only gate. */
  export const internal = new Hono<{ Bindings: Env }>();

  internal.post("/jobs/callback", async (c) => {
    const outcome = await handleCallback(
      c.env,
      await c.req.text(),
      { timestamp: c.req.header("X-Cellar-Timestamp"), signature: c.req.header("X-Cellar-Signature") },
      new Date(),
    );
    return c.json({ ok: true, applied: outcome.applied });
  });
  ```
- [ ] Step 3: Edit `src/worker/app.ts`: add the import and the route line (after the `/api/settings` line):
  ```ts
  import { internal } from "./routes/internal";
  // ...
  app.route("/internal", internal);
  ```
- [ ] Step 4: Create `test/worker/jobs/callback.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { eq } from "drizzle-orm";
  import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import { handleCallback, verifyCallbackSignature } from "../../../src/worker/jobs/callback";
  import { app } from "../../../src/worker/app";
  import { SIGNATURE_VECTOR } from "../../../container/contract";
  import { createTestEnv } from "../../helpers/env";
  import { insertBackup, insertTarget, insertTest, NOW, signedHeaders } from "./fixtures";

  let env: Env;
  let dispose: () => Promise<void>;

  beforeEach(async () => {
    const created = await createTestEnv();
    env = created.env;
    dispose = created.dispose;
    await insertTarget(env, "t1");
    await insertBackup(env, "b1", "t1", { status: "running", startedAt: NOW.toISOString(), heartbeatAt: NOW.toISOString() });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await dispose();
  });

  const SHA = "a".repeat(64);
  const event = (jobId: string, name: string, seq: number, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ jobId, event: name, at: NOW.toISOString(), seq, ...extra });
  const backupRow = async (id = "b1") => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
  const targetRow = async () => (await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0];

  async function post(rawBody: string, headers?: { timestamp?: string; signature?: string }, now = NOW) {
    const signed = await signedHeaders(env, JSON.parse(rawBody).jobId, rawBody, now.getTime() / 1000);
    return handleCallback(env, rawBody, { ...signed, ...headers }, now);
  }
  const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { status?: number }) => error.status);

  describe("handleCallback - authentication", () => {
    it("rejects a bad signature with 401 and changes nothing", async () => {
      const body = event("b1", "succeeded", 1, { result: { sizeBytes: 5, sha256: SHA } });
      expect(await status(post(body, { signature: "0".repeat(64) }))).toBe(401);
      expect((await backupRow())?.status).toBe("running");
    });

    it("rejects a signature made for another job id", async () => {
      await insertBackup(env, "b2", "t1", { status: "success" });
      const body = event("b1", "progress", 1);
      const other = await signedHeaders(env, "b2", body);
      expect(await status(handleCallback(env, body, other, NOW))).toBe(401);
    });

    it("rejects a body that was changed after signing", async () => {
      const body = event("b1", "progress", 1);
      const signed = await signedHeaders(env, "b1", body);
      expect(await status(handleCallback(env, event("b1", "failed", 1, { error: { code: "UNKNOWN", message: "x" } }), signed, NOW))).toBe(401);
    });

    it("rejects missing headers, a non-numeric timestamp, and a non-JSON body", async () => {
      const body = event("b1", "progress", 1);
      expect(await status(handleCallback(env, body, { timestamp: undefined, signature: undefined }, NOW))).toBe(401);
      expect(await status(post(body, { timestamp: "abc" }))).toBe(401);
      expect(await status(handleCallback(env, "not json", { timestamp: "1", signature: "x" }, NOW))).toBe(401);
    });

    it("rejects a validly signed callback older than 5 minutes (replay) and one from the far future", async () => {
      const body = event("b1", "progress", 1);
      const old = await signedHeaders(env, "b1", body, NOW.getTime() / 1000 - 301);
      expect(await status(handleCallback(env, body, old, NOW))).toBe(401);
      const future = await signedHeaders(env, "b1", body, NOW.getTime() / 1000 + 301);
      expect(await status(handleCallback(env, body, future, NOW))).toBe(401);
      const edge = await signedHeaders(env, "b1", body, NOW.getTime() / 1000 - 299);
      expect(await status(handleCallback(env, body, edge, NOW))).toBe(200);
    });

    it("rejects an oversized body with 413", async () => {
      const body = event("b1", "progress", 1, { pad: "x".repeat(70_000) });
      expect(await status(post(body))).toBe(413);
    });

    it("returns 404 for a validly signed callback about an unknown job", async () => {
      expect(await status(post(event("ghost", "progress", 1)))).toBe(404);
    });

    it("returns 400 for a signed body that does not match the schema", async () => {
      expect(await status(post(event("b1", "bogus", 1)))).toBe(400);
      expect(await status(post(event("b1", "failed", 1)))).toBe(400);
      expect(await status(post(event("b1", "succeeded", 1)))).toBe(400);
      expect(await status(post(event("b1", "progress", 0)))).toBe(400);
    });
  });

  describe("handleCallback - backup state changes", () => {
    it("applies a valid success: row, target last_backup_at and last_status", async () => {
      const outcome = await post(
        event("b1", "succeeded", 3, {
          result: { sizeBytes: 123456, sha256: SHA, pgServerVersion: "16.3", durationMs: 4200, partCount: 1 },
        }),
      );
      expect(outcome).toEqual({ applied: true, type: "backup", event: "succeeded", targetId: "t1" });
      expect(await backupRow()).toMatchObject({
        status: "success",
        sizeBytes: 123456,
        sha256: SHA,
        pgVersionServer: "16.3",
        durationMs: 4200,
        finishedAt: NOW.toISOString(),
        lastSeq: 3,
      });
      expect(await targetRow()).toMatchObject({ lastBackupAt: NOW.toISOString(), lastStatus: "success" });
    });

    it("applies a failure with a redacted, capped message", async () => {
      await post(
        event("b1", "failed", 2, { error: { code: "DUMP_FAILED", message: "connection to postgres://app:hunter2@db:5432/shop failed " + "y".repeat(2000) } }),
      );
      const row = await backupRow();
      expect(row).toMatchObject({ status: "failed", errorCode: "DUMP_FAILED" });
      expect(row?.errorMessage).toContain("postgres://app:***@db:5432/shop");
      expect(row?.errorMessage).not.toContain("hunter2");
      expect(row?.errorMessage?.length).toBeLessThanOrEqual(1000);
      expect((await targetRow())?.lastStatus).toBe("failed");
    });

    it("refreshes the heartbeat on started and progress without changing the status", async () => {
      const later = new Date(NOW.getTime() + 60_000);
      await post(event("b1", "progress", 1), undefined, later);
      expect(await backupRow()).toMatchObject({ status: "running", heartbeatAt: later.toISOString(), lastSeq: 1 });
      await post(event("b1", "started", 2), undefined, later);
      expect((await backupRow())?.lastSeq).toBe(2);
    });

    it("ignores a repeated or lower seq (replay protection)", async () => {
      await post(event("b1", "progress", 5));
      const stale = await post(event("b1", "progress", 5));
      const lower = await post(event("b1", "failed", 4, { error: { code: "UNKNOWN", message: "late" } }));
      expect(stale.applied).toBe(false);
      expect(lower.applied).toBe(false);
      expect(await backupRow()).toMatchObject({ status: "running", lastSeq: 5 });
    });

    it("applies a terminal event once and ignores later events", async () => {
      await post(event("b1", "succeeded", 2, { result: { sizeBytes: 1, sha256: SHA } }));
      const again = await post(event("b1", "succeeded", 3, { result: { sizeBytes: 999, sha256: SHA } }));
      const failedLate = await post(event("b1", "failed", 4, { error: { code: "UNKNOWN", message: "late" } }));
      expect([again.applied, failedLate.applied]).toEqual([false, false]);
      expect(await backupRow()).toMatchObject({ status: "success", sizeBytes: 1 });
      expect((await targetRow())?.lastStatus).toBe("success");
    });

    it("does not revive a timed_out job", async () => {
      await getDb(env).update(backups).set({ status: "timed_out" }).where(eq(backups.id, "b1"));
      const outcome = await post(event("b1", "succeeded", 1, { result: { sizeBytes: 1, sha256: SHA } }));
      expect(outcome.applied).toBe(false);
      expect((await backupRow())?.status).toBe("timed_out");
    });
  });

  describe("handleCallback - connection tests", () => {
    beforeEach(async () => {
      await insertTest(env, "c1", "t1", { status: "running" });
    });
    const testRow = async () => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, "c1")))[0];

    it("stores the result of a successful test", async () => {
      const outcome = await post(event("c1", "succeeded", 1, { result: { pgServerVersion: "16.3", dbSizeBytes: 8192, hasReadAllData: true } }));
      expect(outcome).toMatchObject({ applied: true, type: "test", targetId: "t1" });
      expect(await testRow()).toMatchObject({ status: "success" });
      expect(JSON.parse((await testRow())?.resultJson ?? "{}")).toEqual({ pgServerVersion: "16.3", dbSizeBytes: 8192, hasReadAllData: true });
    });

    it("stores a redacted failure and leaves the target status alone", async () => {
      await post(event("c1", "failed", 1, { error: { code: "AUTH_FAILED", message: "password=hunter2 rejected" } }));
      const row = await testRow();
      expect(row).toMatchObject({ status: "failed", errorCode: "AUTH_FAILED" });
      expect(row?.errorMessage).not.toContain("hunter2");
      expect((await targetRow())?.lastStatus).toBeNull();
    });
  });

  describe("POST /internal/jobs/callback", () => {
    it("is reachable without an Access token and returns the applied flag", async () => {
      const prod = { ...env, DEV_BYPASS: "" } as Env;
      const body = event("b1", "progress", 1);
      const signed = await signedHeaders(env, "b1", body, Date.now() / 1000);
      const response = await app.request(
        "http://localhost/internal/jobs/callback",
        { method: "POST", body, headers: { "X-Cellar-Timestamp": signed.timestamp, "X-Cellar-Signature": signed.signature } },
        prod,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, applied: true });
    });

    it("answers 401 with the generic error body for a bad signature", async () => {
      const response = await app.request("http://localhost/internal/jobs/callback", { method: "POST", body: event("b1", "progress", 1), headers: { "X-Cellar-Timestamp": "1", "X-Cellar-Signature": "00" } }, env);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Unauthorized" } });
    });

    it("keeps /api routes behind Access while /internal is open", async () => {
      const prod = { ...env, DEV_BYPASS: "" } as Env;
      expect((await app.request("http://localhost/api/targets/t1/backups", {}, prod)).status).toBe(401);
    });
  });

  describe("Phase 4 contract", () => {
    it("verifies SIGNATURE_VECTOR with the Worker-side verifier and rejects a changed body", async () => {
      const { jobKeyBase64, timestamp, jobId, rawBody, signatureHex } = SIGNATURE_VECTOR;
      expect(await verifyCallbackSignature(jobKeyBase64, timestamp, jobId, rawBody, signatureHex)).toBe(true);
      expect(await verifyCallbackSignature(jobKeyBase64, timestamp, jobId, `${rawBody} `, signatureHex)).toBe(false);
    });
  });
  ```
- [ ] Step 5: Verify - Run: `bunx vitest run test/worker/jobs/callback.test.ts && bun run typecheck` - Expected: 20 pass, 0 fail; typecheck exit 0. Covers: bad signature 401, signature for another job 401, tampered body 401, missing or malformed headers 401, replay older than 5 minutes 401 (and 299 seconds accepted), oversized body 413, unknown job 404, schema errors 400, valid success updates row and target, redacted failure, heartbeat, `seq` replay ignored, terminal applied once, `timed_out` not revived, connection test result stored, route reachable without Access.
- [ ] Step 6: Negative controls (run in scratch; repeat once here): (a) delete the line `if (!(await verifyCallbackSignature(jobKey, timestamp, jobId, rawBody, headers.signature))) throw unauthorized();` - Expected: 3 tests FAIL (`rejects a bad signature ...`, `rejects a signature made for another job id`, `rejects a body that was changed after signing`); (b) delete the line `lt(backups.lastSeq, payload.seq),` - Expected: `ignores a repeated or lower seq` FAILS; (c) change `> CALLBACK_WINDOW_SECONDS)` to `> CALLBACK_WINDOW_SECONDS * 1000)` - Expected: the replay-window test FAILS. Restore each line and re-run - Expected: 20 pass
- [ ] Step 7: Commit - `git add src/worker/jobs/callback.ts src/worker/routes/internal.ts src/worker/app.ts test/worker/jobs/callback.test.ts && git commit -m "feat: add HMAC-verified job callback endpoint outside Access"`

---
### Task 9: Stale sweeper and cron handler

**Files:**
- Create: `src/worker/jobs/sweeper.ts`, `src/worker/jobs/cron.ts`
- Test: `test/worker/jobs/sweeper.test.ts`

**Interfaces:**
- Consumes: Task 6 `enqueueDueBackups`; Task 7 `stopJob(env: Env, jobId: string): Promise<void>`; Task 3 constants; tables; Task 6 fixtures; `redactError` (Phase 1).
- Produces:
  - `sweepStaleJobs(env: Env, now: Date, stop: (jobId: string) => Promise<void>): Promise<SweepResult>` with `SweepResult = { timedOut: string[]; queueTimedOut: string[] }`.
  - `runCronTick(env: Env, now: Date): Promise<void>` - runs `enqueueDueBackups`, then `sweepStaleJobs` (with `stopJob`); each step in its own try/catch. **Phase 6 appends the daily retention step to the `steps` array in `cron.ts`; Phase 7 extends the sweeper with `restores`; Phase 8 reads `SweepResult` to alert.**

**Gotcha:**
- The deadline check wins over the heartbeat check, so `error_code` tells the operator why: `DEADLINE_EXCEEDED` or `HEARTBEAT_LOST`. A running row with no `heartbeat_at` uses `started_at`.
- Every state change is a conditional update (`WHERE status = 'running'` or `'queued'`), so the sweeper cannot overwrite a callback that landed a moment earlier, and a late callback cannot revive a `timed_out` row (Task 8 guards that).
- `stop` runs after the row change and is best effort (`stopJob` swallows errors).
- Finished `connection_tests` older than 7 days are deleted in the same pass. This is the only delete in the phase and it touches only the short-lived test rows (no backups, no R2).
- At most 200 running rows per table are inspected per tick.
- `runCronTick` logs only the step name and `redactError(error)`.

**Steps:**
- [ ] Step 1: Create `src/worker/jobs/sweeper.ts`:
  ```ts
  import { and, eq, inArray, lt, lte } from "drizzle-orm";
  import { getDb } from "../db/client";
  import { backups, connectionTests, targets } from "../db/schema";
  import type { Env } from "../env";
  import {
    CONNECTION_TEST_RETENTION_MS,
    HEARTBEAT_TIMEOUT_MS,
    QUEUE_TIMEOUT_MS,
    TEST_DEADLINE_MINUTES,
  } from "./types";

  export interface SweepResult {
    timedOut: string[];
    queueTimedOut: string[];
  }

  interface RunningRow {
    id: string;
    startedAt: string | null;
    heartbeatAt: string | null;
    deadlineMinutes: number;
  }

  /** Why a running job must be timed out, or null when it is healthy. The deadline wins over a lost heartbeat. */
  function timeoutReason(row: RunningRow, nowMs: number): "DEADLINE_EXCEEDED" | "HEARTBEAT_LOST" | null {
    const startedMs = row.startedAt ? Date.parse(row.startedAt) : nowMs;
    if (startedMs + row.deadlineMinutes * 60_000 <= nowMs) return "DEADLINE_EXCEEDED";
    const heartbeatMs = row.heartbeatAt ? Date.parse(row.heartbeatAt) : startedMs;
    if (nowMs - heartbeatMs >= HEARTBEAT_TIMEOUT_MS) return "HEARTBEAT_LOST";
    return null;
  }

  /**
   * Cron step 2. Running jobs without a heartbeat for 5 minutes or past their deadline become `timed_out`
   * (and their container is stopped). Jobs `queued` for more than 1 hour become `failed` with `queue_timeout`.
   * Finished connection tests older than 7 days are deleted. Applies to `backups` and `connection_tests`.
   */
  export async function sweepStaleJobs(env: Env, now: Date, stop: (jobId: string) => Promise<void>): Promise<SweepResult> {
    const db = getDb(env);
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const result: SweepResult = { timedOut: [], queueTimedOut: [] };

    const runningBackups = await db
      .select({ id: backups.id, targetId: backups.targetId, startedAt: backups.startedAt, heartbeatAt: backups.heartbeatAt, deadlineMinutes: targets.jobDeadlineMinutes })
      .from(backups)
      .innerJoin(targets, eq(backups.targetId, targets.id))
      .where(eq(backups.status, "running"))
      .limit(200);
    for (const row of runningBackups) {
      const reason = timeoutReason(row, nowMs);
      if (!reason) continue;
      const changed = await db
        .update(backups)
        .set({ status: "timed_out", errorCode: reason, errorMessage: "The job stopped reporting progress or passed its deadline", finishedAt: nowIso })
        .where(and(eq(backups.id, row.id), eq(backups.status, "running")))
        .returning({ id: backups.id });
      if (changed.length === 0) continue;
      await db.update(targets).set({ lastStatus: "timed_out" }).where(eq(targets.id, row.targetId));
      result.timedOut.push(row.id);
      await stop(row.id);
    }

    const runningTests = await db
      .select({ id: connectionTests.id, startedAt: connectionTests.startedAt, heartbeatAt: connectionTests.heartbeatAt })
      .from(connectionTests)
      .where(eq(connectionTests.status, "running"))
      .limit(200);
    for (const row of runningTests) {
      const reason = timeoutReason({ ...row, deadlineMinutes: TEST_DEADLINE_MINUTES }, nowMs);
      if (!reason) continue;
      const changed = await db
        .update(connectionTests)
        .set({ status: "timed_out", errorCode: reason, errorMessage: "The test stopped reporting progress or passed its deadline", finishedAt: nowIso })
        .where(and(eq(connectionTests.id, row.id), eq(connectionTests.status, "running")))
        .returning({ id: connectionTests.id });
      if (changed.length === 0) continue;
      result.timedOut.push(row.id);
      await stop(row.id);
    }

    const queueCutoff = new Date(nowMs - QUEUE_TIMEOUT_MS).toISOString();
    const queueFailure = { status: "failed" as const, errorCode: "queue_timeout", errorMessage: "The job waited more than 1 hour in the queue", finishedAt: nowIso };
    const staleBackups = await db
      .update(backups)
      .set(queueFailure)
      .where(and(eq(backups.status, "queued"), lte(backups.queuedAt, queueCutoff)))
      .returning({ id: backups.id, targetId: backups.targetId });
    for (const row of staleBackups) {
      await db.update(targets).set({ lastStatus: "failed" }).where(eq(targets.id, row.targetId));
      result.queueTimedOut.push(row.id);
    }
    const staleTests = await db
      .update(connectionTests)
      .set(queueFailure)
      .where(and(eq(connectionTests.status, "queued"), lte(connectionTests.queuedAt, queueCutoff)))
      .returning({ id: connectionTests.id });
    result.queueTimedOut.push(...staleTests.map((row) => row.id));

    await db
      .delete(connectionTests)
      .where(
        and(
          inArray(connectionTests.status, ["success", "failed", "timed_out"]),
          lt(connectionTests.queuedAt, new Date(nowMs - CONNECTION_TEST_RETENTION_MS).toISOString()),
        ),
      );
    return result;
  }
  ```
- [ ] Step 2: Create `src/worker/jobs/cron.ts`:
  ```ts
  import type { Env } from "../env";
  import { redactError } from "../lib/redact";
  import { enqueueDueBackups } from "./dispatch";
  import { stopJob } from "./runner-client";
  import { sweepStaleJobs } from "./sweeper";

  /**
   * One `* * * * *` tick. Steps run in order and one failing step never blocks the next:
   * 1. enqueue due targets, 2. stale sweeper. (Phase 6 appends the daily retention run.)
   */
  export async function runCronTick(env: Env, now: Date): Promise<void> {
    const steps: [string, () => Promise<unknown>][] = [
      ["enqueue", () => enqueueDueBackups(env, now)],
      ["sweep", () => sweepStaleJobs(env, now, (jobId) => stopJob(env, jobId))],
    ];
    for (const [name, run] of steps) {
      try {
        await run();
      } catch (error) {
        console.error(`cron: ${name} failed: ${redactError(error)}`);
      }
    }
  }
  ```
- [ ] Step 3: Create `test/worker/jobs/sweeper.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { eq } from "drizzle-orm";
  import { backups, connectionTests, targets } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import { runCronTick } from "../../../src/worker/jobs/cron";
  import { sweepStaleJobs } from "../../../src/worker/jobs/sweeper";
  import { createTestEnv } from "../../helpers/env";
  import { fakeQueue, insertBackup, insertTarget, insertTest, NOW } from "./fixtures";

  let env: Env;
  let dispose: () => Promise<void>;
  let stopped: string[];
  const stop = async (id: string) => {
    stopped.push(id);
  };
  const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const backupStatus = async (id: string) => (await getDb(env).select().from(backups).where(eq(backups.id, id)))[0];
  const testStatus = async (id: string) => (await getDb(env).select().from(connectionTests).where(eq(connectionTests.id, id)))[0];

  beforeEach(async () => {
    const created = await createTestEnv({ JOBS: fakeQueue().queue });
    env = created.env;
    dispose = created.dispose;
    stopped = [];
    await insertTarget(env, "t1", { jobDeadlineMinutes: 120, nextRunAt: null });
    await insertTarget(env, "t2", { nextRunAt: null });
    await insertTarget(env, "t3", { nextRunAt: null });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await dispose();
  });

  describe("sweepStaleJobs", () => {
    it("times out running backups with no heartbeat for 5 minutes and leaves healthy ones", async () => {
      await insertBackup(env, "lost", "t1", { status: "running", startedAt: minutesAgo(30), heartbeatAt: minutesAgo(6) });
      await insertBackup(env, "healthy", "t2", { status: "running", startedAt: minutesAgo(30), heartbeatAt: minutesAgo(4) });
      const result = await sweepStaleJobs(env, NOW, stop);
      expect(result.timedOut).toEqual(["lost"]);
      expect(await backupStatus("lost")).toMatchObject({ status: "timed_out", errorCode: "HEARTBEAT_LOST", finishedAt: NOW.toISOString() });
      expect((await backupStatus("healthy"))?.status).toBe("running");
      expect(stopped).toEqual(["lost"]);
      expect((await getDb(env).select().from(targets).where(eq(targets.id, "t1")))[0]?.lastStatus).toBe("timed_out");
    });

    it("times out a backup past its deadline even when heartbeats are fresh", async () => {
      await insertBackup(env, "slow", "t1", { status: "running", startedAt: minutesAgo(121), heartbeatAt: minutesAgo(1) });
      await insertBackup(env, "ok", "t2", { status: "running", startedAt: minutesAgo(119), heartbeatAt: minutesAgo(1) });
      await sweepStaleJobs(env, NOW, stop);
      expect(await backupStatus("slow")).toMatchObject({ status: "timed_out", errorCode: "DEADLINE_EXCEEDED" });
      expect((await backupStatus("ok"))?.status).toBe("running");
    });

    it("fails backups queued for more than 1 hour with queue_timeout and leaves newer ones", async () => {
      await insertBackup(env, "old", "t1", { queuedAt: minutesAgo(61) });
      await insertBackup(env, "new", "t2", { queuedAt: minutesAgo(59) });
      const result = await sweepStaleJobs(env, NOW, stop);
      expect(result.queueTimedOut).toEqual(["old"]);
      expect(await backupStatus("old")).toMatchObject({ status: "failed", errorCode: "queue_timeout" });
      expect((await backupStatus("new"))?.status).toBe("queued");
      expect(stopped).toEqual([]);
    });

    it("never touches finished rows", async () => {
      await insertBackup(env, "done", "t1", { status: "success", startedAt: minutesAgo(500), heartbeatAt: minutesAgo(500), queuedAt: minutesAgo(500) });
      await insertBackup(env, "bad", "t2", { status: "failed", startedAt: minutesAgo(500), heartbeatAt: minutesAgo(500), queuedAt: minutesAgo(500) });
      const result = await sweepStaleJobs(env, NOW, stop);
      expect(result).toEqual({ timedOut: [], queueTimedOut: [] });
      expect((await backupStatus("done"))?.status).toBe("success");
      expect((await backupStatus("bad"))?.status).toBe("failed");
    });

    it("applies the same rules to connection tests with a 5 minute deadline", async () => {
      await insertTest(env, "slow", "t1", { status: "running", startedAt: minutesAgo(6), heartbeatAt: minutesAgo(0) });
      await insertTest(env, "fresh", "t2", { status: "running", startedAt: minutesAgo(2), heartbeatAt: minutesAgo(1) });
      await insertTest(env, "stuck", "t3", { queuedAt: minutesAgo(90) });
      await sweepStaleJobs(env, NOW, stop);
      expect(await testStatus("slow")).toMatchObject({ status: "timed_out", errorCode: "DEADLINE_EXCEEDED" });
      expect((await testStatus("fresh"))?.status).toBe("running");
      expect(await testStatus("stuck")).toMatchObject({ status: "failed", errorCode: "queue_timeout" });
    });

    it("deletes finished connection tests older than 7 days only", async () => {
      await insertTest(env, "ancient", "t1", { status: "success", queuedAt: minutesAgo(8 * 24 * 60) });
      await insertTest(env, "recent", "t2", { status: "success", queuedAt: minutesAgo(6 * 24 * 60) });
      await sweepStaleJobs(env, NOW, stop);
      expect(await testStatus("ancient")).toBeUndefined();
      expect((await testStatus("recent"))?.status).toBe("success");
    });
  });

  describe("runCronTick", () => {
    it("runs the sweeper even when the enqueue step fails", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const broken = { ...env, DB: undefined } as unknown as Env;
      await runCronTick(broken, NOW);
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual(
        expect.arrayContaining([expect.stringContaining("cron: enqueue failed"), expect.stringContaining("cron: sweep failed")]),
      );
    });

    it("enqueues a due target and sweeps in one tick", async () => {
      const fake = fakeQueue();
      const tickEnv = { ...env, JOBS: fake.queue } as Env;
      await getDb(env).update(targets).set({ nextRunAt: "2026-10-23T19:00:00.000Z" }).where(eq(targets.id, "t1"));
      await insertBackup(env, "old", "t2", { queuedAt: minutesAgo(90) });
      await runCronTick(tickEnv, NOW);
      expect(fake.sent).toHaveLength(1);
      expect((await backupStatus("old"))?.errorCode).toBe("queue_timeout");
    });
  });
  ```
- [ ] Step 4: Verify - Run: `bunx vitest run test/worker/jobs/sweeper.test.ts && bun run typecheck` - Expected: 8 pass, 0 fail; typecheck exit 0. The suite pins: only rows past 5 minutes without a heartbeat, past the deadline, or queued over 1 hour change; healthy, newer, and finished rows do not; tests use a 5 minute deadline; old finished tests are pruned; one failing step does not stop the next.
- [ ] Step 5: Commit - `git add src/worker/jobs/sweeper.ts src/worker/jobs/cron.ts test/worker/jobs/sweeper.test.ts && git commit -m "feat: add stale job sweeper and per-minute cron tick"`

---

### Task 10: Backup now, Test connection, and backup history routes

**Files:**
- Create: `src/worker/routes/target-jobs.ts`
- Modify: `src/worker/app.ts` (anchor: the `app.route("/api/settings", ...)` line)
- Test: `test/worker/routes/target-jobs.test.ts`

**Interfaces:**
- Consumes: Task 6 `queueManualBackup`, `queueConnectionTest`; Task 3 `encodeCursor`, `decodeCursor`; `writeAudit`; `parseQuery(c, schema)` (X5, assumed to return the parsed value); `AppEnv`; `ApiError`; Task 6 fixtures.
- Produces (mounted at `/api/targets`, next to Phase 2's CRUD router; all behind Access):
  - `POST /api/targets/:id/backup` -> `202 { backupId }`; audit `backup.trigger` (entity `backup`); 404 for unknown or soft-deleted target; 409 when a backup is active.
  - `POST /api/targets/:id/test` -> `202 { testId }`; 409 when a test or backup is active.
  - `GET /api/targets/:id/test/:testId` -> `{ status: "queued" | "running" | "success" | "failed" | "timed_out", result?, error?: { code, message } }`; 404 if the test belongs to another target.
  - `GET /api/targets/:id/backups?status&limit&cursor` -> `{ items: BackupItem[], nextCursor: string | null }`, newest first by `coalesce(started_at, queued_at)` then id; hides soft-deleted backups. `BackupItem = { id, targetId, status, trigger, r2Key, sizeBytes, sha256, pgVersionServer, durationMs, errorCode, errorMessage, queuedAt, startedAt, finishedAt }`.
  - `export const targetJobs: Hono<AppEnv>`.

**Gotcha:**
- Hono matches routes by method and path, so mounting `targetJobs` and Phase 2's `targets` router on the same base path is fine. Mount `targetJobs` after Phase 2's router.
- The sort key `coalesce(started_at, queued_at)` is not covered by `idx_backups_target_time`, so the query scans the target's backups. That is fine at v1 sizes (a few hundred rows per target). Revisit if a target holds thousands.
- Cursor comparison is written as `key < ? OR (key = ? AND id < ?)` instead of a row-value comparison, to stay on the plain SQLite syntax D1 documents.
- `status` is validated against the enum (400 for anything else), `limit` is 1 to 200 with default 50, and a cursor that does not decode to two strings is a 400.
- The test result is parsed from `result_json`, which the callback already redacted. Errors return `code` and `message` only.

**Steps:**
- [ ] Step 1: Create `src/worker/routes/target-jobs.ts`:
  ```ts
  import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
  import { Hono } from "hono";
  import { z } from "zod";
  import { getDb } from "../db/client";
  import { backups, connectionTests, targets } from "../db/schema";
  import { queueConnectionTest, queueManualBackup } from "../jobs/dispatch";
  import type { Db } from "../jobs/types";
  import { writeAudit } from "../lib/audit";
  import { decodeCursor, encodeCursor } from "../lib/cursor";
  import { parseQuery } from "../lib/validate";
  import type { AppEnv } from "../middleware/access";
  import { ApiError } from "../middleware/error";

  /** Mounted at `/api/targets` next to the Phase 2 CRUD routes. */
  export const targetJobs = new Hono<AppEnv>();

  async function requireTarget(db: Db, id: string): Promise<void> {
    const [target] = await db
      .select({ id: targets.id })
      .from(targets)
      .where(and(eq(targets.id, id), isNull(targets.deletedAt)))
      .limit(1);
    if (!target) throw new ApiError(404, "not_found", "Target not found");
  }

  targetJobs.post("/:id/backup", async (c) => {
    const targetId = c.req.param("id");
    await requireTarget(getDb(c.env), targetId);
    const backupId = await queueManualBackup(c.env, targetId, new Date());
    await writeAudit(getDb(c.env), {
      actor: c.get("actorEmail"),
      action: "backup.trigger",
      entityType: "backup",
      entityId: backupId,
      details: { targetId, trigger: "manual" },
    });
    return c.json({ backupId }, 202);
  });

  targetJobs.post("/:id/test", async (c) => {
    const targetId = c.req.param("id");
    await requireTarget(getDb(c.env), targetId);
    const testId = await queueConnectionTest(c.env, targetId, new Date());
    return c.json({ testId }, 202);
  });

  targetJobs.get("/:id/test/:testId", async (c) => {
    const db = getDb(c.env);
    const [row] = await db
      .select()
      .from(connectionTests)
      .where(and(eq(connectionTests.id, c.req.param("testId")), eq(connectionTests.targetId, c.req.param("id"))))
      .limit(1);
    if (!row) throw new ApiError(404, "not_found", "Connection test not found");
    return c.json({
      status: row.status,
      ...(row.resultJson ? { result: JSON.parse(row.resultJson) as unknown } : {}),
      ...(row.errorCode ? { error: { code: row.errorCode, message: row.errorMessage } } : {}),
    });
  });

  const listQuery = z.object({
    status: z.enum(["queued", "running", "success", "failed", "timed_out"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
  });

  const sortKey = sql<string>`coalesce(${backups.startedAt}, ${backups.queuedAt})`;

  targetJobs.get("/:id/backups", async (c) => {
    const db = getDb(c.env);
    const targetId = c.req.param("id");
    await requireTarget(db, targetId);
    const query = parseQuery(c, listQuery);

    let after = undefined;
    if (query.cursor) {
      const parts = decodeCursor(query.cursor);
      if (!parts || parts.length !== 2) throw new ApiError(400, "validation_error", "Invalid cursor");
      const [key = "", id = ""] = parts;
      after = or(lt(sortKey, key), and(eq(sortKey, key), lt(backups.id, id)));
    }

    const rows = await db
      .select({
        id: backups.id,
        targetId: backups.targetId,
        status: backups.status,
        trigger: backups.trigger,
        r2Key: backups.r2Key,
        sizeBytes: backups.sizeBytes,
        sha256: backups.sha256,
        pgVersionServer: backups.pgVersionServer,
        durationMs: backups.durationMs,
        errorCode: backups.errorCode,
        errorMessage: backups.errorMessage,
        queuedAt: backups.queuedAt,
        startedAt: backups.startedAt,
        finishedAt: backups.finishedAt,
        sortKey,
      })
      .from(backups)
      .where(
        and(
          eq(backups.targetId, targetId),
          isNull(backups.deletedAt),
          query.status ? eq(backups.status, query.status) : undefined,
          after,
        ),
      )
      .orderBy(desc(sortKey), desc(backups.id))
      .limit(query.limit + 1);

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > query.limit && last ? encodeCursor([last.sortKey, last.id]) : null;
    return c.json({ items: page.map(({ sortKey: _sortKey, ...item }) => item), nextCursor });
  });
  ```
- [ ] Step 2: Edit `src/worker/app.ts`: add the import and the route line directly after Phase 2's `app.route("/api/targets", ...)` line (or after the settings line if Phase 2 uses another path):
  ```ts
  import { targetJobs } from "./routes/target-jobs";
  // ...
  app.route("/api/targets", targetJobs);
  ```
- [ ] Step 3: Create `test/worker/routes/target-jobs.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { eq } from "drizzle-orm";
  import { backups, auditLogs, connectionTests } from "../../../src/worker/db/schema";
  import { getDb } from "../../../src/worker/db/client";
  import type { Env } from "../../../src/worker/env";
  import { app } from "../../../src/worker/app";
  import { createTestEnv } from "../../helpers/env";
  import { fakeQueue, insertBackup, insertTarget, insertTest, NOW } from "../jobs/fixtures";

  let env: Env;
  let sent: ReturnType<typeof fakeQueue>["sent"];
  let dispose: () => Promise<void>;

  beforeEach(async () => {
    const fake = fakeQueue();
    sent = fake.sent;
    const created = await createTestEnv({ JOBS: fake.queue });
    env = created.env;
    dispose = created.dispose;
    await insertTarget(env, "t1", { nextRunAt: null });
  });
  afterEach(async () => {
    await dispose();
  });

  const call = (path: string, init?: RequestInit) => app.request(`http://localhost/api/targets/${path}`, init, env);
  const json = async (response: Response) => (await response.json()) as Record<string, any>;
  const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

  describe("POST /api/targets/:id/backup", () => {
    it("returns 202 with the backup id, queues one message, and writes an audit row", async () => {
      const response = await call("t1/backup", { method: "POST" });
      expect(response.status).toBe(202);
      const { backupId } = await json(response);
      expect(sent).toEqual([{ jobId: backupId, type: "backup", targetId: "t1" }]);
      const audit = await getDb(env).select().from(auditLogs).where(eq(auditLogs.entityId, backupId));
      expect(audit[0]).toMatchObject({ action: "backup.trigger", actor: "dev@localhost", entityType: "backup" });
    });

    it("returns 409 when a backup is already queued or running, and 404 for unknown or deleted targets", async () => {
      await call("t1/backup", { method: "POST" });
      const second = await call("t1/backup", { method: "POST" });
      expect(second.status).toBe(409);
      expect((await json(second)).error.code).toBe("conflict");
      expect((await call("nope/backup", { method: "POST" })).status).toBe(404);
      await insertTarget(env, "gone", { deletedAt: NOW.toISOString(), nextRunAt: null });
      expect((await call("gone/backup", { method: "POST" })).status).toBe(404);
    });
  });

  describe("test connection routes", () => {
    it("returns 202 with a test id, then reports queued, success with result, and failure with error", async () => {
      const created = await call("t1/test", { method: "POST" });
      expect(created.status).toBe(202);
      const { testId } = await json(created);
      expect(await json(await call(`t1/test/${testId}`))).toEqual({ status: "queued" });

      await getDb(env).update(connectionTests).set({ status: "success", resultJson: JSON.stringify({ pgServerVersion: "16.3", hasReadAllData: true }) });
      expect(await json(await call(`t1/test/${testId}`))).toEqual({ status: "success", result: { pgServerVersion: "16.3", hasReadAllData: true } });

      await getDb(env).update(connectionTests).set({ status: "failed", resultJson: null, errorCode: "AUTH_FAILED", errorMessage: "denied" });
      expect(await json(await call(`t1/test/${testId}`))).toEqual({ status: "failed", error: { code: "AUTH_FAILED", message: "denied" } });
    });

    it("returns 409 while a backup runs and 404 for a test of another target", async () => {
      await insertBackup(env, "b1", "t1", { status: "running" });
      expect((await call("t1/test", { method: "POST" })).status).toBe(409);
      await insertTarget(env, "t2", { nextRunAt: null });
      await insertTest(env, "c9", "t2", { status: "success" });
      expect((await call("t1/test/c9")).status).toBe(404);
    });
  });

  describe("GET /api/targets/:id/backups", () => {
    beforeEach(async () => {
      await insertBackup(env, "b-old", "t1", { status: "success", queuedAt: minutes(-30), startedAt: minutes(-29) });
      await insertBackup(env, "b-mid", "t1", { status: "failed", queuedAt: minutes(-20), startedAt: minutes(-19) });
      await insertBackup(env, "b-new", "t1", { status: "success", queuedAt: minutes(-10), startedAt: minutes(-9) });
      await insertBackup(env, "b-queued", "t1", { status: "queued", queuedAt: minutes(-1) });
      await insertBackup(env, "b-deleted", "t1", { status: "success", queuedAt: minutes(-5), startedAt: minutes(-4), deletedAt: minutes(0) });
      await insertTarget(env, "t2", { nextRunAt: null });
      await insertBackup(env, "other-target", "t2", { status: "success" });
    });
    const ids = (body: Record<string, any>) => (body.items as { id: string }[]).map((item) => item.id);

    it("lists newest first, falling back to queued_at, without deleted rows or other targets", async () => {
      const body = await json(await call("t1/backups"));
      expect(ids(body)).toEqual(["b-queued", "b-new", "b-mid", "b-old"]);
      expect(body.nextCursor).toBeNull();
    });

    it("pages with an opaque cursor without gaps or repeats", async () => {
      const first = await json(await call("t1/backups?limit=3"));
      expect(ids(first)).toEqual(["b-queued", "b-new", "b-mid"]);
      expect(typeof first.nextCursor).toBe("string");
      const second = await json(await call(`t1/backups?limit=3&cursor=${first.nextCursor}`));
      expect(ids(second)).toEqual(["b-old"]);
      expect(second.nextCursor).toBeNull();
    });

    it("filters by status and exposes no internal columns", async () => {
      const body = await json(await call("t1/backups?status=success"));
      expect(ids(body)).toEqual(["b-new", "b-old"]);
      expect(Object.keys(body.items[0]).sort()).toEqual(
        ["durationMs", "errorCode", "errorMessage", "finishedAt", "id", "pgVersionServer", "queuedAt", "r2Key", "sha256", "sizeBytes", "startedAt", "status", "targetId", "trigger"].sort(),
      );
    });

    it("rejects a bad status, limit, or cursor with 400 and an unknown target with 404", async () => {
      expect((await call("t1/backups?status=bogus")).status).toBe(400);
      expect((await call("t1/backups?limit=500")).status).toBe(400);
      expect((await call("t1/backups?cursor=!!!")).status).toBe(400);
      expect((await call("nope/backups")).status).toBe(404);
    });
  });
  ```
- [ ] Step 4: Verify - Run: `bunx vitest run test/worker/routes/target-jobs.test.ts && bun run typecheck` - Expected: 8 pass, 0 fail; typecheck exit 0
- [ ] Step 5: Commit - `git add src/worker/routes/target-jobs.ts src/worker/app.ts test/worker/routes/target-jobs.test.ts && git commit -m "feat: add Backup now, Test connection, and backup history routes"`

---
### Task 11: Wire `scheduled` and `queue` into the Worker entry

**Files:**
- Modify: `src/worker/index.ts` (anchor: `export default`; keep the re-export line Task 5 added)

**Interfaces:**
- Consumes: Task 9 `runCronTick(env: Env, now: Date): Promise<void>`; Task 7 `handleJobMessage(env, message, deps)` and `startJob(env: Env, payload: JobPayload): Promise<void>`; `app.fetch`.
- Produces: the Worker default export `{ fetch, scheduled, queue }`. Wrangler calls `scheduled` once per minute (cron `* * * * *`) and `queue` with a batch of one message.

**Gotcha:**
- `scheduled` awaits the whole tick. The run uses `controller.scheduledTime` as `now`, so the slot math follows the cron's nominal minute.
- `queue` handles messages one by one; with `max_batch_size: 1` there is exactly one. `handleJobMessage` decides ack or retry itself, so the handler must not call `batch.retryAll()` or `ackAll()`.
- Tests do not import `index.ts` (it re-exports the Durable Object file, which imports `cloudflare:workers`, unavailable in plain Node). All logic lives in modules the tests import; this file is glue and is covered by the end-to-end section.
- If Phase 2 or 4 added other members to the default export, keep them.

**Steps:**
- [ ] Step 1: Replace the `export default` in `src/worker/index.ts` so the whole file reads (imports at the top, the re-export from Task 5 kept):
  ```ts
  import { app } from "./app";
  import type { Env } from "./env";
  import { handleJobMessage } from "./jobs/consumer";
  import { runCronTick } from "./jobs/cron";
  import { startJob } from "./jobs/runner-client";
  import type { JobMessage } from "./jobs/types";

  export { CallbackEntrypoint, JobRunner } from "./container/job-runner";

  export default {
    fetch: app.fetch,

    async scheduled(controller, env) {
      await runCronTick(env, new Date(controller.scheduledTime));
    },

    async queue(batch, env) {
      for (const message of batch.messages) {
        await handleJobMessage(env, message, { startJob: (payload) => startJob(env, payload), now: () => new Date() });
      }
    },
  } satisfies ExportedHandler<Env, JobMessage>;
  ```
- [ ] Step 2: Verify - Run: `bun run typecheck && bun run test 2>&1 | grep -v "Durable Object" | tail -8` - Expected: typecheck exit 0 (the `satisfies ExportedHandler<Env, JobMessage>` check proves the handler shapes); all tests pass, count = `BASELINE_TESTS + 85` (3 + 9 + 15 + 21 + 19 + 8 + 8), 0 failed
- [ ] Step 3: Commit - `git add src/worker/index.ts && git commit -m "feat: handle scheduled and queue events in the Worker entry"`

---

### Task 12: Update `docs/PLAN.md` and finish

**Files:**
- Modify: `docs/PLAN.md` (anchors below)

**Interfaces:**
- Consumes: the decisions in "Decisions that differ from the PRD / docs/PLAN.md" and the Spike result.
- Produces: PLAN.md consistent with the code. Task 6 of the Phase 1 plan already changed `src/` to `src/worker/` in PLAN.md section 2, so match the text as it reads now; if an old string below does not match, grep its anchor and adjust minimally.

**Steps:**
- [ ] Step 1: Section 1 "Flow summary", item 2. Old: ``2. The queue consumer creates the `backups` row (`queued`), then starts a container through the DO.`` New: ``2. The cron (or Backup now) creates the `backups` row (`queued`) and sends an ids-only queue message. The queue consumer claims the row (`running`) and starts a container through the DO.``
- [ ] Step 2: Section 2 repo structure. Replace the `jobs/` line with ``    jobs/  types.ts  state.ts  dispatch.ts  payload.ts  consumer.ts  runner-client.ts  callback.ts  sweeper.ts  cron.ts``. Replace ``    container/  job-runner.ts  (Container class)`` with ``    container/  job-runner.ts  (JobRunner Durable Object + CallbackEntrypoint, native ctx.container API)``. Add ``target-jobs.ts`` to the `routes/` line. Add ``job-key.ts  cursor.ts  settings.ts`` to the `lib/` line. Add a line ``    globals.d.ts               types ctx.exports for the JobRunner``.
- [ ] Step 3: Section 3. In `backups` add the row ``| last_seq | integer NOT NULL DEFAULT 0 | highest callback `seq` applied; replays are ignored |``. In its Indexes line add ``; unique `(target_id) WHERE status IN ('queued','running')` (`uq_backups_active_target`: one active backup per target)``. After the `restores` section add:
  - ``### connection_tests`` with the columns `id, target_id (FK), status (queued, running, success, failed, timed_out), result_json (redacted JSON), error_code, error_message, last_seq, queued_at, started_at, finished_at, heartbeat_at`, the note "short-lived: finished rows are deleted after 7 days by the sweeper", and indexes `uq_connection_tests_active_target` (unique `(target_id) WHERE status IN ('queued','running')`), `(status, heartbeat_at)`, `(queued_at)`.
  - In the `settings` keys line add ``, `max_concurrent_jobs` (default 1, 1 to 10; counts backups only)``.
- [ ] Step 4: Section 4. Replace the row for `POST /api/targets/:id/test` with two rows: ``| POST /api/targets/:id/test | - | `202 { testId }`; 409 if a backup or test is active |`` and ``| GET /api/targets/:id/test/:testId | - | `{ status: "queued"|"running"|"success"|"failed"|"timed_out", result?: { pgServerVersion, dbSizeBytes, hasReadAllData }, error?: { code, message } }` |``. In the `POST /api/targets/:id/backup` row add ``; 409 if a backup is already queued or running``. In the `GET /api/settings, PUT /api/settings` row, change the request to ``partial object, known keys only (400 otherwise); audit `settings.update` ``. In the `POST /internal/jobs/callback` row replace the second sentence with ``Reached through the JobRunner outbound intercept of `http://cellar-callback.internal` (Spike result: <OUTBOUND_OK or FALLBACK>); with FALLBACK it is the public URL with an Access bypass for this exact path.``
- [ ] Step 5: Section 5. Dispatch message: replace ``{ jobId, type: "test" | "backup" | "restore", targetId, attempt }`` with ``{ jobId, type: "test" | "backup", targetId }`` (Phase 7 adds `restore`). Replace the sentence "Passed as env vars and one JSON file or stdin, never in command-line args:" with "The JobRunner starts the container with `sleep infinity`, runs the runner with `exec`, and writes this JSON to its stdin. It is never passed in command-line args or env vars:". Replace the `jobKey` comment with ``base64 32 bytes, HMAC(HMAC(ENCRYPTION_KEY, "cellar-job-signing-v1"), jobId)``. Replace the `callbackUrl` comment with ``http://cellar-callback.internal/internal/jobs/callback, or CALLBACK_BASE_URL + /internal/jobs/callback``. In the callback `result` object add ``dbSizeBytes`` and ``hasReadAllData`` (test jobs).
- [ ] Step 6: Section 6. Change the diagram edge ``queued --> running: container "started" callback`` to ``queued --> running: consumer claim (atomic, limits checked)``. Under Rules add: "The consumer claims a job with one SQL statement that checks the row is `queued`, the global running count is below `max_concurrent_jobs`, and no job of the other type is running for the same target. A refused claim is retried every 30 seconds. The `started` callback only refreshes the heartbeat." and "Sweeper error codes: `DEADLINE_EXCEEDED`, `HEARTBEAT_LOST`, `queue_timeout`." and "A target has at most one `queued` or `running` backup and one `queued` or `running` test (partial unique indexes). Cron catch-up: after enqueuing a slot, `next_run_at` becomes the next run after the slot, or after now if that is already past; an active backup defers the slot to the next tick." and "The same rules apply to `connection_tests` (5 minute deadline). `restores` join in Phase 7."
- [ ] Step 7: Section 7, "Callback path" paragraph: append "Spike result (Phase 5): <OUTBOUND_OK or FALLBACK>, recorded <date> with wrangler <version>. The container calls `http://cellar-callback.internal`; the JobRunner registers `interceptOutboundHttp` for that host and forwards to a `CallbackEntrypoint` that calls the Hono app." Remove the word "[uncertain]" from that paragraph only if the spike passed.
- [ ] Step 8: Section 8 Queues row: append "`max_retries` is 100 (the maximum) because a claim refused by the concurrency limit is retried every 30 seconds; the sweeper fails rows queued over 1 hour."
- [ ] Step 9: Verify - Run: `grep -c "last_seq" docs/PLAN.md; grep -c "connection_tests" docs/PLAN.md; grep -c "cellar-callback.internal" docs/PLAN.md; grep -c $'\xe2\x80\x94' docs/PLAN.md` - Expected: each of the first three is 2 or more, and the last is `0`
- [ ] Step 10: Verify - Run: `bun run test && bun run typecheck` - Expected: all pass, count = `BASELINE_TESTS + 85`
- [ ] Step 11: Commit - `git add docs/PLAN.md && git commit -m "docs: align PLAN.md with phase 5 orchestration"`

---

## Failure handling summary

- **Docker is down or the container image build fails** - Detect: `docker info` fails, or `wrangler dev` logs a Docker error. Respond: STOP, report. Do not skip the spike and do not mark Task 1 done.
- **The spike callback never arrives** - Detect: Task 1 Step 10 count stays 0 after the second wait. Respond: record `FALLBACK`, set `CALLBACK_BASE_URL` for the end-to-end run, continue. The code does not change.
- **`exec` with stdin fails in the spike** - Detect: the container runs but the callback body is empty or missing. Respond: record `STDIN_FAILED`, STOP, report. The job input contract with Phase 4 needs the owner.
- **A Wrangler command mentions `remote`, asks to log in, or tries to create a resource** - Detect: output mentions `remote`, `login`, or `create`. Respond: STOP at once. Run no Wrangler command without `--local`.
- **A migration fails to apply locally** - Detect: Task 2 Step 7 errors. Respond: `rm -rf .wrangler/state/v3/d1`, re-run `bun run db:migrate:local` once; if it fails again, STOP and report the SQL error.
- **`createTestEnv` breaks after the Task 5 config change** - Detect: Task 5 Step 8 fails inside `getPlatformProxy`. Respond: bisect the new `wrangler.jsonc` blocks (containers, durable_objects, migrations) by removing one at a time, report which block breaks the helper, and STOP. Do not swap in a different test harness.
- **The same step fails 3 times** - Respond: STOP and report what was tried.

## End-to-end verification

These run on the integrated result with the Phase 4 local stack. The goal from the PRD: `bun run dev` runs a full Backup now against the Phase 4 test setup. Use a tunnel target (owner answer 1: tunnel only), the same tunnel and Access service token the owner provided for the Phase 4 tunnel spike, routed to a Phase 4 test Postgres. The tunnel hostname and token are passed by environment only and never written to a file. If the owner has not provided them, the Backup now and Test connection items below become `Verify - Human` items. No Cloudflare resource is created or changed.

- [ ] Run: `bun run test && bun run typecheck` - Expected: all pass, count = `BASELINE_TESTS + 85`; typecheck exit 0
- [ ] Manual: start the Phase 4 stack: `docker compose -f test/docker-compose.test.yml up -d` then `docker compose -f test/docker-compose.test.yml ps` - Expected: the Postgres services and RustFS are `running` (healthy). Then check the bucket: `bun -e 'const c = new Bun.S3Client({ endpoint: "http://localhost:" + process.env.RUSTFS_PORT, bucket: process.env.RUSTFS_BUCKET, accessKeyId: process.env.RUSTFS_USER, secretAccessKey: process.env.RUSTFS_PASSWORD }); console.log(await c.list({ maxKeys: 1 }))'` with those four variables exported from the compose file's values - Expected: an object is printed, no error
- [ ] Manual: create `.dev.vars` (gitignored, fake and local values only): `ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=`, `ACCESS_TEAM_DOMAIN=test.cloudflareaccess.com`, `ACCESS_AUD=test-aud`, `DEV_BYPASS=true`, `R2_ACCESS_KEY_ID=$RUSTFS_USER`, `R2_SECRET_ACCESS_KEY=$RUSTFS_PASSWORD`, `R2_ENDPOINT=http://host.docker.internal:$RUSTFS_PORT`, `R2_BUCKET=$RUSTFS_BUCKET`, and `CALLBACK_BASE_URL=` (empty when the Spike result is OUTBOUND_OK; `http://host.docker.internal:8795` when FALLBACK). Then `bun run db:migrate:local` - Expected: all migrations applied to the local database, no mention of `remote`
- [ ] Manual: start the dev server in the background: `bun run dev -- --port 8795 --test-scheduled > /tmp/cellar-dev.log 2>&1 &` and wait for `Ready on http://localhost:8795` in the log (the first run builds the image) - Expected: the ready line; the startup table lists `env.DB`, `env.JOBS`, `env.JOB_RUNNER`, `env.BACKUPS` in local mode; `curl -s localhost:8795/api/health` prints `{"ok":true,"version":"..."}` and nothing else (owner answer 2)
- [ ] Manual: create a tunnel target for a Phase 4 test database through the Phase 2 API (`POST http://localhost:8795/api/targets`; take the field names from the Phase 2 target schema in `src/shared/`; the tunnel hostname and service token id and secret come from the environment as above; the connection URL user needs read access to the sample database, and its host and port are replaced by the local end of the tunnel in the job payload). Save the returned id as `TARGET_ID` - Expected: `201`, and the response contains no password
- [ ] Manual: Test connection: `curl -s -X POST localhost:8795/api/targets/$TARGET_ID/test` then poll `curl -s localhost:8795/api/targets/$TARGET_ID/test/$TEST_ID` every 5 seconds for up to 2 minutes - Expected: `202 {"testId":...}`, then `{"status":"success","result":{"pgServerVersion":"<major of the compose service>...",...}}`
- [ ] Manual: Backup now: `curl -s -i -X POST localhost:8795/api/targets/$TARGET_ID/backup`, then immediately the same call again - Expected: first `202 {"backupId":"..."}`, second `409` with `"code":"conflict"`
- [ ] Manual: poll `curl -s localhost:8795/api/targets/$TARGET_ID/backups` every 10 seconds for up to 5 minutes - Expected: the first item reaches `"status":"success"` with `sizeBytes` greater than 0, a 64-character hex `sha256`, `pgVersionServer` set, `durationMs` greater than 0, and `r2Key` matching `backups/$TARGET_ID/YYYY/MM/DD/<ISO>_<dbname>.dump`
- [ ] Manual: check the object in RustFS with the API values: `bun -e` with `Bun.S3Client` on the `r2Key`: `(await file.stat()).size` equals the API `sizeBytes`, and the sha256 of `await file.arrayBuffer()` (`new Bun.CryptoHasher("sha256")`) equals the API `sha256` - Expected: both equal
- [ ] Manual: cron idempotency live: `bunx wrangler d1 execute cellar --local --command "UPDATE targets SET next_run_at='2020-01-01T00:00:00.000Z' WHERE id='$TARGET_ID'"`, then fire the cron twice in a row: `curl -s "localhost:8795/__scheduled?cron=*+*+*+*+*"; curl -s "localhost:8795/__scheduled?cron=*+*+*+*+*"`, then `bunx wrangler d1 execute cellar --local --json --command "SELECT count(*) AS n FROM backups WHERE target_id='$TARGET_ID' AND trigger='schedule'"` - Expected: `"n": 1`, and `next_run_at` for the target is in the future
- [ ] Manual: sweeper live: `bunx wrangler d1 execute cellar --local --command "INSERT INTO backups (id,target_id,status,trigger,queued_at,started_at,heartbeat_at) VALUES ('e2e-stale','$TARGET_ID','running','manual','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')"`, wait until no other backup of this target is running, fire the cron once, then `SELECT status, error_code FROM backups WHERE id='e2e-stale'` - Expected: `timed_out` and `DEADLINE_EXCEEDED`
- [ ] Manual: callback hardening live: `curl -s -i -X POST localhost:8795/internal/jobs/callback -H 'X-Cellar-Timestamp: 1' -H 'X-Cellar-Signature: 00' -d '{"jobId":"x"}'` - Expected: `401` and body `{"error":{"code":"unauthorized","message":"Unauthorized"}}`; and with `DEV_BYPASS` removed from `.dev.vars` (restart the server) `curl -s -i localhost:8795/api/targets/$TARGET_ID/backups` returns `401` while the callback route still answers as above
- [ ] Manual: log hygiene: `grep -c "$PG_PASSWORD" /tmp/cellar-dev.log; grep -c "$RUSTFS_PASSWORD" /tmp/cellar-dev.log` (the e2e database password and the RustFS secret) - Expected: `0` and `0`
- [ ] Manual: no leaked containers: wait 2 minutes after the last job, then `docker ps --format '{{.Names}} {{.Image}}'` - Expected: no job container remains (only the compose services)
- [ ] Manual: tear down: stop the dev server (`pkill -f "wrangler dev"`), `docker compose -f test/docker-compose.test.yml down -v`, `rm .dev.vars`, `rm -f /tmp/cellar-dev.log`, then `lsof -i :8795` and `git status --short` - Expected: no listener; clean tree (`.wrangler/` and `.dev.vars` are ignored)
- [ ] 👤 Human (not required to finish the phase): after the owner deploys, confirm in a deployed Worker that the container reaches `/internal/jobs/callback` through the outbound intercept, or that the Access bypass for the exact path `/internal/jobs/callback` is in place if the fallback was chosen, and that `/api/*` still requires a login - Expected: a deployed Backup now reaches `success` and an unauthenticated `curl` of `/api/targets` returns a login redirect or 401 - Proxy: Task 8 tests (signature, window, `seq`, Access separation) and the local end-to-end Backup now above prove everything except the real Cloudflare edge

When all boxes are ticked, end with the phase summary required by `AGENTS.md`:

- ✅ Completed: cron + queue + container binding + callback + Backup now + Test connection + history + settings + sweeper, with the files and commits per task.
- 🧪 Tests and results: `bun run test` count and `bun run typecheck` result; the live Backup now result (size, sha256 match, object found in RustFS); the cron idempotency and sweeper live results; the Spike result line.
- ⚠️ Open issues and decisions needed: whether the Phase 4 contract test still passes unchanged (Q-direct, Q-maxinst, and Q-contract are closed by round 2); the deployed confirmation of the outbound handler or the Access bypass (👤 item); `JobRunner` alarm and inactivity-timeout guards verified only locally; tunnel mode not exercised end to end here (needs the Phase 4 real-tunnel spike); the one-hour `queue_timeout` window if the enqueue step dies between insert and send; no alerts yet (Phase 8).
