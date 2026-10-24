# Phase 6: Retention Runner (R2 and D1) Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-6-retention-runner-r2-d1.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE Task 0 and report anything down.
> The code in the steps is a reference implementation. It was written against the Phase 1 plan and the decisions register, NOT against a tree, because Phases 2-5 do not exist yet. Nothing in it was run (see "What was validated").
> When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.
> If a Phase 2-5 file or export differs from what this plan says, STOP and report: the earlier phase moved.

**Goal:** Wire the pure GFS function from Phase 3 to real R2 and D1: delete expired backups (R2 first, then soft delete), after every successful backup and once a day from the cron, with a dry-run flag, a side-effect-free preview endpoint, and a manual delete endpoint.
**Architecture:** New code lives in `src/worker/retention/` (settings accessors, one shared delete routine, a planner that maps D1 rows to the Phase 3 types, the runner, and the two triggers) plus two small route files. The Phase 3 function is used unchanged. The runner and `DELETE /api/backups/:id` share one delete routine, so the order (R2, then D1, then audit) and the latest-success guard exist in exactly one place. Phase 5's callback and cron handlers get one `ctx.waitUntil(...)` line each.
**Tech Stack:** Hono, Drizzle ORM (D1), Zod, Vitest with `getPlatformProxy` local D1/R2 (register X4), Bun. No new dependency.
**Spec:** `docs/plans/prds/phase-6.md`, resolved by `docs/plans/2026-10-24-phases-2-10-decisions.md` (section "Phase 6", plus X1-X18, and "Owner answers, round 2" which wins on conflict: answers 15 to 18 touch this phase, answers 1 and 5 change the schema it seeds), `docs/PLAN.md` sections 3, 4, 6, 8.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`), the commit this plan was written on. The tree at that commit has no code. At execution time HEAD will be the tip of the Phase 5 work, so run `git log --oneline 5f7ddc8..HEAD` if an anchor does not match.
**Confidence:** 5/10. Derived with the rubric: start 10; -2 once because every anchor is in a file that does not exist yet (register X18); -1 for the Consumes entry "Phase 5 callback success site" (no signature exists yet); -1 for the Consumes entry "Phase 5 settings PUT allowlist" (no signature exists yet); -1 for `parseBody(c, schema)` (the register gives no return type, assumed `Promise<T>`). No Human verifies, no NOT-building cut rests on a codebase claim, no schema or inferred-type change (no migration), no parallel tracks. Below 7, so execution is single-track sequential.
**NOT building:**
- Any change to the Phase 3 function or its types (PRD: if it needs a change, stop and ask).
- Any schema change or migration. `backups.deleted_at`, `backups.deleted_reason`, and the `settings` table already exist from Phase 1.
- A `deleted` value for `backups.status`. Evidence: the Phase 1 plan defines the enum as `queued, running, success, failed, timed_out` (Task 4, `backups` table) and the register says to keep `status` as the job outcome.
- Retention for soft-deleted targets (their R2 data is kept, AGENTS.md "no purge in v1").
- Alerts for retention failures (`retention_failed` is Phase 8's event list and Phase 8 does not emit it). Failures go to the audit log, the return value, and logs.
- The settings page toggle (Phase 9) and the `GET/PUT /api/settings` routes (Phase 5). This phase only extends the Phase 5 key allowlist.
- Purging audit rows, orphan-object scans, or deleting R2 objects that have no D1 row.
- README edits (Phase 10).

## Decisions that differ from the PRD / docs/PLAN.md

1. **No `deleted` status.** The PRD says "status deleted". Deletion sets `deleted_at` and `deleted_reason` and leaves `status` as the job outcome (register, Phase 6). `deleted_reason` is `retention` or `manual`. Task 11 updates `docs/PLAN.md`.
2. **Preview route.** `GET /api/targets/:id/retention-preview` replaces PLAN's `POST /api/targets/:id/retention/preview` (register). Response: `{ dryRun, keep: id[], delete: { id, startedAt, sizeBytes, reason }[], reasons }`. Phase 3 returns reasons only for kept backups, so every deletion carries the fixed `reason: "no_rule_keeps_it"`.
3. **`runRetention` takes `env`** (a Worker has no globals): `runRetention(env, targetId, opts?)`. The return value is the register's `{ deleted, failed, dryRun }` plus one extra field, `remaining` (planned deletions skipped because of the per-run cap). The daily run needs it to know whether to continue on the next tick.
4. **Daily guard key is `retention_last_run`, not `retention_last_run_date`.** Its JSON value is `{ "date": "YYYY-MM-DD", "dryRun": boolean }`. The date is the local date in the `default_timezone` setting (fallback `Asia/Bangkok`). Reason for the extra field: with the PRD default (dry run ON), a plain date guard would block the first live run until the next day after the owner turns dry run off. A dry-run day therefore does not block a later live run on the same day. The key name changed because it no longer holds only a date.
5. **Per-run cap.** At most 50 deletions per `runRetention` call and per daily tick (`MAX_DELETIONS_PER_RUN`). The day is recorded only when a tick finishes with nothing left, so the next minute's tick continues a long backlog. Failed attempts count against the cap and do not block the day from being recorded.
6. **No `IN (...)` lists exist in this design**, so the 100-bound-parameter chunking rule from the register has nothing to chunk: the planner uses one query per target, and each deletion is a single-row `UPDATE ... WHERE id = ?`. If the executor adds an `IN` list anyway, chunk it to at most 90 values (D1 limit is 100 bound parameters, `docs/research-notes.md`).
7. **Retention in dry run writes no audit rows.** The decision is logged (`console.info`, passed through `redactSecrets`). Audit rows are for real deletions.
8. **Manual delete failure.** `DELETE /api/backups/:id` writes `backup.delete` only on success. A failed R2 delete returns `502 r2_delete_failed` and writes nothing (the action list in X10 has no failure action for it).

## Closed by owner (round 2)

Owner answers of 2026-10-24 (`docs/plans/2026-10-24-phases-2-10-decisions.md`, "Owner answers, round 2") resolved every earlier ASK item. They are now requirements, not questions.

- **Answer 15: manual delete ignores `retention_dry_run`.** `DELETE /api/backups/:id` is an explicit, audited human action and always runs for real (Task 7 test "even while retention is in dry run").
- **Answer 16: manual delete accepts `success` backups only.** Other rows return `409 conflict` with `details.reason = "not_success"`.
- **Answer 17: retention skips soft-deleted targets.** Their backups and R2 objects are kept (no purge in v1).
- **Answer 18: dry run stays ON until the owner turns it off.** Reminder for the deploy: retention deletes nothing until `PUT /api/settings` sets `retention_dry_run` to `false` (or the Phase 9 Settings page does). Use `GET /api/targets/:id/retention-preview` first.

## ASK - owner confirmation needed before execution

None. No open items remain for this phase.

## Global Constraints

- TypeScript strict with `noUncheckedIndexedAccess`; Bun is the package manager; `bun run test` runs Vitest; Worker is Hono; D1 + Drizzle ORM; Zod validates every API input.
- Backups are deleted R2 object FIRST, then the D1 soft delete (`deleted_at`). The most recent successful backup of a target is NEVER deleted. (AGENTS.md "Domain rules")
- A backup is kept if ANY rule keeps it; the Phase 3 function is used unchanged.
- Retention skips soft-deleted targets. Manual delete works on `success` backups only and ignores dry run. Dry run stays on until the owner turns it off. (Owner answers 15 to 18.)
- Connection is tunnel only: the schema has no `connection_mode`, and the tunnel columns are NOT NULL (owner answers 1 and 5). Test seeds must fill them.
- Redact connection strings and passwords from logs, errors, API responses, and audit details. Never log secrets.
- All ids are text UUIDv7; all times are UTC ISO-8601 text; column names are `snake_case`.
- Audit rows for retention use `actor = "system"`; actions `retention.delete`, `retention.delete_failed`, `backup.delete` (register X10).
- Errors use `ApiError`: `{ "error": { "code", "message", "details"? } }`; validation is 400 `validation_error`, not found 404 `not_found`, conflict 409 `conflict` (register X6).
- Every route in this phase is mounted under `/api` and therefore behind Access (register X2).
- Never run `wrangler deploy`, `db:migrate:remote`, or any `--remote` command. Never create Cloudflare resources.
- Stop and ask before adding a dependency (none are needed), changing a locked decision, or any data-deleting operation outside the local test sandbox.
- If the same step fails 3 times, stop and report what you tried.
- No em dash in any file you write. Use a plain dash.
- Do not add the agent as co-author in commit messages.
- Phase end: `bun run test` and `bun run typecheck` pass, then the AGENTS.md summary (done / tests / open issues).

## Patterns to Mirror

All sources are plans, not code (the code does not exist yet). Marked "(planned, not yet in tree)".

### Naming
SOURCE: `docs/plans/2026-10-24-phase-1-foundation.md`, "Patterns to Mirror" (planned, not yet in tree): files are `kebab-case.ts`; Drizzle tables are plural `snake_case` SQL names with `camelCase` TS properties (`dbName: text("db_name")`); indexes `idx_<table>_<what>`. New files here: `delete-backup.ts`, `backup-delete.ts`, `retention-fixtures.ts`.

### Error handling
SOURCE: Phase 1 plan, Task 3 `src/worker/lib/redact.ts` (planned, not yet in tree):
```ts
export function redactError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
```
Log lines and audit details built from caught errors always go through `redactError`. API errors use `ApiError` (register X6).

### Tests
SOURCE: Phase 1 plan "Patterns to Mirror" (planned, not yet in tree): Vitest, files at `test/worker/<mirrors src/worker path>.test.ts`, Node environment, Hono apps tested with `app.request(url, init, env)`. D1 and R2 come from `createTestEnv()` (register X4, built in Phase 2 at `test/helpers/env.ts`):
```ts
let t: Awaited<ReturnType<typeof createTestEnv>>;
beforeEach(async () => { t = await createTestEnv(); });
afterEach(async () => { await t.dispose(); });
```

### Data access
SOURCE: Phase 1 plan, Task 4 `src/worker/db/schema.ts` (planned, not yet in tree). Columns used here: `backups.{id,targetId,status,r2Key,sizeBytes,queuedAt,startedAt,deletedAt,deletedReason}`, `targets.{id,timezone,keepLast,keepDaily,keepWeekly,keepMonthly,maxAgeDays,deletedAt}` (tunnel columns `tunnelHostname`, `tunnelTokenIdEnc`, `tunnelTokenSecretEnc` are NOT NULL, so `seedTarget` fills them; `alertFailureThreshold` has a default), `settings.{key,value,updatedAt}`, `auditLogs.{action,actor,entityId}`. DB client: `getDb(env)` returns `drizzle(env.DB, { schema })` (register X11).

## Phase gate

Run BEFORE Task 0. All commands run from the repo root. If any line fails, STOP and report: the earlier phase moved.

```bash
bun run test && bun run typecheck
test -f src/worker/env.ts && test -f src/worker/app.ts && test -f src/worker/index.ts \
 && test -f src/worker/db/schema.ts && test -f src/worker/db/client.ts \
 && test -f src/worker/lib/audit.ts && test -f src/worker/lib/redact.ts && test -f src/worker/lib/validate.ts \
 && test -f src/worker/middleware/access.ts && test -f src/worker/middleware/error.ts \
 && test -f src/worker/retention/gfs.ts && test -f src/worker/retention/types.ts \
 && test -f src/shared/tz.ts && test -f test/helpers/env.ts && test -f container/hmac.ts && echo GATE_FILES_OK
grep -n "export.*selectBackupsToDelete" src/worker/retention/gfs.ts
grep -n "export.*writeAudit" src/worker/lib/audit.ts
grep -n "export.*getZonedParts\|export.*isValidTimeZone" src/shared/tz.ts
grep -rn "export class ApiError" src/worker
grep -n "export.*parseBody" src/worker/lib/validate.ts
grep -rln "max_concurrent_jobs" src/worker
grep -rln "internal/jobs/callback" src/worker
grep -n "scheduled" src/worker/index.ts
```
Expected: both gate commands exit 0; `GATE_FILES_OK`; each grep prints at least one line. The Phase 3 plan (`docs/plans/2026-10-24-phase-3-gfs-retention-function.md`, "NOT building") confirms that `selectBackupsToDelete` lives in `src/worker/retention/gfs.ts`, that its types are in `src/worker/retention/types.ts`, that no barrel `index.ts` exists, and that Phase 6 imports `gfs.ts` directly. Phase 3's own test files are `gfs.test.ts`, `boundaries.test.ts`, `readme-example.test.ts`, `tz-contract.test.ts`, and `helpers.ts` in `test/worker/retention/`; none of this plan's test files reuse those names.
Record these results, they decide three import paths:
- the file that exports `ApiError` (this plan imports it from `../middleware/error`);
- the file with the `max_concurrent_jobs` allowlist (Task 8);
- the file that applies the `succeeded` callback (Task 9).

## Preflight

Every Verify in Tasks 1-11 is a local command (`bun run test`, `bun run typecheck`, `grep`). Only the end-to-end section needs infra.

### DURABLE - true until the repo itself changes

- **No migration is needed.** Evidence: Phase 1 plan Task 4 defines `backups.deleted_at`, `backups.deleted_reason`, and the `settings` table (planned, not yet in tree). Consequence: this phase never runs `db:generate`.
- **Tests use local D1 and R2 through `getPlatformProxy`, `persist: false`** (register X4), so they cannot touch real resources and need no Docker.
- **A soft-deleted row keeps its `r2_key`.** The unique index `uq_backups_r2_key` is on `r2_key` (Phase 1 plan Task 4), so an R2 key is never reused. Consequence: no conflict from soft-deleted rows.
- **D1 has no multi-statement transaction across R2.** R2-then-D1 is not atomic. Consequence: if R2 delete succeeds and the D1 update throws, the row stays `success` with a missing object until the next run repeats the idempotent R2 delete and finishes the soft delete. Task 4 tests the R2-fails direction; this direction is covered by design, noted in Task 2.

### PERISHABLE - recapture before Task 0

- **Phase 1-5 branch is checked out and green.** Check: `git status --short && git log --oneline -3 && bun run test && bun run typecheck` - Expected: clean tree, exit 0. Record the pass count as BASELINE_TESTS. Needed by: every Verify below that says "all tests pass".
- **Baseline red count.** Expected: 0 typecheck errors, 0 failing tests. If not, STOP: the Phase gate failed. Re-check with `bun run test 2>&1 | tail -5`.
- **Free port 8796** for the end-to-end dev server. Check: `lsof -i :8796` - Expected: no output. If used, pick another port and use it in every end-to-end command. Needed by: End-to-end verification only.
- **Docker running** (Phase 5's `wrangler dev` may start the container binding locally [uncertain]). Check: `docker info >/dev/null 2>&1 && echo up` - Expected: `up`. Needed by: End-to-end verification only.
- **Throwaway `.dev.vars`** with fake values and `DEV_BYPASS=true`. Check: `test -f .dev.vars && grep -c DEV_BYPASS .dev.vars` - Expected: `1`. If absent, create it from `.dev.vars.example` with fake values (never real secrets). Needed by: End-to-end verification only.
- **Local D1 migrated.** Check: `bun run db:migrate:local` - Expected: all migrations show a check mark, nothing mentions `remote`. Needed by: End-to-end verification only.
- **Migration count unchanged by this phase.** Check: `ls migrations | wc -l` before Task 0 and after Task 11 - Expected: same number. Needed by: Task 11 final check.

## Execution

**Tracks:** one track, sequential (a track below the cost floor of 3 tasks or 5 files is not worth a worktree, and every task here depends on the one before it).
**Merge order:** not applicable.
**Shared files:** `src/worker/app.ts` is edited by Tasks 6 and 7 only (sequential). `src/worker/index.ts` is edited by Task 10 only. The Phase 5 callback source file is edited by Task 9 only. The Phase 5 settings route file is edited by Task 8 only. `docs/PLAN.md` is edited by Task 11 only. `package.json`, `bun.lock`, `wrangler.jsonc`, `.dev.vars.example`, and `migrations/` are not touched.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch off the Phase 5 branch: `git switch -c phase-6-retention-runner`.
**treehouse:** installed, not needed for a single track.

---

### Task 0: Branch and commit this plan

**Files:**
- Commit only: `docs/plans/2026-10-24-phase-6-retention-runner-r2-d1.md`

**Interfaces:**
- Consumes: the Phase gate passing.
- Produces: a clean base so later diffs only show Phase 6 work.

**Steps:**
- [ ] Step 1: Run every command in "Phase gate" and the PERISHABLE checks. Any failure: STOP and report.
- [ ] Step 2: Create the branch: `git switch -c phase-6-retention-runner`
- [ ] Step 3: Commit this plan only:
      ```bash
      git add docs/plans/2026-10-24-phase-6-retention-runner-r2-d1.md
      git commit -m "docs: add phase 6 retention runner plan"
      ```
- [ ] Step 4: Verify - Run: `git status --short` - Expected: no output (clean tree)

---

### Task 1: Retention settings accessors and test fixtures

**Files:**
- Create: `src/worker/retention/config.ts`
- Create: `test/helpers/retention-fixtures.ts`
- Test: `test/worker/retention/config.test.ts`

**Interfaces:**
- Consumes (register X2, X4, X8, X9, X11; Phase 1 plan):
  - `getDb(env: Env): DrizzleD1Database<typeof schema>` from `src/worker/db/client.ts`
  - `settings` table from `src/worker/db/schema.ts`
  - `isValidTimeZone(tz: string): boolean` from `src/shared/tz.ts`
  - `uuidv7(now?: number): string` from `src/worker/lib/uuidv7.ts`
  - `createTestEnv(overrides?: Partial<Env>): Promise<{ env: Env; dispose(): Promise<void> }>` from `test/helpers/env.ts`
- Produces (all in `src/worker/retention/config.ts`):
  - `RETENTION_DRY_RUN_KEY = "retention_dry_run"`, `RETENTION_LAST_RUN_KEY = "retention_last_run"`
  - `interface RetentionLastRun { date: string; dryRun: boolean }`
  - `readSetting(env: Env, key: string): Promise<unknown>` - parsed JSON value, `undefined` when absent or not valid JSON
  - `writeSetting(env: Env, key: string, value: unknown): Promise<void>` - upsert
  - `getRetentionDryRun(env: Env): Promise<boolean>` - `false` only for a stored boolean `false`
  - `getRetentionTimezone(env: Env): Promise<string>`
  - `getLastRun(env: Env): Promise<RetentionLastRun | null>`; `setLastRun(env: Env, lastRun: RetentionLastRun): Promise<void>`
  - In `test/helpers/retention-fixtures.ts`: `NOW`, `daysAgo(n): string`, `seedTarget(env, overrides?): Promise<string>`, `seedBackup(env, targetId, startedAt, status?): Promise<{ id: string; r2Key: string }>`, `backupRow(env, id)`, `hasObject(env, key): Promise<boolean>`, `auditRows(env)`, `failingR2(env, failKeys): Env`

**Gotcha:** If Phase 5 already exports a settings reader or writer (check `grep -rn "settings" src/worker --include=*.ts -l`), delete `readSetting` and `writeSetting` from this file, import Phase 5's, and keep the typed accessors. One source of truth for reading the `settings` table. `failingR2` binds methods to the real bucket because `getPlatformProxy` bindings are proxy objects [uncertain]; if `bind` breaks `put`/`head`, wrap only `delete` and forward the rest with `Reflect.get(target, prop, target)`.

**Steps:**
- [ ] Step 1: Create `src/worker/retention/config.ts`:
      ```ts
      import { eq } from "drizzle-orm";
      import { isValidTimeZone } from "../../shared/tz";
      import { getDb } from "../db/client";
      import { settings } from "../db/schema";
      import type { Env } from "../env";

      export const RETENTION_DRY_RUN_KEY = "retention_dry_run";
      export const RETENTION_LAST_RUN_KEY = "retention_last_run";
      const DEFAULT_TIMEZONE_KEY = "default_timezone";
      const FALLBACK_TIMEZONE = "Asia/Bangkok";

      export interface RetentionLastRun {
        date: string;
        dryRun: boolean;
      }

      export async function readSetting(env: Env, key: string): Promise<unknown> {
        const row = await getDb(env)
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, key))
          .get();
        if (!row) return undefined;
        try {
          return JSON.parse(row.value) as unknown;
        } catch {
          return undefined;
        }
      }

      export async function writeSetting(env: Env, key: string, value: unknown): Promise<void> {
        const json = JSON.stringify(value);
        const updatedAt = new Date().toISOString();
        await getDb(env)
          .insert(settings)
          .values({ key, value: json, updatedAt })
          .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt } });
      }

      /** Only a stored boolean `false` turns dry run off. Anything else, including a missing row, means dry run. */
      export async function getRetentionDryRun(env: Env): Promise<boolean> {
        return (await readSetting(env, RETENTION_DRY_RUN_KEY)) !== false;
      }

      export async function getRetentionTimezone(env: Env): Promise<string> {
        const value = await readSetting(env, DEFAULT_TIMEZONE_KEY);
        return typeof value === "string" && isValidTimeZone(value) ? value : FALLBACK_TIMEZONE;
      }

      export async function getLastRun(env: Env): Promise<RetentionLastRun | null> {
        const value = await readSetting(env, RETENTION_LAST_RUN_KEY);
        if (typeof value !== "object" || value === null) return null;
        const { date, dryRun } = value as Record<string, unknown>;
        return typeof date === "string" && typeof dryRun === "boolean" ? { date, dryRun } : null;
      }

      export async function setLastRun(env: Env, lastRun: RetentionLastRun): Promise<void> {
        await writeSetting(env, RETENTION_LAST_RUN_KEY, lastRun);
      }
      ```
- [ ] Step 2: Create `test/helpers/retention-fixtures.ts`:
      ```ts
      import { eq } from "drizzle-orm";
      import { getDb } from "../../src/worker/db/client";
      import { auditLogs, backups, targets } from "../../src/worker/db/schema";
      import type { Env } from "../../src/worker/env";
      import { uuidv7 } from "../../src/worker/lib/uuidv7";

      export const NOW = new Date("2026-06-15T12:00:00.000Z");

      export const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

      /** Defaults to keep_last 2 with every other rule off, so tests state only what they exercise. */
      export async function seedTarget(
        env: Env,
        overrides: Partial<Omit<typeof targets.$inferInsert, "id">> = {},
      ): Promise<string> {
        const id = uuidv7();
        const at = NOW.toISOString();
        await getDb(env).insert(targets).values({
          id,
          name: `target-${id}`,
          dbName: "app",
          connectionUrlEnc: "v1:aa:bb",
          tunnelHostname: "db.example.com",
          tunnelTokenIdEnc: "v1:aa:bb",
          tunnelTokenSecretEnc: "v1:aa:bb",
          createdAt: at,
          updatedAt: at,
          keepLast: 2,
          keepDaily: null,
          keepWeekly: null,
          keepMonthly: null,
          maxAgeDays: null,
          ...overrides,
        });
        return id;
      }

      export interface SeededBackup {
        id: string;
        r2Key: string;
      }

      export async function seedBackup(
        env: Env,
        targetId: string,
        startedAt: string,
        status: "success" | "failed" = "success",
      ): Promise<SeededBackup> {
        const id = uuidv7();
        const r2Key = `backups/${targetId}/${id}.dump`;
        await getDb(env).insert(backups).values({
          id,
          targetId,
          status,
          trigger: "schedule",
          r2Key,
          sizeBytes: 1,
          queuedAt: startedAt,
          startedAt,
          finishedAt: startedAt,
        });
        if (status === "success") await env.BACKUPS.put(r2Key, "dump");
        return { id, r2Key };
      }

      export async function backupRow(env: Env, id: string) {
        return getDb(env).select().from(backups).where(eq(backups.id, id)).get();
      }

      export async function hasObject(env: Env, key: string): Promise<boolean> {
        return (await env.BACKUPS.head(key)) !== null;
      }

      export async function auditRows(env: Env) {
        return getDb(env)
          .select({ action: auditLogs.action, actor: auditLogs.actor, entityId: auditLogs.entityId })
          .from(auditLogs)
          .all();
      }

      /** Same bindings as `env`, but R2 `delete` throws for the given keys. */
      export function failingR2(env: Env, failKeys: ReadonlySet<string>): Env {
        const bucket = new Proxy(env.BACKUPS, {
          get(target, prop) {
            if (prop === "delete") {
              return async (key: string | string[]) => {
                if (typeof key === "string" && failKeys.has(key)) throw new Error("R2 unavailable");
                return target.delete(key);
              };
            }
            const value = Reflect.get(target, prop) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return { ...env, BACKUPS: bucket };
      }
      ```
- [ ] Step 3: Create `test/worker/retention/config.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import {
        getLastRun,
        getRetentionDryRun,
        getRetentionTimezone,
        setLastRun,
        writeSetting,
      } from "../../../src/worker/retention/config";
      import { createTestEnv } from "../../helpers/env";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      describe("retention config", () => {
        it("defaults dry run to true when the row is absent", async () => {
          expect(await getRetentionDryRun(t.env)).toBe(true);
        });

        it("turns dry run off only for a stored boolean false", async () => {
          await writeSetting(t.env, "retention_dry_run", false);
          expect(await getRetentionDryRun(t.env)).toBe(false);
          await writeSetting(t.env, "retention_dry_run", "false");
          expect(await getRetentionDryRun(t.env)).toBe(true);
        });

        it("uses default_timezone when valid and Asia/Bangkok otherwise", async () => {
          expect(await getRetentionTimezone(t.env)).toBe("Asia/Bangkok");
          await writeSetting(t.env, "default_timezone", "Europe/Berlin");
          expect(await getRetentionTimezone(t.env)).toBe("Europe/Berlin");
          await writeSetting(t.env, "default_timezone", "Not/AZone");
          expect(await getRetentionTimezone(t.env)).toBe("Asia/Bangkok");
        });

        it("round-trips the last run and treats a malformed value as no run", async () => {
          expect(await getLastRun(t.env)).toBeNull();
          await setLastRun(t.env, { date: "2026-06-15", dryRun: true });
          expect(await getLastRun(t.env)).toEqual({ date: "2026-06-15", dryRun: true });
          await writeSetting(t.env, "retention_last_run", { date: 20260615 });
          expect(await getLastRun(t.env)).toBeNull();
        });
      });
      ```
- [ ] Step 4: Verify - Run: `bunx vitest run test/worker/retention/config.test.ts && bun run typecheck` - Expected: 4 pass, 0 fail; typecheck exits 0
- [ ] Step 5: Commit - `git add src/worker/retention/config.ts test/helpers/retention-fixtures.ts test/worker/retention/config.test.ts && git commit -m "feat: add retention settings accessors and test fixtures"`

---

### Task 2: Shared delete routine

**Files:**
- Create: `src/worker/retention/delete-backup.ts`
- Test: `test/worker/retention/delete-backup.test.ts`

**Interfaces:**
- Consumes: `writeAudit(db, entry: { actor: string; action: string; entityType: string; entityId?: string | null; details?: unknown; ip?: string | null }): Promise<void>` (register X10); `redactError(error: unknown): string`; Task 1 fixtures.
- Produces (in `delete-backup.ts`):
  - `type Db = ReturnType<typeof getDb>`
  - `backupTime` - SQL expression `coalesce(started_at, queued_at)`
  - `findLatestSuccessId(db: Db, targetId: string): Promise<string | null>`
  - `type DeleteReason = "retention" | "manual"`
  - `interface DeletableBackup { id: string; targetId: string; r2Key: string | null }`
  - `type DeleteOutcome = { status: "deleted" } | { status: "already_deleted" } | { status: "refused_latest_success" } | { status: "r2_failed"; error: string }`
  - `deleteBackup(env: Env, backup: DeletableBackup, opts: { reason: DeleteReason; actor: string; ip?: string | null }): Promise<DeleteOutcome>`

**Gotcha:** The latest-success guard queries live D1 on every call, so a new backup that succeeds mid-run changes which row is "latest". That is intended. The D1 update uses `WHERE deleted_at IS NULL` plus `.returning()`, so two overlapping runs (callback trigger plus daily cron) cannot double-audit one deletion. If the D1 update throws after the R2 delete, `deleteBackup` throws; the row stays `success` with a missing object, and the next run repeats the R2 delete (R2 delete of a missing key succeeds) and finishes the soft delete.

**Steps:**
- [ ] Step 1: Create `src/worker/retention/delete-backup.ts`:
      ```ts
      import { and, desc, eq, isNull, sql } from "drizzle-orm";
      import { getDb } from "../db/client";
      import { backups } from "../db/schema";
      import type { Env } from "../env";
      import { writeAudit } from "../lib/audit";
      import { redactError } from "../lib/redact";

      export type Db = ReturnType<typeof getDb>;

      /** A backup's time for ordering and retention: `started_at`, or `queued_at` when it never started. */
      export const backupTime = sql<string>`coalesce(${backups.startedAt}, ${backups.queuedAt})`;

      export async function findLatestSuccessId(db: Db, targetId: string): Promise<string | null> {
        const row = await db
          .select({ id: backups.id })
          .from(backups)
          .where(and(eq(backups.targetId, targetId), eq(backups.status, "success"), isNull(backups.deletedAt)))
          .orderBy(desc(backupTime), desc(backups.id))
          .get();
        return row?.id ?? null;
      }

      export type DeleteReason = "retention" | "manual";

      export type DeleteOutcome =
        | { status: "deleted" }
        | { status: "already_deleted" }
        | { status: "refused_latest_success" }
        | { status: "r2_failed"; error: string };

      export interface DeletableBackup {
        id: string;
        targetId: string;
        r2Key: string | null;
      }

      const AUDIT_ACTIONS: Record<DeleteReason, { ok: string; failed: string | null }> = {
        retention: { ok: "retention.delete", failed: "retention.delete_failed" },
        manual: { ok: "backup.delete", failed: null },
      };

      /**
       * The single delete routine, shared by the retention runner and DELETE /api/backups/:id.
       * Order is fixed: R2 object first, then the D1 soft delete, then the audit row.
       * A D1 error after the R2 delete is thrown to the caller; the next run repeats the (idempotent) R2 delete and heals it.
       */
      export async function deleteBackup(
        env: Env,
        backup: DeletableBackup,
        opts: { reason: DeleteReason; actor: string; ip?: string | null },
      ): Promise<DeleteOutcome> {
        const db = getDb(env);
        const actions = AUDIT_ACTIONS[opts.reason];
        const details = { targetId: backup.targetId, r2Key: backup.r2Key, reason: opts.reason };

        if ((await findLatestSuccessId(db, backup.targetId)) === backup.id) {
          return { status: "refused_latest_success" };
        }

        try {
          if (!backup.r2Key) throw new Error("backup has no r2_key");
          await env.BACKUPS.delete(backup.r2Key);
        } catch (error) {
          const message = redactError(error);
          if (actions.failed) {
            await writeAudit(db, {
              actor: opts.actor,
              action: actions.failed,
              entityType: "backup",
              entityId: backup.id,
              details: { ...details, error: message },
              ip: opts.ip ?? null,
            });
          }
          return { status: "r2_failed", error: message };
        }

        const updated = await db
          .update(backups)
          .set({ deletedAt: new Date().toISOString(), deletedReason: opts.reason })
          .where(and(eq(backups.id, backup.id), isNull(backups.deletedAt)))
          .returning({ id: backups.id });
        if (updated.length === 0) return { status: "already_deleted" };

        try {
          await writeAudit(db, {
            actor: opts.actor,
            action: actions.ok,
            entityType: "backup",
            entityId: backup.id,
            details,
            ip: opts.ip ?? null,
          });
        } catch (error) {
          console.error(`audit write failed after delete of ${backup.id}: ${redactError(error)}`);
        }
        return { status: "deleted" };
      }
      ```
- [ ] Step 2: Create `test/worker/retention/delete-backup.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { deleteBackup } from "../../../src/worker/retention/delete-backup";
      import { createTestEnv } from "../../helpers/env";
      import {
        auditRows,
        backupRow,
        daysAgo,
        failingR2,
        hasObject,
        seedBackup,
        seedTarget,
      } from "../../helpers/retention-fixtures";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      const asDeletable = (targetId: string, b: { id: string; r2Key: string }) => ({ id: b.id, targetId, r2Key: b.r2Key });

      describe("deleteBackup", () => {
        it("removes the object, soft-deletes the row, and writes one audit row", async () => {
          const targetId = await seedTarget(t.env);
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));

          const outcome = await deleteBackup(t.env, asDeletable(targetId, old), { reason: "retention", actor: "system" });

          expect(outcome).toEqual({ status: "deleted" });
          expect(await hasObject(t.env, old.r2Key)).toBe(false);
          const row = await backupRow(t.env, old.id);
          expect(row?.deletedAt).not.toBeNull();
          expect(row?.deletedReason).toBe("retention");
          expect(row?.status).toBe("success");
          expect(await auditRows(t.env)).toEqual([{ action: "retention.delete", actor: "system", entityId: old.id }]);
        });

        it("refuses the latest success and changes nothing", async () => {
          const targetId = await seedTarget(t.env);
          await seedBackup(t.env, targetId, daysAgo(3));
          const latest = await seedBackup(t.env, targetId, daysAgo(0));

          const outcome = await deleteBackup(t.env, asDeletable(targetId, latest), { reason: "manual", actor: "a@example.com" });

          expect(outcome).toEqual({ status: "refused_latest_success" });
          expect(await hasObject(t.env, latest.r2Key)).toBe(true);
          expect((await backupRow(t.env, latest.id))?.deletedAt).toBeNull();
          expect(await auditRows(t.env)).toEqual([]);
        });

        it("keeps the row when the R2 delete fails, and audits only retention failures", async () => {
          const targetId = await seedTarget(t.env);
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));
          const env = failingR2(t.env, new Set([old.r2Key]));

          const retention = await deleteBackup(env, asDeletable(targetId, old), { reason: "retention", actor: "system" });
          expect(retention).toMatchObject({ status: "r2_failed", error: expect.stringContaining("R2 unavailable") });
          const manual = await deleteBackup(env, asDeletable(targetId, old), { reason: "manual", actor: "a@example.com" });
          expect(manual.status).toBe("r2_failed");

          expect(await hasObject(t.env, old.r2Key)).toBe(true);
          expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
          expect(await auditRows(t.env)).toEqual([{ action: "retention.delete_failed", actor: "system", entityId: old.id }]);
        });

        it("reports already_deleted on a repeat call and writes no second audit row", async () => {
          const targetId = await seedTarget(t.env);
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));
          const opts = { reason: "retention", actor: "system" } as const;

          await deleteBackup(t.env, asDeletable(targetId, old), opts);
          const second = await deleteBackup(t.env, asDeletable(targetId, old), opts);

          expect(second).toEqual({ status: "already_deleted" });
          expect(await auditRows(t.env)).toHaveLength(1);
        });

        it("fails without touching D1 when the row has no r2_key", async () => {
          const targetId = await seedTarget(t.env);
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));

          const outcome = await deleteBackup(t.env, { id: old.id, targetId, r2Key: null }, { reason: "manual", actor: "a@example.com" });

          expect(outcome).toMatchObject({ status: "r2_failed" });
          expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/retention/delete-backup.test.ts && bun run typecheck` - Expected: 5 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add src/worker/retention/delete-backup.ts test/worker/retention/delete-backup.test.ts && git commit -m "feat: add shared backup delete routine with latest-success guard"`

---

### Task 3: Retention planner (D1 rows to the Phase 3 function)

**Files:**
- Create: `src/worker/retention/plan.ts`
- Test: `test/worker/retention/plan.test.ts`

**Interfaces:**
- Consumes: `selectBackupsToDelete(backups: RetentionBackup[], policy: RetentionPolicy, now: Date, tz: string): { keep: RetentionBackup[]; delete: RetentionBackup[]; reasons: Record<string, string[]> }` from `src/worker/retention/gfs.ts` (register, Phase 3 plan; import `./gfs`); `RetentionBackup = { id: string; status: string; created_at: string }` and `RetentionPolicy = { keep_last: number | null; daily: number | null; weekly: number | null; monthly: number | null; max_age_days?: number | null }` from `src/worker/retention/types.ts`; `Db`, `backupTime` from Task 2.
- Produces (in `plan.ts`):
  - `type TargetRow = typeof targets.$inferSelect`
  - `interface PlannedDeletion { id: string; r2Key: string | null; startedAt: string; sizeBytes: number | null }`
  - `interface RetentionPlan { keep: string[]; delete: PlannedDeletion[]; reasons: Record<string, string[]> }` - `delete` is oldest first
  - `loadActiveTarget(db: Db, targetId: string): Promise<TargetRow | undefined>` - excludes soft-deleted targets
  - `planRetention(db: Db, target: TargetRow, now: Date): Promise<RetentionPlan>` - no writes

**Gotcha:** Column mapping is `keep_daily` to `daily`, `keep_weekly` to `weekly`, `keep_monthly` to `monthly`, `backups.started_at` (falling back to `queued_at`) to `created_at`. Only `status = 'success'` and `deleted_at IS NULL` rows are loaded, so Phase 3 never sees failed rows. Semantics, restated for the tests: `keep_last` keeps the N newest successes; `daily N` keeps the newest backup of each of the N most recent distinct local days that have a backup (gaps do not count as days); weekly uses ISO weeks (Monday start), monthly uses calendar months, all in the target's timezone; `null` or `0` turns a rule off; the latest success is always kept. The tests below assert the mapping and the timezone hand-off, not Phase 3's algorithm.

**Steps:**
- [ ] Step 1: Create `src/worker/retention/plan.ts`:
      ```ts
      import { and, asc, eq, isNull } from "drizzle-orm";
      import { backups, targets } from "../db/schema";
      import { backupTime, type Db } from "./delete-backup";
      import { selectBackupsToDelete } from "./gfs";
      import type { RetentionBackup, RetentionPolicy } from "./types";

      export type TargetRow = typeof targets.$inferSelect;

      export interface PlannedDeletion {
        id: string;
        r2Key: string | null;
        startedAt: string;
        sizeBytes: number | null;
      }

      export interface RetentionPlan {
        keep: string[];
        /** Oldest first, so a per-run cap always removes the oldest backups first. */
        delete: PlannedDeletion[];
        reasons: Record<string, string[]>;
      }

      export async function loadActiveTarget(db: Db, targetId: string): Promise<TargetRow | undefined> {
        return db
          .select()
          .from(targets)
          .where(and(eq(targets.id, targetId), isNull(targets.deletedAt)))
          .get();
      }

      export async function planRetention(db: Db, target: TargetRow, now: Date): Promise<RetentionPlan> {
        const rows = await db
          .select({ id: backups.id, r2Key: backups.r2Key, sizeBytes: backups.sizeBytes, startedAt: backupTime })
          .from(backups)
          .where(and(eq(backups.targetId, target.id), eq(backups.status, "success"), isNull(backups.deletedAt)))
          .orderBy(asc(backupTime), asc(backups.id));

        const input: RetentionBackup[] = rows.map((r) => ({ id: r.id, status: "success", created_at: r.startedAt }));
        const policy: RetentionPolicy = {
          keep_last: target.keepLast,
          daily: target.keepDaily,
          weekly: target.keepWeekly,
          monthly: target.keepMonthly,
          max_age_days: target.maxAgeDays,
        };
        const selection = selectBackupsToDelete(input, policy, now, target.timezone);

        const doomed = new Set(selection.delete.map((b) => b.id));
        return {
          keep: selection.keep.map((b) => b.id),
          delete: rows.filter((r) => doomed.has(r.id)),
          reasons: selection.reasons,
        };
      }
      ```
- [ ] Step 2: Create `test/worker/retention/plan.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { getDb } from "../../../src/worker/db/client";
      import { backups, targets } from "../../../src/worker/db/schema";
      import { eq } from "drizzle-orm";
      import { loadActiveTarget, planRetention } from "../../../src/worker/retention/plan";
      import { createTestEnv } from "../../helpers/env";
      import { NOW, daysAgo, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      async function plan(targetId: string) {
        const db = getDb(t.env);
        const target = await loadActiveTarget(db, targetId);
        if (!target) throw new Error("target not found");
        return planRetention(db, target, NOW);
      }

      describe("planRetention", () => {
        it("maps keep_last and lists deletions oldest first with their R2 keys", async () => {
          const targetId = await seedTarget(t.env, { keepLast: 2 });
          const b3 = await seedBackup(t.env, targetId, daysAgo(3));
          const b2 = await seedBackup(t.env, targetId, daysAgo(2));
          const b1 = await seedBackup(t.env, targetId, daysAgo(1));
          const b0 = await seedBackup(t.env, targetId, daysAgo(0));

          const result = await plan(targetId);

          expect(result.delete.map((d) => d.id)).toEqual([b3.id, b2.id]);
          expect(result.delete.map((d) => d.r2Key)).toEqual([b3.r2Key, b2.r2Key]);
          expect(result.keep.sort()).toEqual([b1.id, b0.id].sort());
          expect(result.reasons[b0.id]).toContain("keep_last");
        });

        it("ignores failed and already soft-deleted backups", async () => {
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const failed = await seedBackup(t.env, targetId, daysAgo(5), "failed");
          const gone = await seedBackup(t.env, targetId, daysAgo(4));
          await getDb(t.env).update(backups).set({ deletedAt: NOW.toISOString(), deletedReason: "manual" }).where(eq(backups.id, gone.id));
          const old = await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(0));

          const result = await plan(targetId);

          expect(result.delete.map((d) => d.id)).toEqual([old.id]);
          expect(result.delete.map((d) => d.id)).not.toContain(failed.id);
        });

        it("maps keep_daily to the daily rule using the target's local days", async () => {
          const targetId = await seedTarget(t.env, { keepLast: null, keepDaily: 2 });
          const b2 = await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(1));
          const sameDayEarly = await seedBackup(t.env, targetId, new Date(NOW.getTime() - 3_600_000).toISOString());
          await seedBackup(t.env, targetId, daysAgo(0));

          const result = await plan(targetId);

          expect(result.delete.map((d) => d.id)).toEqual([b2.id, sameDayEarly.id]);
        });

        it("uses the target's timezone for the day boundary", async () => {
          const earlyUtc = "2026-06-14T17:30:00.000Z";
          const lateUtc = "2026-06-15T10:00:00.000Z";
          const bangkok = await seedTarget(t.env, { keepLast: null, keepDaily: 2, timezone: "Asia/Bangkok" });
          const bangkokEarly = await seedBackup(t.env, bangkok, earlyUtc);
          await seedBackup(t.env, bangkok, lateUtc);
          const utc = await seedTarget(t.env, { keepLast: null, keepDaily: 2, timezone: "UTC" });
          await seedBackup(t.env, utc, earlyUtc);
          await seedBackup(t.env, utc, lateUtc);

          expect((await plan(bangkok)).delete.map((d) => d.id)).toEqual([bangkokEarly.id]);
          expect((await plan(utc)).delete).toEqual([]);
        });

        it("returns no target for a soft-deleted target", async () => {
          const targetId = await seedTarget(t.env, { deletedAt: NOW.toISOString() });
          expect(await loadActiveTarget(getDb(t.env), targetId)).toBeUndefined();
          expect(await getDb(t.env).select().from(targets).where(eq(targets.id, targetId)).get()).toBeDefined();
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/retention/plan.test.ts && bun run typecheck` - Expected: 5 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add src/worker/retention/plan.ts test/worker/retention/plan.test.ts && git commit -m "feat: add retention planner mapping D1 rows to the GFS function"`

---

### Task 4: runRetention

**Files:**
- Create: `src/worker/retention/runner.ts`
- Test: `test/worker/retention/runner.test.ts`

**Interfaces:**
- Consumes: Task 1 `getRetentionDryRun(env)`; Task 2 `deleteBackup`; Task 3 `loadActiveTarget`, `planRetention`; `redactError`, `redactSecrets` from `src/worker/lib/redact.ts`.
- Produces (in `runner.ts`):
  - `MAX_DELETIONS_PER_RUN = 50`
  - `interface RetentionResult { deleted: string[]; failed: { id: string; error: string }[]; dryRun: boolean; remaining: number }`
  - `runRetention(env: Env, targetId: string, opts?: { now?: Date; maxDeletions?: number }): Promise<RetentionResult>` - never throws for a per-backup problem; a missing or soft-deleted target returns an empty result.

**Gotcha:** In dry run the function returns `deleted: []`, `remaining: 0` and logs the decision; it does not call `deleteBackup` at all. `refused_latest_success` from `deleteBackup` is reported in `failed` (it signals a Phase 3 bug, so it must be visible).

**Steps:**
- [ ] Step 1: Create `src/worker/retention/runner.ts`:
      ```ts
      import { getDb } from "../db/client";
      import type { Env } from "../env";
      import { redactError, redactSecrets } from "../lib/redact";
      import { getRetentionDryRun } from "./config";
      import { deleteBackup } from "./delete-backup";
      import { loadActiveTarget, planRetention } from "./plan";

      export const MAX_DELETIONS_PER_RUN = 50;

      export interface RetentionResult {
        deleted: string[];
        failed: { id: string; error: string }[];
        dryRun: boolean;
        /** Planned deletions not attempted because of `maxDeletions`. Always 0 in a dry run. */
        remaining: number;
      }

      export async function runRetention(
        env: Env,
        targetId: string,
        opts: { now?: Date; maxDeletions?: number } = {},
      ): Promise<RetentionResult> {
        const db = getDb(env);
        const dryRun = await getRetentionDryRun(env);
        const result: RetentionResult = { deleted: [], failed: [], dryRun, remaining: 0 };

        const target = await loadActiveTarget(db, targetId);
        if (!target) return result;

        const plan = await planRetention(db, target, opts.now ?? new Date());

        if (dryRun) {
          console.info(
            redactSecrets(
              JSON.stringify({
                event: "retention.dry_run",
                targetId,
                keep: plan.keep.length,
                delete: plan.delete.map((d) => d.id),
              }),
            ),
          );
          return result;
        }

        const batch = plan.delete.slice(0, opts.maxDeletions ?? MAX_DELETIONS_PER_RUN);
        result.remaining = plan.delete.length - batch.length;

        for (const backup of batch) {
          try {
            const outcome = await deleteBackup(env, { id: backup.id, targetId, r2Key: backup.r2Key }, { reason: "retention", actor: "system" });
            if (outcome.status === "deleted") result.deleted.push(backup.id);
            else if (outcome.status === "refused_latest_success") result.failed.push({ id: backup.id, error: "refused_latest_success" });
            else if (outcome.status === "r2_failed") result.failed.push({ id: backup.id, error: outcome.error });
          } catch (error) {
            result.failed.push({ id: backup.id, error: redactError(error) });
          }
        }
        return result;
      }
      ```
- [ ] Step 2: Create `test/worker/retention/runner.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
      import { writeSetting } from "../../../src/worker/retention/config";
      import { runRetention } from "../../../src/worker/retention/runner";
      import { createTestEnv } from "../../helpers/env";
      import {
        NOW,
        auditRows,
        backupRow,
        daysAgo,
        failingR2,
        hasObject,
        seedBackup,
        seedTarget,
      } from "../../helpers/retention-fixtures";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        vi.restoreAllMocks();
        await t.dispose();
      });

      const goLive = () => writeSetting(t.env, "retention_dry_run", false);

      describe("runRetention", () => {
        it("removes the right objects, soft-deletes the rows, and audits each deletion", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 2 });
          const b4 = await seedBackup(t.env, targetId, daysAgo(4));
          const b3 = await seedBackup(t.env, targetId, daysAgo(3));
          const b2 = await seedBackup(t.env, targetId, daysAgo(2));
          const b1 = await seedBackup(t.env, targetId, daysAgo(1));
          const b0 = await seedBackup(t.env, targetId, daysAgo(0));

          const result = await runRetention(t.env, targetId, { now: NOW });

          expect(result).toEqual({ deleted: [b4.id, b3.id, b2.id], failed: [], dryRun: false, remaining: 0 });
          for (const gone of [b4, b3, b2]) {
            expect(await hasObject(t.env, gone.r2Key)).toBe(false);
            const row = await backupRow(t.env, gone.id);
            expect(row?.deletedAt).not.toBeNull();
            expect(row?.deletedReason).toBe("retention");
          }
          for (const kept of [b1, b0]) {
            expect(await hasObject(t.env, kept.r2Key)).toBe(true);
            expect((await backupRow(t.env, kept.id))?.deletedAt).toBeNull();
          }
          const audit = await auditRows(t.env);
          expect(audit).toHaveLength(3);
          expect(audit.every((a) => a.action === "retention.delete" && a.actor === "system")).toBe(true);
        });

        it("never touches failed backups", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const failed = await seedBackup(t.env, targetId, daysAgo(9), "failed");
          await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(0));

          await runRetention(t.env, targetId, { now: NOW });

          expect((await backupRow(t.env, failed.id))?.deletedAt).toBeNull();
        });

        it("keeps D1 consistent when an R2 delete fails, continues, and heals on the next run", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const b2 = await seedBackup(t.env, targetId, daysAgo(2));
          const b1 = await seedBackup(t.env, targetId, daysAgo(1));
          await seedBackup(t.env, targetId, daysAgo(0));
          const env = failingR2(t.env, new Set([b1.r2Key]));

          const first = await runRetention(env, targetId, { now: NOW });

          expect(first.deleted).toEqual([b2.id]);
          expect(first.failed).toEqual([{ id: b1.id, error: expect.stringContaining("R2 unavailable") }]);
          expect(await hasObject(t.env, b1.r2Key)).toBe(true);
          expect((await backupRow(t.env, b1.id))?.deletedAt).toBeNull();
          expect((await auditRows(t.env)).map((a) => a.action).sort()).toEqual(["retention.delete", "retention.delete_failed"]);

          const second = await runRetention(t.env, targetId, { now: NOW });
          expect(second.deleted).toEqual([b1.id]);
          expect(await hasObject(t.env, b1.r2Key)).toBe(false);
        });

        it("deletes nothing in dry run, which is the default, and logs the decision", async () => {
          const info = vi.spyOn(console, "info").mockImplementation(() => {});
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));

          const result = await runRetention(t.env, targetId, { now: NOW });

          expect(result).toEqual({ deleted: [], failed: [], dryRun: true, remaining: 0 });
          expect(await hasObject(t.env, old.r2Key)).toBe(true);
          expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
          expect(await auditRows(t.env)).toEqual([]);
          expect(info).toHaveBeenCalledWith(expect.stringContaining(old.id));
        });

        it("keeps the latest success even when every rule is off", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 0 });
          const b2 = await seedBackup(t.env, targetId, daysAgo(2));
          const b1 = await seedBackup(t.env, targetId, daysAgo(1));
          const b0 = await seedBackup(t.env, targetId, daysAgo(0));

          const result = await runRetention(t.env, targetId, { now: NOW });

          expect(result.deleted).toEqual([b2.id, b1.id]);
          expect(await hasObject(t.env, b0.r2Key)).toBe(true);
        });

        it("skips a soft-deleted target and leaves its backups alone", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1, deletedAt: NOW.toISOString() });
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));

          const result = await runRetention(t.env, targetId, { now: NOW });

          expect(result.deleted).toEqual([]);
          expect(await hasObject(t.env, old.r2Key)).toBe(true);
        });

        it("stops at maxDeletions, oldest first, and reports what is left", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const b3 = await seedBackup(t.env, targetId, daysAgo(3));
          const b2 = await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(1));
          await seedBackup(t.env, targetId, daysAgo(0));

          const result = await runRetention(t.env, targetId, { now: NOW, maxDeletions: 2 });

          expect(result.deleted).toEqual([b3.id, b2.id]);
          expect(result.remaining).toBe(1);
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/retention/runner.test.ts && bun run typecheck` - Expected: 7 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add src/worker/retention/runner.ts test/worker/retention/runner.test.ts && git commit -m "feat: add runRetention with R2-first delete, dry run, and failure reporting"`

---

### Task 5: Triggers (daily run and after-backup)

**Files:**
- Create: `src/worker/retention/triggers.ts`
- Test: `test/worker/retention/triggers.test.ts`

**Interfaces:**
- Consumes: Task 1 `getLastRun`, `setLastRun`, `getRetentionDryRun`, `getRetentionTimezone`; Task 4 `runRetention`, `MAX_DELETIONS_PER_RUN`; `getZonedParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }` from `src/shared/tz.ts` (register X9).
- Produces (in `triggers.ts`):
  - `interface DailyRetentionResult { ran: boolean; complete: boolean; deleted: number; failed: number }`
  - `runDailyRetention(env: Env, now?: Date, budget?: number): Promise<DailyRetentionResult>`
  - `triggerRetentionAfterBackup(env: Env, targetId: string): Promise<void>` - never throws
  - `triggerDailyRetention(env: Env, now: Date): Promise<void>` - never throws

**Gotcha:** The "once per day" rule is evaluated in the default timezone, not UTC. Bangkok is UTC+7, so the local day changes at 17:00Z. The tests pin both sides of that boundary on the same UTC day. A target that throws is logged (redacted) and skipped for that tick; the day is still recorded, so it is retried the next day and by the next successful backup.

**Steps:**
- [ ] Step 1: Create `src/worker/retention/triggers.ts`:
      ```ts
      import { getDb } from "../db/client";
      import { targets } from "../db/schema";
      import { isNull, asc } from "drizzle-orm";
      import type { Env } from "../env";
      import { redactError } from "../lib/redact";
      import { getZonedParts } from "../../shared/tz";
      import { getLastRun, getRetentionDryRun, getRetentionTimezone, setLastRun } from "./config";
      import { MAX_DELETIONS_PER_RUN, runRetention } from "./runner";

      export interface DailyRetentionResult {
        ran: boolean;
        /** False when the per-tick budget ran out; the next cron tick continues and the day is not yet recorded. */
        complete: boolean;
        deleted: number;
        failed: number;
      }

      function localDate(now: Date, tz: string): string {
        const p = getZonedParts(now, tz);
        return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      }

      /**
       * Runs retention for every active target at most once per local day (default timezone).
       * A dry-run day does not block a later live run on the same day.
       */
      export async function runDailyRetention(
        env: Env,
        now: Date = new Date(),
        budget: number = MAX_DELETIONS_PER_RUN,
      ): Promise<DailyRetentionResult> {
        const [tz, dryRun, lastRun] = await Promise.all([getRetentionTimezone(env), getRetentionDryRun(env), getLastRun(env)]);
        const today = localDate(now, tz);
        if (lastRun?.date === today && (lastRun.dryRun === false || dryRun === true)) {
          return { ran: false, complete: true, deleted: 0, failed: 0 };
        }

        const ids = await getDb(env).select({ id: targets.id }).from(targets).where(isNull(targets.deletedAt)).orderBy(asc(targets.id));
        let remainingBudget = budget;
        let complete = true;
        let deleted = 0;
        let failed = 0;

        for (const { id } of ids) {
          if (remainingBudget <= 0) {
            complete = false;
            break;
          }
          try {
            const result = await runRetention(env, id, { now, maxDeletions: remainingBudget });
            remainingBudget -= result.deleted.length + result.failed.length;
            deleted += result.deleted.length;
            failed += result.failed.length;
            if (result.remaining > 0) complete = false;
          } catch (error) {
            console.error(`retention failed for target ${id}: ${redactError(error)}`);
          }
        }

        if (complete) await setLastRun(env, { date: today, dryRun });
        return { ran: true, complete, deleted, failed };
      }

      /** Never throws: for ctx.waitUntil after a successful backup callback. */
      export async function triggerRetentionAfterBackup(env: Env, targetId: string): Promise<void> {
        try {
          await runRetention(env, targetId);
        } catch (error) {
          console.error(`retention after backup failed for target ${targetId}: ${redactError(error)}`);
        }
      }

      /** Never throws: for ctx.waitUntil from the cron handler. */
      export async function triggerDailyRetention(env: Env, now: Date): Promise<void> {
        try {
          await runDailyRetention(env, now);
        } catch (error) {
          console.error(`daily retention failed: ${redactError(error)}`);
        }
      }
      ```
- [ ] Step 2: Create `test/worker/retention/triggers.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
      import { getLastRun, writeSetting } from "../../../src/worker/retention/config";
      import { runDailyRetention, triggerDailyRetention, triggerRetentionAfterBackup } from "../../../src/worker/retention/triggers";
      import { createTestEnv } from "../../helpers/env";
      import { NOW, backupRow, daysAgo, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

      // 19:00 on 15 June in Asia/Bangkok. The next Bangkok day starts at 17:00Z, still the same UTC day.
      const NEXT_BANGKOK_DAY = new Date("2026-06-15T17:01:00.000Z");

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        vi.restoreAllMocks();
        await t.dispose();
      });

      const goLive = () => writeSetting(t.env, "retention_dry_run", false);

      describe("runDailyRetention", () => {
        it("runs once per local day", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(0));

          expect(await runDailyRetention(t.env, NOW)).toEqual({ ran: true, complete: true, deleted: 1, failed: 0 });

          const extra = await seedBackup(t.env, targetId, daysAgo(1));
          expect((await runDailyRetention(t.env, NOW)).ran).toBe(false);
          expect((await backupRow(t.env, extra.id))?.deletedAt).toBeNull();
        });

        it("runs again when the Bangkok day changes, even within the same UTC day", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          await seedBackup(t.env, targetId, daysAgo(0));
          await runDailyRetention(t.env, NOW);

          const extra = await seedBackup(t.env, targetId, daysAgo(1));
          const next = await runDailyRetention(t.env, NEXT_BANGKOK_DAY);

          expect(next).toMatchObject({ ran: true, deleted: 1 });
          expect((await backupRow(t.env, extra.id))?.deletedAt).not.toBeNull();
        });

        it("stops at the budget, does not record the day, and finishes on the next tick", async () => {
          await goLive();
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(1));
          await seedBackup(t.env, targetId, daysAgo(0));

          const first = await runDailyRetention(t.env, NOW, 2);
          expect(first).toMatchObject({ ran: true, complete: false, deleted: 2 });
          expect(await getLastRun(t.env)).toBeNull();

          const second = await runDailyRetention(t.env, NOW, 2);
          expect(second).toMatchObject({ ran: true, complete: true, deleted: 1 });
          expect(await getLastRun(t.env)).toEqual({ date: "2026-06-15", dryRun: false });
        });

        it("lets a live run happen on a day that only had a dry run", async () => {
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const old = await seedBackup(t.env, targetId, daysAgo(2));
          await seedBackup(t.env, targetId, daysAgo(0));
          vi.spyOn(console, "info").mockImplementation(() => {});

          expect(await runDailyRetention(t.env, NOW)).toMatchObject({ ran: true, deleted: 0 });
          expect((await runDailyRetention(t.env, NOW)).ran).toBe(false);

          await goLive();
          expect(await runDailyRetention(t.env, NOW)).toMatchObject({ ran: true, deleted: 1 });
          expect((await backupRow(t.env, old.id))?.deletedAt).not.toBeNull();
        });
      });

      describe("retention triggers", () => {
        it("never throw and log a redacted line", async () => {
          const broken = {
            ...t.env,
            DB: {
              prepare() {
                throw new Error("connect postgres://app:hunter2@db.example.com/x failed");
              },
            } as unknown as D1Database,
          };
          const error = vi.spyOn(console, "error").mockImplementation(() => {});

          await expect(triggerRetentionAfterBackup(broken, "t1")).resolves.toBeUndefined();
          await expect(triggerDailyRetention(broken, NOW)).resolves.toBeUndefined();

          expect(error).toHaveBeenCalledTimes(2);
          expect(JSON.stringify(error.mock.calls)).not.toContain("hunter2");
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/retention/triggers.test.ts && bun run typecheck` - Expected: 5 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add src/worker/retention/triggers.ts test/worker/retention/triggers.test.ts && git commit -m "feat: add daily and after-backup retention triggers"`

---

### Task 6: Preview endpoint

**Files:**
- Create: `src/worker/routes/retention.ts`
- Modify: `src/worker/app.ts` (anchor: `app.use("/api/*", access())`, then the existing `app.route(` lines)
- Test: `test/worker/routes/retention.test.ts`

**Interfaces:**
- Consumes: `AppEnv` from `src/worker/middleware/access.ts`; `ApiError(status: number, code: string, message: string, details?: unknown)` (register X6; import path per the Phase gate); Task 1 `getRetentionDryRun`; Task 3 `loadActiveTarget`, `planRetention`; Task 4 `runRetention`.
- Produces: `retentionRoutes: Hono<AppEnv>` exporting `GET /targets/:id/retention-preview`, mounted at `/api`. Response `200 { dryRun: boolean; keep: string[]; delete: { id: string; startedAt: string; sizeBytes: number | null; reason: "no_rule_keeps_it" }[]; reasons: Record<string, string[]> }`; `404 not_found` for an unknown or soft-deleted target. No writes.

**Steps:**
- [ ] Step 1: Create `src/worker/routes/retention.ts`:
      ```ts
      import { Hono } from "hono";
      import { getDb } from "../db/client";
      import type { AppEnv } from "../middleware/access";
      import { ApiError } from "../middleware/error";
      import { getRetentionDryRun } from "../retention/config";
      import { loadActiveTarget, planRetention } from "../retention/plan";

      export const retentionRoutes = new Hono<AppEnv>();

      retentionRoutes.get("/targets/:id/retention-preview", async (c) => {
        const db = getDb(c.env);
        const target = await loadActiveTarget(db, c.req.param("id"));
        if (!target) throw new ApiError(404, "not_found", "Target not found");

        const [plan, dryRun] = await Promise.all([planRetention(db, target, new Date()), getRetentionDryRun(c.env)]);
        return c.json({
          dryRun,
          keep: plan.keep,
          delete: plan.delete.map((d) => ({
            id: d.id,
            startedAt: d.startedAt,
            sizeBytes: d.sizeBytes,
            reason: "no_rule_keeps_it",
          })),
          reasons: plan.reasons,
        });
      });
      ```
- [ ] Step 2: Mount it in `src/worker/app.ts`. Follow the file's existing mount style. Add the import next to the other route imports and the `app.route` call below `app.use("/api/*", access())`:
      ```ts
      import { retentionRoutes } from "./routes/retention";

      app.route("/api", retentionRoutes);
      ```
- [ ] Step 3: Create `test/worker/routes/retention.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { app } from "../../../src/worker/app";
      import { writeSetting } from "../../../src/worker/retention/config";
      import { runRetention } from "../../../src/worker/retention/runner";
      import { createTestEnv } from "../../helpers/env";
      import { NOW, auditRows, backupRow, daysAgo, hasObject, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      const preview = (targetId: string, env = t.env) =>
        app.request(`http://localhost/api/targets/${targetId}/retention-preview`, {}, env);

      // keep_last is the only rule used here, so the answer does not depend on the real clock the route reads.
      async function seedThree() {
        const targetId = await seedTarget(t.env, { keepLast: 1 });
        const b2 = await seedBackup(t.env, targetId, daysAgo(2));
        const b1 = await seedBackup(t.env, targetId, daysAgo(1));
        const b0 = await seedBackup(t.env, targetId, daysAgo(0));
        return { targetId, b2, b1, b0 };
      }

      describe("GET /api/targets/:id/retention-preview", () => {
        it("lists what would be deleted, with reasons for what is kept, and changes nothing", async () => {
          const { targetId, b2, b1, b0 } = await seedThree();

          const res = await preview(targetId);

          expect(res.status).toBe(200);
          const body = (await res.json()) as {
            dryRun: boolean;
            keep: string[];
            delete: { id: string; reason: string }[];
            reasons: Record<string, string[]>;
          };
          expect(body.dryRun).toBe(true);
          expect(body.keep).toEqual([b0.id]);
          expect(body.delete.map((d) => d.id)).toEqual([b2.id, b1.id]);
          expect(body.reasons[b0.id]).toContain("keep_last");
          for (const b of [b2, b1, b0]) {
            expect(await hasObject(t.env, b.r2Key)).toBe(true);
            expect((await backupRow(t.env, b.id))?.deletedAt).toBeNull();
          }
          expect(await auditRows(t.env)).toEqual([]);
        });

        it("matches exactly what the runner then deletes", async () => {
          const { targetId } = await seedThree();
          const body = (await (await preview(targetId)).json()) as { delete: { id: string }[] };

          await writeSetting(t.env, "retention_dry_run", false);
          const result = await runRetention(t.env, targetId, { now: NOW });

          expect(result.deleted).toEqual(body.delete.map((d) => d.id));
        });

        it("returns 404 for an unknown or soft-deleted target", async () => {
          const deleted = await seedTarget(t.env, { deletedAt: NOW.toISOString() });
          expect((await preview(deleted)).status).toBe(404);
          expect((await preview("00000000-0000-7000-8000-000000000000")).status).toBe(404);
        });

        it("sits behind Access", async () => {
          const locked = await createTestEnv({ DEV_BYPASS: "false" });
          try {
            expect((await preview("any-id", locked.env)).status).toBe(401);
          } finally {
            await locked.dispose();
          }
        });
      });
      ```
- [ ] Step 4: Verify - Run: `bunx vitest run test/worker/routes/retention.test.ts && bun run typecheck` - Expected: 4 pass, 0 fail; typecheck exits 0
- [ ] Step 5: Commit - `git add src/worker/routes/retention.ts src/worker/app.ts test/worker/routes/retention.test.ts && git commit -m "feat: add GET /api/targets/:id/retention-preview"`

---

### Task 7: Manual backup delete endpoint

**Files:**
- Create: `src/worker/routes/backup-delete.ts`
- Modify: `src/worker/app.ts` (anchor: the `app.route("/api", retentionRoutes)` line from Task 6)
- Test: `test/worker/routes/backup-delete.test.ts`

**Interfaces:**
- Consumes: `parseBody(c, schema)` from `src/worker/lib/validate.ts` (register X5; assumed `parseBody<T>(c: Context, schema: ZodType<T>): Promise<T>` that throws `ApiError(400, "validation_error", ...)`); `ApiError`; `AppEnv` (`c.get("actorEmail"): string`); Task 2 `deleteBackup`.
- Produces: `backupDeleteRoutes: Hono<AppEnv>` exporting `DELETE /backups/:id`, mounted at `/api`. Body `{ confirm: true }`. `204` on success; `400 validation_error` without `confirm: true`; `404 not_found` for an unknown or already-deleted backup; `409 conflict` with `details.reason` `latest_success` or `not_success`; `502 r2_delete_failed` when R2 fails (D1 unchanged). Always performed for real (ASK-1).

**Gotcha:** Phase 5 or 7 may already own `src/worker/routes/backups.ts` (it holds `GET /api/backups/:id` in `docs/PLAN.md`). This task uses a separate file on purpose so it never edits another phase's routes. Hono routes by method and path, so `DELETE /api/backups/:id` does not collide with a `GET` of the same path.

**Steps:**
- [ ] Step 1: Create `src/worker/routes/backup-delete.ts`:
      ```ts
      import { and, eq, isNull } from "drizzle-orm";
      import { Hono } from "hono";
      import { z } from "zod";
      import { getDb } from "../db/client";
      import { backups } from "../db/schema";
      import { parseBody } from "../lib/validate";
      import type { AppEnv } from "../middleware/access";
      import { ApiError } from "../middleware/error";
      import { deleteBackup } from "../retention/delete-backup";

      const deleteBody = z.object({ confirm: z.literal(true) });

      export const backupDeleteRoutes = new Hono<AppEnv>();

      backupDeleteRoutes.delete("/backups/:id", async (c) => {
        await parseBody(c, deleteBody);

        const backup = await getDb(c.env)
          .select({ id: backups.id, targetId: backups.targetId, status: backups.status, r2Key: backups.r2Key })
          .from(backups)
          .where(and(eq(backups.id, c.req.param("id")), isNull(backups.deletedAt)))
          .get();
        if (!backup) throw new ApiError(404, "not_found", "Backup not found");
        if (backup.status !== "success") {
          throw new ApiError(409, "conflict", "Only successful backups can be deleted", { reason: "not_success" });
        }

        const outcome = await deleteBackup(c.env, backup, {
          reason: "manual",
          actor: c.get("actorEmail"),
          ip: c.req.header("cf-connecting-ip") ?? null,
        });

        if (outcome.status === "refused_latest_success") {
          throw new ApiError(409, "conflict", "The most recent successful backup cannot be deleted", { reason: "latest_success" });
        }
        if (outcome.status === "r2_failed") {
          throw new ApiError(502, "r2_delete_failed", "The backup file could not be deleted from R2; nothing was changed");
        }
        return c.body(null, 204);
      });
      ```
- [ ] Step 2: Mount it in `src/worker/app.ts` right after the `retentionRoutes` mount:
      ```ts
      import { backupDeleteRoutes } from "./routes/backup-delete";

      app.route("/api", backupDeleteRoutes);
      ```
- [ ] Step 3: Create `test/worker/routes/backup-delete.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { app } from "../../../src/worker/app";
      import { createTestEnv } from "../../helpers/env";
      import { auditRows, backupRow, daysAgo, failingR2, hasObject, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      const del = (id: string, body: unknown = { confirm: true }, env = t.env) =>
        app.request(
          `http://localhost/api/backups/${id}`,
          { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
          env,
        );

      async function seedTwo() {
        const targetId = await seedTarget(t.env);
        const old = await seedBackup(t.env, targetId, daysAgo(3));
        const latest = await seedBackup(t.env, targetId, daysAgo(0));
        return { targetId, old, latest };
      }

      describe("DELETE /api/backups/:id", () => {
        it("deletes the object and soft-deletes the row even while retention is in dry run", async () => {
          const { old } = await seedTwo();

          const res = await del(old.id);

          expect(res.status).toBe(204);
          expect(await hasObject(t.env, old.r2Key)).toBe(false);
          const row = await backupRow(t.env, old.id);
          expect(row?.deletedAt).not.toBeNull();
          expect(row?.deletedReason).toBe("manual");
          const audit = await auditRows(t.env);
          expect(audit).toHaveLength(1);
          expect(audit[0]).toMatchObject({ action: "backup.delete", entityId: old.id });
          expect(audit[0]?.actor).not.toBe("system");
        });

        it("requires { confirm: true }", async () => {
          const { old } = await seedTwo();
          for (const body of [{}, { confirm: false }, { confirm: "true" }]) {
            const res = await del(old.id, body);
            expect(res.status).toBe(400);
            expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
          }
          expect(await hasObject(t.env, old.r2Key)).toBe(true);
        });

        it("refuses the latest success with 409 and changes nothing", async () => {
          const { latest } = await seedTwo();

          const res = await del(latest.id);

          expect(res.status).toBe(409);
          expect(await hasObject(t.env, latest.r2Key)).toBe(true);
          expect((await backupRow(t.env, latest.id))?.deletedAt).toBeNull();
        });

        it("refuses a backup that is not a success", async () => {
          const targetId = await seedTarget(t.env);
          const failed = await seedBackup(t.env, targetId, daysAgo(1), "failed");
          expect((await del(failed.id)).status).toBe(409);
        });

        it("returns 404 for an unknown id and for a backup that is already deleted", async () => {
          const { old } = await seedTwo();
          expect((await del("00000000-0000-7000-8000-000000000000")).status).toBe(404);
          expect((await del(old.id)).status).toBe(204);
          expect((await del(old.id)).status).toBe(404);
        });

        it("returns 502 and leaves D1 unchanged when R2 fails", async () => {
          const { old } = await seedTwo();

          const res = await del(old.id, { confirm: true }, failingR2(t.env, new Set([old.r2Key])));

          expect(res.status).toBe(502);
          expect(await hasObject(t.env, old.r2Key)).toBe(true);
          expect((await backupRow(t.env, old.id))?.deletedAt).toBeNull();
        });
      });
      ```
- [ ] Step 4: Verify - Run: `bunx vitest run test/worker/routes/backup-delete.test.ts && bun run typecheck` - Expected: 6 pass, 0 fail; typecheck exits 0
- [ ] Step 5: Commit - `git add src/worker/routes/backup-delete.ts src/worker/app.ts test/worker/routes/backup-delete.test.ts && git commit -m "feat: add DELETE /api/backups/:id with confirmation and latest-success guard"`

---

### Task 8: Allow `retention_dry_run` in the settings API

**Files:**
- Modify: the Phase 5 settings route file found by `grep -rln "max_concurrent_jobs" src/worker` (expected `src/worker/routes/settings.ts`; anchor: the Zod schema or allowlist that lists `max_concurrent_jobs`)
- Modify: the Phase 5 settings route test file (expected `test/worker/routes/settings.test.ts`; anchor: the existing `max_concurrent_jobs` case)

**Interfaces:**
- Consumes: Phase 5 `PUT /api/settings` and `GET /api/settings`. Their request and response shapes are NOT known at planning time. Copy the shape from the existing `max_concurrent_jobs` handling and its test. Phase 5 stores each key as a JSON string in `settings.value` (Phase 1 plan: `value` is JSON text).
- Produces: `retention_dry_run` accepted as a boolean by `PUT /api/settings` and returned by `GET /api/settings` (default `true` when absent). `retention_last_run` stays internal: a client write of it is rejected with 400.

**Steps:**
- [ ] Step 1: Open the file and add `retention_dry_run: z.boolean()` to the known-key schema next to `max_concurrent_jobs`. Add `true` as the code default wherever Phase 5 resolves defaults for `GET`. Use `RETENTION_DRY_RUN_KEY` from `src/worker/retention/config.ts` as the key constant if the file uses constants for keys. Do not add `retention_last_run`; if the schema is `.strict()` it is rejected already, otherwise make it strict.
- [ ] Step 2: Add two cases to the existing settings test file (adapt `putSettings` to the file's own request helper):
      ```ts
      it("accepts a boolean retention_dry_run and rejects other values", async () => {
        // Use the same request shape as the existing max_concurrent_jobs case in this file.
        const ok = await putSettings({ retention_dry_run: false });
        expect(ok.status).toBe(200);
        expect(await getRetentionDryRun(t.env)).toBe(false);

        const bad = await putSettings({ retention_dry_run: "no" });
        expect(bad.status).toBe(400);
      });

      it("does not let a client write the internal retention_last_run key", async () => {
        const res = await putSettings({ retention_last_run: { date: "2099-01-01", dryRun: false } });
        expect(res.status).toBe(400);
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/routes/settings.test.ts && bun run typecheck` - Expected: the file passes with exactly 2 more tests than before this task (record the count before Step 1); typecheck exits 0. If the settings test file has another name, use the path found above.
- [ ] Step 4: Commit - `git add` the two files you modified (paths found above), then `git commit -m "feat: allow retention_dry_run in the settings API"`

---

### Task 9: Run retention after a successful backup callback

**Files:**
- Create: `test/helpers/exec-ctx.ts`
- Create: `test/worker/retention/callback-helpers.ts`
- Modify: the Phase 5 callback source file (find with `grep -rn "succeeded" src/worker | grep -i callback`; expected `src/worker/jobs/callback.ts` or `src/worker/routes/internal.ts`; anchor: the branch that sets the backup row to `success`)
- Test: `test/worker/retention/callback-wiring.test.ts`
- This task exceeds the 3-file ceiling on purpose: the wiring test cannot exist without its helpers, and the commit must build.
- Modify (only if they fail with "no ExecutionContext"): Phase 5 callback tests (`grep -rl "internal/jobs/callback" test/worker`); pass `createExecutionContext()` as the 4th argument of `app.request(...)`.

**Interfaces:**
- Consumes: Phase 5 callback handler. Its internals are NOT known at planning time. Required behavior: when a `succeeded` event is applied (not for ignored or replayed events), the handler has the Hono context (or an `ExecutionContext`) and the backup's `targetId`.
- Produces:
  - `createExecutionContext(): TestExecutionContext` where `TestExecutionContext extends ExecutionContext { settled(): Promise<void> }` in `test/helpers/exec-ctx.ts`
  - `seedRunningBackup(env: Env, targetId: string, startedAt: string): Promise<{ id: string }>` and `postSucceededCallback(env: Env, ctx: ExecutionContext, backupId: string): Promise<Response>` in `test/worker/retention/callback-helpers.ts`. Copy their bodies from the Phase 5 callback test file: the first inserts a `running` row with `r2_key` and a heartbeat; the second builds a correctly signed `succeeded` payload (headers `X-Cellar-Timestamp`, `X-Cellar-Signature`, signing via `container/hmac.ts`, register X14) and calls `app.request("http://localhost/internal/jobs/callback", init, env, ctx)`.

**Gotcha:** Hono throws when a handler reads `c.executionCtx` and the test passed no context. Every Phase 5 callback test that reaches the success branch must therefore pass a context; that is why they are in the Files block. The retention call must never change the callback's response: `triggerRetentionAfterBackup` never throws, and `waitUntil` runs it after the response.

**Steps:**
- [ ] Step 1: Locate the success site: `grep -rn "succeeded" src/worker | grep -v retention` and `grep -rn "postSucceeded\|X-Cellar-Signature" test/worker`. Record the two helper names in Phase 5's tests.
- [ ] Step 2: Create `test/helpers/exec-ctx.ts`:
      ```ts
      export interface TestExecutionContext extends ExecutionContext {
        settled(): Promise<void>;
      }

      /** An ExecutionContext that records waitUntil promises so a test can await them. */
      export function createExecutionContext(): TestExecutionContext {
        const pending: Promise<unknown>[] = [];
        return {
          waitUntil(promise: Promise<unknown>) {
            pending.push(promise);
          },
          passThroughOnException() {},
          async settled() {
            await Promise.allSettled(pending);
          },
        } as unknown as TestExecutionContext;
      }
      ```
- [ ] Step 3: Edit the callback source: add the import and the `waitUntil` line (adapt `c`/`ctx` and `backup.targetId` to the file's variable names):
      ```ts
      import { triggerRetentionAfterBackup } from "../retention/triggers";

      // inside the branch that APPLIES the succeeded transition (not for ignored replays), after the D1 write, before the 200:
      c.executionCtx.waitUntil(triggerRetentionAfterBackup(c.env, backup.targetId));
      ```
- [ ] Step 4: Create `test/worker/retention/callback-helpers.ts` with the two helpers (bodies copied from Phase 5's callback tests, signatures as in Interfaces above). Create `test/worker/retention/callback-wiring.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { writeSetting } from "../../../src/worker/retention/config";
      import { createTestEnv } from "../../helpers/env";
      import { createExecutionContext } from "../../helpers/exec-ctx";
      import { backupRow, daysAgo, hasObject, seedBackup, seedTarget } from "../../helpers/retention-fixtures";
      // Both helpers below already exist in the Phase 5 callback test file (find them with the grep in Step 1).
      // Import them if exported; otherwise copy them. They insert a `running` backup row and post a correctly signed `succeeded` event.
      import { postSucceededCallback, seedRunningBackup } from "./callback-helpers";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      describe("succeeded backup callback", () => {
        it("runs retention for that target after responding, and still answers 200", async () => {
          await writeSetting(t.env, "retention_dry_run", false);
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          const running = await seedRunningBackup(t.env, targetId, daysAgo(0));
          const ctx = createExecutionContext();

          const res = await postSucceededCallback(t.env, ctx, running.id);
          expect(res.status).toBe(200);
          await ctx.settled();

          expect((await backupRow(t.env, old.id))?.deletedAt).not.toBeNull();
          expect(await hasObject(t.env, old.r2Key)).toBe(false);
          expect((await backupRow(t.env, running.id))?.status).toBe("success");
        });
      });
      ```
- [ ] Step 5: Verify - Run: `bun run test && bun run typecheck` - Expected: all tests pass, count = BASELINE_TESTS + 39 (Tasks 1-8 add 38: 4 + 5 + 5 + 7 + 5 + 4 + 6 + 2, this task adds 1); typecheck exits 0. Any Phase 5 callback test that failed only because of the missing context was fixed in Step 3's Files list.
- [ ] Step 6: Commit - `git add test/helpers/exec-ctx.ts test/worker/retention src/worker && git add -u test/worker && git commit -m "feat: run retention after a successful backup callback"`

---

### Task 10: Run retention daily from the cron

**Files:**
- Modify: `src/worker/index.ts` (anchor: `scheduled`, the handler Phase 5 added)
- Test: `test/worker/retention/cron-wiring.test.ts`
- Modify (only if needed): Phase 5 cron tests that call `worker.scheduled(...)` with a context lacking `waitUntil`.

**Interfaces:**
- Consumes: Phase 5 `scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>` in the default export of `src/worker/index.ts`; Task 5 `triggerDailyRetention(env, now)`; Task 9 `createExecutionContext()`.
- Produces: the cron runs the daily retention after Phase 5's enqueue and sweeper steps. Retention is the last step so a retention problem can never delay due backups.

**Steps:**
- [ ] Step 1: Edit `src/worker/index.ts` (adapt names to Phase 5's handler):
      ```ts
      import { triggerDailyRetention } from "./retention/triggers";

      // inside scheduled(controller, env, ctx), after the enqueue and sweeper calls:
      ctx.waitUntil(triggerDailyRetention(env, new Date(controller.scheduledTime)));
      ```
- [ ] Step 2: Create `test/worker/retention/cron-wiring.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import worker from "../../../src/worker/index";
      import { writeSetting } from "../../../src/worker/retention/config";
      import { createTestEnv } from "../../helpers/env";
      import { createExecutionContext } from "../../helpers/exec-ctx";
      import { NOW, backupRow, daysAgo, seedBackup, seedTarget } from "../../helpers/retention-fixtures";

      let t: Awaited<ReturnType<typeof createTestEnv>>;
      beforeEach(async () => {
        t = await createTestEnv();
      });
      afterEach(async () => {
        await t.dispose();
      });

      describe("scheduled handler", () => {
        it("runs the daily retention for every active target", async () => {
          await writeSetting(t.env, "retention_dry_run", false);
          const targetId = await seedTarget(t.env, { keepLast: 1 });
          const old = await seedBackup(t.env, targetId, daysAgo(3));
          await seedBackup(t.env, targetId, daysAgo(0));
          const ctx = createExecutionContext();

          await worker.scheduled?.({ scheduledTime: NOW.getTime(), cron: "* * * * *", noRetry() {} } as ScheduledController, t.env, ctx);
          await ctx.settled();

          expect((await backupRow(t.env, old.id))?.deletedAt).not.toBeNull();
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bun run test && bun run typecheck` - Expected: all tests pass, count = BASELINE_TESTS + 40; typecheck exits 0
- [ ] Step 4: Commit - `git add src/worker/index.ts test/worker/retention/cron-wiring.test.ts && git commit -m "feat: run daily retention from the cron trigger"`

---

### Task 11: Update docs/PLAN.md and finish the phase

**Files:**
- Modify: `docs/PLAN.md` (anchors listed in Step 1)

**Interfaces:**
- Consumes: the finished Phase 6 behavior.
- Produces: PLAN.md consistent with the code.

**Steps:**
- [ ] Step 1: Apply these exact edits in `docs/PLAN.md`. PLAN.md was already updated by the owner (round 2) for manual delete, `deleted_reason`, and the settings keys `max_concurrent_jobs` and `retention_dry_run`, so only the gaps below remain. Each `old` string occurs once at plan time; if one does not match, grep the anchor and adjust minimally.
      1. Section 4, old: ``| GET /api/targets/:id/retention-preview | - | `{ keep: id[], delete: id[], reasons }` no side effects |``
         new: ``| GET /api/targets/:id/retention-preview | - | `{ dryRun, keep: id[], delete: { id, startedAt, sizeBytes, reason }[], reasons }`. No side effects. `reasons` covers kept backups; each deletion has `reason: "no_rule_keeps_it"`. |``
      2. Section 4, old: ``| DELETE /api/backups/:id | `{ confirm: true }` | `204`. Success backups only. Refuses the latest success. Ignores retention dry run (explicit human action). Deletes R2 object first, then soft-deletes in D1, then writes an audit entry. |``
         new: ``| DELETE /api/backups/:id | `{ confirm: true }` | `204`. Success backups only. Refuses the latest success. Ignores retention dry run (explicit human action). Deletes R2 object first, then soft-deletes in D1 (`deleted_reason = 'manual'`), then writes audit entry `backup.delete`. Errors: `409` for the latest success or a non-success backup, `502 r2_delete_failed` if R2 fails (nothing changes). |``
      3. Section 3 `backups`, old: ``| deleted_at | text | soft delete after R2 object removed |``
         new: ``| deleted_at | text | soft delete after the R2 object is removed; used by retention and by DELETE /api/backups/:id. `status` is never changed by deletion (there is no `deleted` status) |``
         The `deleted_reason` row (`e.g. retention, manual`) already exists; leave it.
      4. Section 3 `settings`, old: ``(default `true` until the owner turns it off).`` (end of the `Keys:` line)
         new: ``(JSON boolean, default `true` until the owner turns it off; only `false` turns it off), `retention_last_run` (internal, never writable through the API: `{ "date": "YYYY-MM-DD", "dryRun": boolean }`, the local date in `default_timezone` of the last completed daily retention run).``
      5. Section 8 `Workers` row, old: `Retention runner handles a bounded number of deletes per tick.`
         new: `Retention runner deletes at most 50 backups per run (per call and per cron tick). A daily run with more work records its day only when finished, so the next minute's tick continues it.`
      6. Section 6, add one bullet at the end of its "Rules" list (after the line starting `- Orphan multipart uploads`): ``- Retention: after a successful backup callback and once per local day from the cron, `runRetention` soft-deletes expired `success` backups (R2 object first) and skips soft-deleted targets. `retention_dry_run` (default `true`) logs decisions and deletes nothing.``
- [ ] Step 2: Verify - Run: `grep -c "retention-preview" docs/PLAN.md; grep -c "retention/preview" docs/PLAN.md; grep -c "retention_dry_run" docs/PLAN.md; grep -c $'\xe2\x80\x94' docs/PLAN.md; ls migrations | wc -l` - Expected: `1`, `0`, `2` or more, `0`, and the same migration count as recorded in Preflight
- [ ] Step 3: Commit - `git add docs/PLAN.md && git commit -m "docs: update PLAN.md for the phase 6 retention runner"`
- [ ] Step 4: Run the End-to-end verification below, then output the AGENTS.md phase summary (the "Phase summary" section below, filled with real results) and stop.

---

## Failure handling summary

- **Persistent R2 outage during a live run** - Detect: `failed` entries and `retention.delete_failed` audit rows for the same ids across runs. Respond: nothing is lost, D1 rows stay `success`; the daily run records its day anyway, and the next backup callback retries. Report in the summary if seen in the end-to-end run.
- **`getPlatformProxy` R2 binding does not work with `Proxy.bind` in `failingR2`** - Detect: `put` or `head` throws "Illegal invocation" in Task 2 tests. Respond: use `Reflect.get(target, prop, target)` as described in Task 1's Gotcha, record a `> Deviation:`.
- **A Phase 2-5 export differs from this plan** - Detect: Phase gate grep shows a different name or path. Respond: STOP and report; do not guess.

## End-to-end verification

Run after Task 11. Uses the local D1 and R2 only (`--local`); nothing remote. Port 8796 is assumed free (Preflight).

- [ ] Run: `bun run test && bun run typecheck` - Expected: all pass, 0 type errors
- [ ] Run (seed local D1: one target with `keep_last 2` and every other rule NULL, five old successes; ids are fixed so the checks are exact):
      ```bash
      bun run db:migrate:local
      bunx wrangler d1 execute cellar --local --command "INSERT INTO targets (id,name,db_name,connection_url_enc,tunnel_hostname,tunnel_token_id_enc,tunnel_token_secret_enc,keep_last,keep_daily,keep_weekly,keep_monthly,max_age_days,created_at,updated_at) VALUES ('e2e-t1','e2e-target','app','v1:aa:bb','db.example.com','v1:aa:bb','v1:aa:bb',2,NULL,NULL,NULL,NULL,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"
      bunx wrangler d1 execute cellar --local --command "INSERT INTO backups (id,target_id,status,trigger,r2_key,size_bytes,queued_at,started_at,finished_at) VALUES ('e2e-b1','e2e-t1','success','manual','backups/e2e-t1/b1.dump',1,'2026-01-01T02:00:00.000Z','2026-01-01T02:00:00.000Z','2026-01-01T02:01:00.000Z'),('e2e-b2','e2e-t1','success','manual','backups/e2e-t1/b2.dump',1,'2026-01-02T02:00:00.000Z','2026-01-02T02:00:00.000Z','2026-01-02T02:01:00.000Z'),('e2e-b3','e2e-t1','success','manual','backups/e2e-t1/b3.dump',1,'2026-01-03T02:00:00.000Z','2026-01-03T02:00:00.000Z','2026-01-03T02:01:00.000Z'),('e2e-b4','e2e-t1','success','manual','backups/e2e-t1/b4.dump',1,'2026-01-04T02:00:00.000Z','2026-01-04T02:00:00.000Z','2026-01-04T02:01:00.000Z'),('e2e-b5','e2e-t1','success','manual','backups/e2e-t1/b5.dump',1,'2026-01-05T02:00:00.000Z','2026-01-05T02:00:00.000Z','2026-01-05T02:01:00.000Z')"
      echo dump > /tmp/e2e.dump
      for n in 1 2 3 4 5; do bunx wrangler r2 object put "cellar-backups/backups/e2e-t1/b$n.dump" --file /tmp/e2e.dump --local; done
      ```
      Expected: both `INSERT`s report success; five `Upload complete` lines; no output mentions `remote`. (R2 CLI flags are [uncertain]; check `bunx wrangler r2 object put --help` if a flag is rejected.)
- [ ] Manual: start the dev server in the background: `bun run dev -- --port 8796 --test-scheduled`. Check `bunx wrangler dev --help` for the exact scheduled-testing flag and URL if this one is rejected [uncertain]. Then `curl -s http://localhost:8796/api/targets/e2e-t1/retention-preview` - Expected: JSON with `"dryRun":true`, `delete` ids `e2e-b1`, `e2e-b2`, `e2e-b3` in that order, `keep` ids `e2e-b4`, `e2e-b5`.
- [ ] Manual: trigger the cron once (`curl -s "http://localhost:8796/cdn-cgi/handler/scheduled"`, path per the wrangler version [uncertain]), then `bunx wrangler d1 execute cellar --local --command "SELECT count(*) AS n FROM backups WHERE deleted_at IS NOT NULL"` - Expected: `n = 0` (dry run deletes nothing). The dev server log shows one `retention.dry_run` line listing the three ids and no password-like text.
- [ ] Manual: turn dry run off through the settings API, using the request shape of the Phase 5 settings route (for example `curl -s -X PUT http://localhost:8796/api/settings -H 'content-type: application/json' -d '{"retention_dry_run":false}'`) - Expected: HTTP 200. Trigger the cron again - Expected: the daily run happens even though a dry-run day was already recorded; then `SELECT id, deleted_reason FROM backups WHERE deleted_at IS NOT NULL ORDER BY id` returns `e2e-b1`, `e2e-b2`, `e2e-b3`, each with `deleted_reason = retention`; `bunx wrangler r2 object get cellar-backups/backups/e2e-t1/b1.dump --local --file /tmp/out.dump` fails for b1, b2, b3 and succeeds for b4, b5.
- [ ] Manual: `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:8796/api/backups/e2e-b5 -H 'content-type: application/json' -d '{"confirm":true}'` - Expected: `409` (latest success). Same for `e2e-b4` - Expected: `204`, row `deleted_reason = manual`, object gone.
- [ ] Manual: `curl -s "http://localhost:8796/api/audit-logs?entityType=backup"` - Expected: three `retention.delete` rows with `actor` `system` and one `backup.delete` row with a non-system actor, and no connection string or password in any `details`.
- [ ] Run: stop the dev server and clean up the seed: `bunx wrangler d1 execute cellar --local --command "DELETE FROM audit_logs WHERE entity_id LIKE 'e2e-%'; DELETE FROM backups WHERE target_id='e2e-t1'; DELETE FROM targets WHERE id='e2e-t1'; DELETE FROM settings WHERE key IN ('retention_dry_run','retention_last_run')"` and `rm /tmp/e2e.dump /tmp/out.dump` - Expected: success, and `git status --short` shows no tracked changes.

## What was validated

Nothing in this plan was run, and no snippet was re-run after the round 2 edits (the edits only added tunnel columns to the `seedTarget` and e2e seed SQL, and `/tmp/phase-6-scratch` does not exist). The repo has no code at the base commit, and Phases 2-5 do not exist, so no snippet could be compiled or executed. The snippets were checked by reading against the Phase 1 schema (column names, nullability, `$inferSelect` types), the register's signatures (`writeAudit`, `getZonedParts`, `selectBackupsToDelete`, `createTestEnv`, `ApiError`), and the Phase 1 `redactError` signature. Expected values in the tests were derived by hand from the Phase 3 semantics in the register (oldest-first order follows from the planner's explicit sort; Bangkok versus UTC day boundaries were computed from the UTC+7 offset).

## Phase summary (fill in at the end of execution)

- ✅ Completed: [what shipped: runRetention, triggers, preview, manual delete, settings key, docs]
- 🧪 Tests and results: [`bun run test` pass/fail counts, `bun run typecheck` result, end-to-end results]
- ⚠️ Open issues and decisions needed: no open ASK items. Reminder: dry run is ON by default (answer 18), so retention deletes nothing until the owner flips it. Plus any `> Deviation:` lines.
