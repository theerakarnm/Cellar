# Phase 2: Targets CRUD API and Audit Log Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-2-targets-crud-audit-log.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE Task 0 and report anything down.
> Every code block below was run in a scratch project (`/tmp/phase-2-scratch`) built from the Phase 1 plan's code, but not in this repo.
> When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Build the targets CRUD API (`GET/POST /api/targets`, `GET/PATCH/DELETE /api/targets/:id`) with encrypted secrets, a computed `next_run_at`, and an audit log (`GET /api/audit-logs`), plus the shared building blocks later phases import (UUIDv7, time zone and cron helpers, error handling, validation, pagination, audit helper, DB client, D1/R2/Queue test harness).
**Architecture:** Zod schemas live in `src/shared/` so the UI can reuse them. Hono routes in `src/worker/routes/` stay thin and call services in `src/worker/services/`. Services read and write D1 through Drizzle. A mutation and its audit row go into one `db.batch`, so both commit or neither does. Secrets are encrypted with the Phase 1 `encrypt` before insert and never leave `toTargetView`.
**Tech Stack:** Bun, TypeScript (strict, `noUncheckedIndexedAccess`), Hono, Zod 4, Drizzle ORM on D1, Vitest with `getPlatformProxy` from `wrangler` for local D1/R2/Queue bindings.
**Spec:** `docs/plans/prds/phase-2.md`, resolved by `docs/plans/2026-10-24-phases-2-10-decisions.md` (section "Phase 2", X1 to X12, and "Owner answers, round 2", which is binding) and `docs/PLAN.md` sections 3 and 4.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD` at planning time). The tree holds only docs and the Phase 1 plan. Phase 1 code does NOT exist yet, so every file this plan modifies or imports is cited from `docs/plans/2026-10-24-phase-1-foundation.md` (planned, not yet in tree).
**Confidence:** 8/10. Rubric: start 10; minus 2 once for anchors in files that do not exist yet (register item X18); no other deduction applies (every Consumes entry below has a full signature, no schema change, no Human check, every Preflight command was run in the scratch project). Evidence: in `/tmp/phase-2-scratch` (Phase 1 files extracted verbatim from the Phase 1 plan, then this plan's files added task by task) the full suite passed (18 files, 152 tests), `tsc --noEmit` was clean after every task, and a `wrangler dev --local` run answered the curl checks in "End-to-end verification" as written. The round 2 edits (tunnel only, `alertFailureThreshold`, name reuse) were applied after that run and keep the totals at 18 files and 152 tests; they were not re-run in scratch. Residual risk: dependency versions drift (`bun add` resolves latest), and the Worker runtime (workerd) was only exercised through `getPlatformProxy` and `wrangler dev`, not a deployed Worker.
**NOT building:**
- Test connection, Backup now, queue consumers, cron handler, container: Phases 4 and 5.
- `GET /api/me` (PLAN section 4): not in this phase (register).
- Alert channel CRUD: Phase 8. This phase only reads `alert_channels` to validate ids and links them in `target_alert_channels`.
- UI: Phase 9.
- Direct connection mode: removed by the owner (round 2, answer 1). Tunnel only.
- A separate alert-settings endpoint: the failure threshold is a target field set in create and update (round 2, answer 22).
- A latest-backup object on `GET /api/targets/:id` (PLAN says "+ latest backup"): `lastStatus`, `lastBackupAt`, and `stats` cover it; backups API is Phase 5.
- Any D1 migration. The Phase 1 schema already has every column and table used here.
- Retention execution, GFS selection: Phases 3 and 6.
- Any remote command: no `wrangler deploy`, no `--remote`, no `db:migrate:remote`, no Cloudflare resources.
- Audit rows for rejected requests (validation failures, 404, 409). Only successful create, update, and delete are audited.

## Phase gate

Run before Task 0. If any file or result differs, STOP and report: Phase 1 moved.

- [ ] Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  3 passed (3)` and `Tests  43 passed (43)`; typecheck exits 0 with no output
- [ ] Run: `for f in src/worker/app.ts src/worker/env.ts src/worker/index.ts src/worker/middleware/access.ts src/worker/lib/crypto.ts src/worker/lib/redact.ts src/worker/db/schema.ts migrations/0000_init.sql wrangler.jsonc vitest.config.ts drizzle.config.ts .dev.vars.example; do test -f $f && echo ok $f || echo MISSING $f; done` - Expected: twelve lines, all starting with `ok`
- [ ] Run: `grep -c "export async function encrypt\|export async function decrypt\|export function redactSecrets\|export function redactError\|export const REDACTED" src/worker/lib/crypto.ts src/worker/lib/redact.ts` - Expected: `src/worker/lib/crypto.ts:2` and `src/worker/lib/redact.ts:3`
- [ ] Run: `grep -c "export const targets\|export const backups\|export const alertChannels\|export const targetAlertChannels\|export const auditLogs" src/worker/db/schema.ts` - Expected: `5`

## Decisions that differ from the PRD / docs/PLAN.md

Precedence is AGENTS.md, then PLAN.md owner answers, then the PRD, then the register. Task 16 updates PLAN.md to match.

1. **Request shape follows PLAN.md section 4** (camelCase, nested `tunnel` and `retention`), not the PRD's snake_case prose: `{ name, projectTag?, connectionUrl, restoreUrl?, tunnel: { hostname, tokenId, tokenSecret }, scheduleCron?, timezone?, retention?: { keepLast?, daily?, weekly?, monthly?, maxAgeDays? }, jobDeadlineMinutes?, staleAfterHours?, alertFailureThreshold?, enabled?, alertChannelIds? }`. `dbName` is no longer a request field (register); the schema is `.strict()`, so sending it is a 400.
2. **`GET /api/targets` is paginated** (`?limit&cursor`, sorted by `name`), per X7. PLAN.md showed `{ items }` only.
3. **Audit helper is `src/worker/lib/audit.ts`** (X10), not `middleware/audit.ts`. It exports `writeAudit` (the X10 signature) and one extra, `auditInsert`, which returns the insert statement so services can commit it inside the same `db.batch` as the change. Without it a failed audit write would leave an unaudited change.
4. **Audit route file is `routes/audit-logs.ts`** (PLAN.md listed `routes/audit.ts`).
5. **`PATCH` rules.** Omitted secret fields keep the stored ciphertext byte for byte. `restoreUrl: null` and `projectTag: null` clear. `retention` merges field by field (`null` turns a rule off). `tunnel` accepts any subset of `hostname`, `tokenId`, `tokenSecret`; omitted parts keep the stored values. Connection mode is tunnel only (owner round 2), so there is no mode switch. An empty body is 400. `alertChannelIds` replaces the set when present and is untouched when absent.
6. **`next_run_at`** is recomputed only when `scheduleCron`, `timezone`, or `enabled` ends up different from the stored value. It is `null` when disabled. Renaming a target does not move it.
7. **A soft-deleted target's name can be reused** (owner round 2, answer 3). Phase 1's `uq_targets_name` is partial (`WHERE deleted_at IS NULL`), so the name check only looks at live targets. A live duplicate returns 409.
8. **Input bounds I chose** (not in any source): keep counts 0 to 10000 or `null`; `maxAgeDays` 1 to 36500 or `null`; `jobDeadlineMinutes` 5 to 1440; `staleAfterHours` 1 to 8760 or `null`; `alertFailureThreshold` 1 to 100 (default 3); name up to 100 chars; project tag up to 50; at most 50 alert channel ids. No minimum cron interval is enforced.
9. **Cron grammar** is numeric only: `*`, lists, ranges, steps, day-of-week 0 or 7 for Sunday. No month or weekday names, no `@daily`, no `?`. When both day-of-month and day-of-week are restricted, either may match (standard cron). A wall time inside a DST gap runs just after the gap. A wall time that happens twice runs once, at its first occurrence.
10. **Time zone validation** accepts names `Intl.DateTimeFormat` accepts and rejects offsets such as `+07:00`. Case-insensitive spellings such as `asia/bangkok` pass (the runtime accepts them) and are stored as typed.
11. **Test infrastructure.** `vitest.config.ts` (Phase 1 file) gets `testTimeout` and `hookTimeout` of 30 s because each test file starts a local workerd. The test env helper reads `migrations/*.sql` through Vite's `import.meta.glob` with `/// <reference types="vite/client" />`, because `@types/node` is not a dependency. `vite` is already installed as a dependency of `vitest`.
12. **Connection info on every read** decrypts the stored URL (`toTargetView`) to expose `host`, `port`, `dbName`, `user`. One AES-GCM decrypt per target per request; fine at this scale.
13. **Stats are computed without an `IN (...)` list** (one `GROUP BY` over successful, not-deleted backups), so D1's 100 bound-parameter limit cannot be hit by a page of 200 targets.

## ASK: needs the owner's confirmation before execution

None open. "Owner answers, round 2" in `docs/plans/2026-10-24-phases-2-10-decisions.md` closed all three:
- **Q-direct: closed.** Direct mode is removed (answer 1). Tunnel only, no `connectionMode` field, tunnel fields required.
- **Q-stats: closed.** `stats: { backupCount, totalBackupBytes }` is approved (answer 4), counting only non-deleted success backups.
- **Q-name: closed.** Name reuse after a soft delete is allowed through Phase 1's partial unique index (answer 3).

## Global Constraints

- TypeScript everywhere; Bun is the package manager; `bun run test` runs Vitest. Strict TypeScript with `noUncheckedIndexedAccess`.
- Worker is Hono on Cloudflare Workers; D1 + Drizzle ORM; migrations live in `/migrations` (none added in this phase).
- Zod validates every API input (body and query). Failures are `400` `{ "error": { "code": "validation_error", "message": "Invalid request", "details": [{ "path", "message" }] } }`. Details carry field paths and rule messages only, never submitted values.
- Error body shape: `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Not found is 404 `not_found`, conflict is 409 `conflict`, unknown errors are 500 `internal_error` with a redacted message.
- Every `/api/*` route except `GET /api/health` sits behind the Access middleware. Mount new routers AFTER `app.use("/api/*", access())` in `src/worker/app.ts`.
- Connection URLs, tunnel token ids and secrets are encrypted at rest with AES-256-GCM via `encrypt(plaintext, env.ENCRYPTION_KEY)`. Never return them in plaintext, never log them, never put them in audit details. Responses show `connection: { host, port, dbName, user }`, `hasRestoreUrl`, `hasTunnelToken`, and no `*_enc` field.
- Redact connection strings and passwords from logs, errors, API responses, and audit details (`redactSecrets`, `redactError`).
- All ids are UUIDv7 from `src/worker/lib/uuidv7.ts`; all times are UTC ISO-8601 text; column names are `snake_case`.
- Lists use `?limit` (default 50, max 200) and `?cursor` (opaque base64url of the last sort key) and return `{ items, nextCursor: string | null }`.
- Defaults when omitted (owner answers): schedule `0 2 * * *`, timezone `Asia/Bangkok`, retention keep_last 3 / daily 7 / weekly 4 / monthly 6 / max_age_days null, `job_deadline_minutes` 120.
- Delete is a soft delete: set `deleted_at`, `enabled` false, `next_run_at` null. Backups and R2 stay untouched.
- Every successful create, update, and delete writes an `audit_logs` row with the Access email as actor (`target.create`, `target.update`, `target.delete`).
- D1 allows 100 bound parameters per statement: never build an `IN (...)` list from unbounded input.
- No dependency beyond `zod` (listed in AGENTS.md). Never run `db:migrate:remote`, `deploy`, or any `wrangler` command without `--local`.
- If the same step fails 3 times, stop and report what you tried.
- No em dash in any file you write. Use a plain dash. Do not add the agent as co-author in commit messages.

## Patterns to Mirror

All sources are from the Phase 1 plan (planned, not yet in tree). Phase 1 establishes the conventions; this phase follows them.

### Naming
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, "Patterns to Mirror" and Task 4 (schema.ts) -->
Files are `kebab-case.ts`. Drizzle tables are plural `snake_case` SQL names with `camelCase` properties; indexes are `idx_<table>_<what>`, unique `uq_<table>_<what>`.
```ts
dbName: text("db_name").notNull(),
uniqueIndex("uq_targets_name").on(t.name),
```

### Error handling
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, Task 5 (access.ts) -->
Short reason codes in logs, a generic body for the client, never the token or a claim.
```ts
function unauthorized(reason: string): Response {
  console.warn(`access: rejected (${reason})`);
  return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
}
```

### Tests
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, Task 5 (access.test.ts) and "Patterns to Mirror" -->
Vitest in Node, files at `test/worker/<mirrors src/worker path>.test.ts`, Hono apps tested with `app.request(url, init, env)`. Phase 2 adds `test/shared/` for `src/shared/`.

### Hono app wiring
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, Task 5 (app.ts) -->
```ts
export const app = new Hono<AppEnv>();

// Registration order matters: /api/health must be registered before the Access middleware.
app.get("/api/health", (c) => c.json({ ok: true, version: pkg.version }));
app.use("/api/*", access());
```

### Produces from Phase 1 that this plan consumes (full signatures)
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, Tasks 1 to 5 -->
- `interface Env { DB: D1Database; BACKUPS: R2Bucket; JOBS: Queue; ENCRYPTION_KEY: string; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; DEV_BYPASS?: string }` in `src/worker/env.ts`
- `type AppEnv = { Bindings: Env; Variables: { actorEmail: string } }` and `access(): MiddlewareHandler<AppEnv>` in `src/worker/middleware/access.ts`
- `app: Hono<AppEnv>` in `src/worker/app.ts`
- `encrypt(plaintext: string, keyBase64: string): Promise<string>` and `decrypt(payload: string, keyBase64: string): Promise<string>` in `src/worker/lib/crypto.ts`
- `redactSecrets(input: string): string`, `redactError(error: unknown): string`, `REDACTED` in `src/worker/lib/redact.ts`
- Drizzle tables `targets`, `backups`, `alertChannels`, `targetAlertChannels`, `auditLogs` (and `restores`, `settings`) in `src/worker/db/schema.ts`
- With `DEV_BYPASS` set to `"true"` and a request host of `localhost`, `access()` sets `actorEmail` to `dev@localhost`.

## Preflight

### DURABLE - true until the repo itself changes

- **Phase 1 interfaces are as listed above.** Evidence: the Phase gate greps and `test -f` list. The scratch project built from the Phase 1 plan code passes `tsc --noEmit` and its 43 tests.
- **No migration is needed.** Evidence: Phase 1 Task 4 schema contains every column used here (`project_tag`, NOT NULL tunnel columns, `alert_failure_threshold` NOT NULL DEFAULT 3, the partial `uq_targets_name` index, `target_alert_channels`, `audit_logs`; no `connection_mode`, per register X3). Consequence: do not run `bun run db:generate` in this phase.
- **`getPlatformProxy` gives working in-memory D1, R2, and Queue bindings inside Vitest (Node).** Evidence: in scratch, `test/helpers/env.test.ts` (3 tests) passed: migrations applied, R2 put/get worked, `JOBS.send` resolved, `resetDb` emptied tables.
- **Hono `app.request(url, init, env)` runs the full middleware chain.** Evidence: scratch route tests for 401 (DEV_BYPASS off) and 201 (DEV_BYPASS on) passed.

### PERISHABLE - recapture before Task 0

- **Bun and Node.** Check: `bun --version && node --version` - Expected: Bun `1.3.x`, Node `20` or newer (planning run: 1.3.5 and v22.19.0). Needed by: every task.
- **Git state.** Check: `git status --short && git branch --show-current` - Expected: clean tree on the branch that contains Phase 1 (or only this plan file untracked). Needed by: Task 0.
- **Dependencies installed.** Check: `test -d node_modules && bun run typecheck` exits 0. Needed by: every task.
- **workerd can start locally** (used by `getPlatformProxy`). Check: `bunx wrangler --version` prints a version, then Task 4's verify. If Task 4 fails with a workerd or binary error, STOP and report.
- **Free port 8799** for the end-to-end run. Check: `lsof -i :8799` - Expected: no output. If used, pick another port and use it in every end-to-end command.
- **Dependency versions** resolved at planning time (informational; `bun.lock` is the source after Task 1): zod 4.6.x, vitest 5.0.x. If `bun add zod` resolves a new major version, run the verifies anyway and record a deviation if the reference code no longer compiles.
- **Baseline red count.** Check: the Phase gate first item - Expected: 0 failing tests, 0 type errors, 43 tests in 3 files. No lint script exists.
- **Secrets.** None needed. Tests use fixed fake values; the end-to-end run uses a throwaway gitignored `.dev.vars` with fake values.

## Execution

**Tracks:** one track, sequential (`plan:phase-2:track-a`), Tasks 0 to 16. Parallel tracks would be below the cost floor (every task depends on the one before it or on shared files such as `src/worker/app.ts`).
**Merge order:** not applicable (single track).
**Shared files:** `package.json` and `bun.lock` are owned by Task 1 only. `vitest.config.ts` by Task 4 only. `src/worker/app.ts` by Tasks 11 and 15. `src/worker/services/targets.ts` and `src/worker/routes/targets.ts` are created in Task 11 and extended in Tasks 12 to 14 (each task replaces or appends exactly what its steps say). `docs/PLAN.md` by Task 16 only. There are no migrations and no `.dev.vars.example` change.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch from the commit that contains Phase 1: `git switch -c phase-2-targets-crud-audit-log`.
**treehouse:** installed at `/Users/jametirakarn/.local/bin/treehouse` per the Phase 1 plan; not needed for a single track.
**Task size note:** Tasks 4 and 11 touch four files and Task 1 includes the lockfile. Task 4's `test/helpers/api.ts` is test infrastructure used by Tasks 11 to 15. Task 11 cannot be smaller because registering the first route edits `app.ts`.

---
### Task 0: Branch and commit this plan

**Files:**
- Commit only: `docs/plans/2026-10-24-phase-2-targets-crud-audit-log.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean base so later diffs show only Phase 2 work.

**Steps:**
- [ ] Step 1: Create the branch from the commit that contains Phase 1: `git switch -c phase-2-targets-crud-audit-log`
- [ ] Step 2: Commit exactly this file (not `git add -A`; the register and PRDs stay as the owner left them): `git add docs/plans/2026-10-24-phase-2-targets-crud-audit-log.md && git commit -m "docs: add phase 2 plan"`
- [ ] Verify - Run: `git status --short | grep -c 'phase-2-targets'` - Expected: `0` (the plan file is committed; other untracked files may still be listed)

---
### Task 1: Add `zod` and the UUIDv7 generator

**Files:**
- Modify: `package.json`, `bun.lock` (emitted by `bun add`)
- Create: `src/worker/lib/uuidv7.ts`
- Test: `test/worker/lib/uuidv7.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `uuidv7(now?: number): string` in `src/worker/lib/uuidv7.ts` - `now` is unix milliseconds (default `Date.now()`); returns a lowercase 36-char UUID with version 7 and variant `10` bits. IDs created in the same millisecond differ (74 random bits); IDs from different milliseconds sort by time as plain text.

**Gotcha:** `zod` is listed in AGENTS.md "Stack (locked)", so adding it needs no approval. Run only the one `bun add` below.

**Steps:**
- [ ] Step 1: Install: `bun add zod`
- [ ] Step 2: Create `src/worker/lib/uuidv7.ts`:
```ts
/** UUIDv7 (RFC 9562): 48-bit unix ms timestamp, version 7, variant 10, 74 random bits. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

- [ ] Step 3: Create `test/worker/lib/uuidv7.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { uuidv7 } from "../../../src/worker/lib/uuidv7";

describe("uuidv7", () => {
  it("has the version 7 and variant 10 bits", () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const ms = Date.UTC(2026, 9, 24, 12, 0, 0);
    const id = uuidv7(ms);
    expect(Number.parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(ms);
  });

  it("sorts by time as plain text", () => {
    const ids = [1000, 2000, 3000].map((ms) => uuidv7(ms));
    expect([...ids].reverse().sort()).toEqual(ids);
  });

  it("is unique across many calls in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1_700_000_000_000)));
    expect(ids.size).toBe(1000);
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  4 passed (4)` and `Tests  47 passed (47)` (43 from Phase 1 + 4 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add package.json bun.lock src/worker/lib/uuidv7.ts test/worker/lib/uuidv7.test.ts && git commit -m "feat: add zod and UUIDv7 generator"`

---
### Task 2: Time zone helpers

**Files:**
- Create: `src/shared/tz.ts`
- Test: `test/shared/tz.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (X9), imported by Task 3 and by Phase 3:
  - `type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }` (weekday 1 = Monday to 7 = Sunday)
  - `type WallTime = Omit<ZonedParts, "weekday">`
  - `isValidTimeZone(tz: string): boolean`
  - `getZonedParts(date: Date, tz: string): ZonedParts`
  - `zonedTimeToUtc(wall: WallTime, tz: string): Date` - normal time: the matching instant; overlap (wall time happens twice): the EARLIER instant; gap (wall time does not exist): the wall time read with the offset in force before the gap, so 02:30 becomes 03:30 local.

**Gotcha:** `Intl.DateTimeFormat` with `hourCycle: "h23"` returns hour `0` at midnight (the older `hour12: false` returns `24` in some engines). Formatters are cached per zone. Expected values in the tests were cross-checked with Python `zoneinfo` while planning (Bangkok 02:00 on 2026-10-25 is `2026-10-24T19:00:00Z`; New York 2026-03-08 and 2026-11-01 transitions).

**Steps:**
- [ ] Step 1: Create `src/shared/tz.ts`:
```ts
export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday. */
  weekday: number;
};

export type WallTime = Omit<ZonedParts, "weekday">;

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

/** True for IANA names such as "Asia/Bangkok" and "UTC". Offsets such as "+07:00" are rejected. */
export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `date` in `tz`. */
export function getZonedParts(date: Date, tz: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(tz).formatToParts(date)) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAYS[values.weekday ?? ""] ?? 0,
  };
}

function offsetMs(instantMs: number, tz: string): number {
  const p = getZonedParts(new Date(instantMs), tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Converts a local wall time in `tz` to an instant.
 * - Normal time: the single matching instant.
 * - Overlap (clocks go back, the wall time happens twice): the EARLIER instant.
 * - Gap (clocks go forward, the wall time does not exist): the wall time is read with the offset in force
 *   before the gap, so the result lands after the gap (02:30 becomes 03:30 when 02:00 jumps to 03:00).
 */
export function zonedTimeToUtc(wall: WallTime, tz: string): Date {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const before = offsetMs(guess - DAY_MS, tz);
  const after = offsetMs(guess + DAY_MS, tz);
  const matches = (instant: number): boolean => {
    const p = getZonedParts(new Date(instant), tz);
    return (
      p.year === wall.year &&
      p.month === wall.month &&
      p.day === wall.day &&
      p.hour === wall.hour &&
      p.minute === wall.minute &&
      p.second === wall.second
    );
  };
  const valid = [guess - before, guess - after].filter(matches);
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(guess - before);
}
```

- [ ] Step 2: Create `test/shared/tz.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getZonedParts, isValidTimeZone, zonedTimeToUtc } from "../../src/shared/tz";

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    for (const tz of ["Asia/Bangkok", "UTC", "America/New_York", "America/Argentina/Buenos_Aires"]) {
      expect(isValidTimeZone(tz), tz).toBe(true);
    }
  });

  it("rejects unknown names, offsets, and padding", () => {
    for (const tz of ["", "Mars/Base", "+07:00", "Asia/Bangkok ", "GMT+7x", "../etc"]) {
      expect(isValidTimeZone(tz), tz).toBe(false);
    }
  });
});

describe("getZonedParts", () => {
  it("reads Bangkok wall time (UTC+7) and weekday", () => {
    expect(getZonedParts(new Date("2026-10-24T19:30:15Z"), "Asia/Bangkok")).toEqual({
      year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 15, weekday: 7,
    });
  });

  it("returns hour 0 (not 24) at local midnight", () => {
    expect(getZonedParts(new Date("2026-10-24T17:00:00Z"), "Asia/Bangkok").hour).toBe(0);
  });

  it("maps Monday to 1 and Sunday to 7", () => {
    expect(getZonedParts(new Date("2026-10-26T12:00:00Z"), "UTC").weekday).toBe(1);
    expect(getZonedParts(new Date("2026-10-25T12:00:00Z"), "UTC").weekday).toBe(7);
  });
});

describe("zonedTimeToUtc", () => {
  const wall = (year: number, month: number, day: number, hour: number, minute: number) => ({
    year, month, day, hour, minute, second: 0,
  });

  it("converts a normal wall time", () => {
    expect(zonedTimeToUtc(wall(2026, 10, 25, 2, 0), "Asia/Bangkok").toISOString()).toBe("2026-10-24T19:00:00.000Z");
    expect(zonedTimeToUtc(wall(2026, 7, 1, 12, 0), "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });

  it("moves a wall time inside a DST gap to just after the gap", () => {
    expect(zonedTimeToUtc(wall(2026, 3, 8, 2, 30), "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("picks the first occurrence of a wall time that happens twice", () => {
    expect(zonedTimeToUtc(wall(2026, 11, 1, 1, 30), "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("roundtrips through getZonedParts", () => {
    const instant = new Date("2026-02-14T03:04:05Z");
    const p = getZonedParts(instant, "Europe/London");
    expect(zonedTimeToUtc(p, "Europe/London").toISOString()).toBe(instant.toISOString());
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  5 passed (5)` and `Tests  56 passed (56)` (47 + 9 new); typecheck exits 0 with no output
- [ ] Step 4: Commit - `git add src/shared/tz.ts test/shared/tz.test.ts && git commit -m "feat: add time zone helpers"`

---
### Task 3: Cron helpers

**Files:**
- Create: `src/shared/cron.ts`
- Test: `test/shared/cron.test.ts`

**Interfaces:**
- Consumes: `getZonedParts(date: Date, tz: string): ZonedParts` and `zonedTimeToUtc(wall: WallTime, tz: string): Date` from `src/shared/tz.ts` (Task 2).
- Produces (X9), imported by Tasks 9 and 11 and by Phases 5 and 8:
  - `validateCron(expr: string): string | null` - error message, or `null` when valid. Returns `"cron never matches a real date"` for `0 0 31 2 *`.
  - `nextRun(expr: string, tz: string, after: Date): Date` - first run strictly after `after`; throws `Error` for an invalid expression.
  - `approxIntervalMs(expr: string, tz: string, after: Date): number` - gap between the next two runs.

**Gotcha:**
- The search is calendar arithmetic on wall time (no time zone), then `zonedTimeToUtc`. If the converted instant is not after `after` (second pass of a repeated hour), the search continues from the next minute. So a frequent job runs each wall time once and skips the repeated hour (see the `*/30` test).
- A leading `*` means "not restricted" for the day-of-month versus day-of-week OR rule, so `*/2` counts as unrestricted.
- The search window is 9 years (covers Feb 29 across a skipped leap year such as 2100).
- The doc comment writes the step syntax as `*\/15` because a bare `*` followed by `/` would end the comment. Keep it.

**Steps:**
- [ ] Step 1: Create `src/shared/cron.ts`:
```ts
import { getZonedParts, zonedTimeToUtc } from "./tz";

type Field = { name: string; min: number; max: number };

const FIELDS: Field[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

type ParsedCron = {
  minutes: number[];
  hours: number[];
  daysOfMonth: Set<number>;
  months: Set<number>;
  /** 0 = Sunday ... 6 = Saturday (7 is folded into 0). */
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
};

const SEARCH_DAYS = 366 * 9;

function parseField(text: string, field: Field): number[] | string {
  const values = new Set<number>();
  for (const item of text.split(",")) {
    const [rangePart = "", stepPart, extra] = item.split("/");
    if (rangePart === "" || extra !== undefined) return `invalid ${field.name} field "${text}"`;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) < 1) return `invalid step in ${field.name} field "${text}"`;
      step = Number(stepPart);
    }
    let from: number;
    let to: number;
    if (rangePart === "*") {
      from = field.min;
      to = field.name === "day-of-week" ? 6 : field.max;
    } else {
      const match = /^(\d+)(?:-(\d+))?$/.exec(rangePart);
      if (!match) return `invalid ${field.name} field "${text}"`;
      from = Number(match[1]);
      to = match[2] === undefined ? (stepPart === undefined ? from : field.max) : Number(match[2]);
    }
    if (from < field.min || to > field.max || from > to) {
      return `${field.name} must be between ${field.min} and ${field.max} (got "${item}")`;
    }
    for (let value = from; value <= to; value += step) values.add(field.name === "day-of-week" && value === 7 ? 0 : value);
  }
  return [...values].sort((a, b) => a - b);
}

function parse(expr: string): ParsedCron | string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "cron must have 5 fields: minute hour day-of-month month day-of-week";
  const parsed: number[][] = [];
  for (const [index, field] of FIELDS.entries()) {
    const result = parseField(parts[index] ?? "", field);
    if (typeof result === "string") return result;
    parsed.push(result);
  }
  return {
    minutes: parsed[0] ?? [],
    hours: parsed[1] ?? [],
    daysOfMonth: new Set(parsed[2]),
    months: new Set(parsed[3]),
    daysOfWeek: new Set(parsed[4]),
    domRestricted: !(parts[2] ?? "").startsWith("*"),
    dowRestricted: !(parts[4] ?? "").startsWith("*"),
  };
}

function dayMatches(cron: ParsedCron, date: Date): boolean {
  if (!cron.months.has(date.getUTCMonth() + 1)) return false;
  const domOk = cron.daysOfMonth.has(date.getUTCDate());
  const dowOk = cron.daysOfWeek.has(date.getUTCDay());
  if (cron.domRestricted && cron.dowRestricted) return domOk || dowOk;
  return domOk && dowOk;
}

type Naive = { year: number; month: number; day: number; hour: number; minute: number };

/** First wall time at or after `start` (calendar arithmetic only, no time zone) that matches. */
function nextNaive(cron: ParsedCron, start: Naive): Naive | null {
  for (let offset = 0; offset <= SEARCH_DAYS; offset++) {
    const date = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
    if (!dayMatches(cron, date)) continue;
    for (const hour of cron.hours) {
      if (offset === 0 && hour < start.hour) continue;
      for (const minute of cron.minutes) {
        if (offset === 0 && hour === start.hour && minute < start.minute) continue;
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute };
      }
    }
  }
  return null;
}

/**
 * Returns an error message, or null when `expr` is a usable 5-field cron expression.
 * Supported: `*`, lists `1,2`, ranges `1-5`, steps `*\/15` and `1-30/5`, numeric values only.
 * Day-of-week 0 and 7 are Sunday. When both day-of-month and day-of-week are restricted, either may match.
 */
export function validateCron(expr: string): string | null {
  const cron = parse(expr);
  if (typeof cron === "string") return cron;
  const start = new Date(Date.UTC(2026, 0, 1));
  const first = nextNaive(cron, {
    year: start.getUTCFullYear(),
    month: start.getUTCMonth() + 1,
    day: start.getUTCDate(),
    hour: 0,
    minute: 0,
  });
  return first ? null : "cron never matches a real date";
}

/**
 * The first run strictly after `after`, evaluating the expression in the wall clock of `tz`.
 * DST: a wall time that does not exist runs just after the gap (02:30 becomes 03:30).
 * A wall time that happens twice runs once, at its first occurrence.
 * Throws if `expr` is invalid (call `validateCron` first).
 */
export function nextRun(expr: string, tz: string, after: Date): Date {
  const cron = parse(expr);
  if (typeof cron === "string") throw new Error(cron);
  const p = getZonedParts(after, tz);
  let cursor = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) + 60_000);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const naive = nextNaive(cron, {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
      hour: cursor.getUTCHours(),
      minute: cursor.getUTCMinutes(),
    });
    if (!naive) throw new Error("cron never matches a real date");
    const instant = zonedTimeToUtc({ ...naive, second: 0 }, tz);
    if (instant.getTime() > after.getTime()) return instant;
    cursor = new Date(Date.UTC(naive.year, naive.month - 1, naive.day, naive.hour, naive.minute) + 60_000);
  }
  throw new Error("could not find the next run");
}

/** Milliseconds between the next two runs after `after`. */
export function approxIntervalMs(expr: string, tz: string, after: Date): number {
  const first = nextRun(expr, tz, after);
  return nextRun(expr, tz, first).getTime() - first.getTime();
}
```

- [ ] Step 2: Create `test/shared/cron.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { approxIntervalMs, nextRun, validateCron } from "../../src/shared/cron";

const iso = (expr: string, tz: string, after: string) => nextRun(expr, tz, new Date(after)).toISOString();

describe("validateCron", () => {
  it("accepts common expressions", () => {
    for (const expr of ["0 2 * * *", "*/15 * * * *", "0 9 * * 1-5", "30 1,13 * * *", "0 0 1 */2 *", "5-30/5 * * * *", "0 0 * * 7"]) {
      expect(validateCron(expr), expr).toBeNull();
    }
  });

  it("rejects bad expressions with a message", () => {
    for (const expr of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8",
      "*/0 * * * *", "5-1 * * * *", "@daily", "a b c d e", "1,,2 * * * *", "*/5/2 * * * *"]) {
      expect(validateCron(expr), expr).toEqual(expect.any(String));
    }
  });

  it("rejects an expression that never matches a real date", () => {
    expect(validateCron("0 0 31 2 *")).toBe("cron never matches a real date");
  });
});

describe("nextRun", () => {
  it("Asia/Bangkok: daily 02:00 local is 19:00 UTC the day before", () => {
    expect(iso("0 2 * * *", "Asia/Bangkok", "2026-10-24T00:00:00Z")).toBe("2026-10-24T19:00:00.000Z");
  });

  it("UTC: daily 02:00", () => {
    expect(iso("0 2 * * *", "UTC", "2026-10-24T01:30:00Z")).toBe("2026-10-24T02:00:00.000Z");
  });

  it("is strictly after: a run exactly at `after` moves to the next day", () => {
    expect(iso("0 2 * * *", "UTC", "2026-10-24T02:00:00Z")).toBe("2026-10-25T02:00:00.000Z");
    expect(iso("0 2 * * *", "UTC", "2026-10-24T02:00:00.001Z")).toBe("2026-10-25T02:00:00.000Z");
  });

  it("handles steps and ranges", () => {
    expect(iso("*/15 * * * *", "UTC", "2026-10-24T10:07:30Z")).toBe("2026-10-24T10:15:00.000Z");
    expect(iso("0 9 * * 1-5", "Asia/Bangkok", "2026-10-24T00:00:00Z")).toBe("2026-10-26T02:00:00.000Z");
  });

  it("treats day-of-week 0 and 7 as Sunday", () => {
    expect(iso("0 0 * * 0", "UTC", "2026-10-24T00:00:00Z")).toBe("2026-10-25T00:00:00.000Z");
    expect(iso("0 0 * * 7", "UTC", "2026-10-24T00:00:00Z")).toBe("2026-10-25T00:00:00.000Z");
  });

  it("matches day-of-month OR day-of-week when both are restricted", () => {
    expect(iso("0 0 28 * 1", "UTC", "2026-10-24T00:00:00Z")).toBe("2026-10-26T00:00:00.000Z");
    expect(iso("0 0 28 * 1", "UTC", "2026-10-26T00:00:00Z")).toBe("2026-10-28T00:00:00.000Z");
  });

  it("rolls over month and year, and finds Feb 29", () => {
    expect(iso("0 0 1 1 *", "UTC", "2026-10-24T00:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
    expect(iso("0 0 29 2 *", "UTC", "2026-10-24T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  it("DST gap: 02:30 America/New_York on 2026-03-08 runs at 03:30 local", () => {
    expect(iso("30 2 * * *", "America/New_York", "2026-03-07T12:00:00Z")).toBe("2026-03-08T07:30:00.000Z");
    expect(iso("30 2 * * *", "America/New_York", "2026-03-08T07:30:00Z")).toBe("2026-03-09T06:30:00.000Z");
  });

  it("DST overlap: 01:30 America/New_York on 2026-11-01 runs once, at the first occurrence", () => {
    expect(iso("30 1 * * *", "America/New_York", "2026-10-31T12:00:00Z")).toBe("2026-11-01T05:30:00.000Z");
    expect(iso("30 1 * * *", "America/New_York", "2026-11-01T05:30:00Z")).toBe("2026-11-02T06:30:00.000Z");
    expect(iso("30 1 * * *", "America/New_York", "2026-11-01T05:45:00Z")).toBe("2026-11-02T06:30:00.000Z");
  });

  it("DST overlap: a frequent job runs each wall time once, so the repeated hour is not run twice", () => {
    expect(iso("*/30 * * * *", "America/New_York", "2026-11-01T05:45:00Z")).toBe("2026-11-01T07:00:00.000Z");
    expect(iso("*/30 * * * *", "America/New_York", "2026-11-01T06:15:00Z")).toBe("2026-11-01T07:00:00.000Z");
  });

  it("throws on an invalid expression", () => {
    expect(() => nextRun("bad", "UTC", new Date())).toThrow();
  });
});

describe("approxIntervalMs", () => {
  it("is 24 hours for a daily job and 1 hour for an hourly job", () => {
    expect(approxIntervalMs("0 2 * * *", "Asia/Bangkok", new Date("2026-10-24T00:00:00Z"))).toBe(24 * 3600_000);
    expect(approxIntervalMs("0 * * * *", "UTC", new Date("2026-10-24T00:00:00Z"))).toBe(3600_000);
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  6 passed (6)` and `Tests  71 passed (71)` (56 + 15 new); typecheck exits 0 with no output
- [ ] Step 4: Commit - `git add src/shared/cron.ts test/shared/cron.test.ts && git commit -m "feat: add cron validation and next-run calculation"`

---
### Task 4: Test harness for D1, R2, and Queue

**Files:**
- Modify: `vitest.config.ts` (anchor: `environment: "node"`)
- Create: `test/helpers/env.ts`, `test/helpers/api.ts`
- Test: `test/helpers/env.test.ts`

**Interfaces:**
- Consumes: `Env` from `src/worker/env.ts`; `app` from `src/worker/app.ts`; `migrations/*.sql` (Phase 1).
- Produces (X4), used by every later test:
  - `createTestEnv(overrides?: Partial<Env>): Promise<{ env: Env; dispose(): Promise<void> }>` in `test/helpers/env.ts` - in-memory D1, R2, Queue from `wrangler.jsonc`, migrated; fixed fake `ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `DEV_BYPASS: "true"`.
  - `resetDb(env: Env): Promise<void>` - deletes every row in all seven tables (children first). Call in `beforeEach`.
  - `TEST_ENCRYPTION_KEY: string` - base64 of 32 bytes.
  - `api(env: Env, hono?: Pick<typeof app, "request">)` in `test/helpers/api.ts` returning `{ get, post, patch, delete }`, each `Promise<{ status: number; text: string; json: any }>`; `SECRETS` (the four fake secret strings used by test bodies); `tunnelBody(overrides?: Record<string, unknown>)` - a valid `POST /api/targets` body.

**Gotcha:**
- Tests create one `getPlatformProxy` per test file (about one second). Share it with `beforeAll` and clear data with `resetDb` in `beforeEach`. Always `dispose()` in `afterAll`, or Vitest hangs.
- `persist: false` keeps everything in memory; no `.wrangler/state` is touched by tests.
- Migrations are applied by running each statement (split on `--> statement-breakpoint`) with `env.DB.prepare(stmt).run()`.
- `import.meta.glob(..., { query: "?raw", eager: true })` plus the `vite/client` reference is used instead of `node:fs` because `@types/node` is not installed. `vite` comes with `vitest`.
- [uncertain] `getPlatformProxy` may read `.dev.vars` if present; the helper passes explicit values so tests do not depend on it.
- The 30 s timeouts are for workerd start-up on a cold machine.

**Steps:**
- [ ] Step 1: Replace the contents of `vitest.config.ts` with:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] Step 2: Create `test/helpers/env.ts`:
```ts
/// <reference types="vite/client" />
import { getPlatformProxy } from "wrangler";
import type { Env } from "../../src/worker/env";

const migrationFiles = import.meta.glob("../../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const TEST_ENCRYPTION_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

const TABLES_CHILD_FIRST = [
  "target_alert_channels",
  "restores",
  "backups",
  "targets",
  "alert_channels",
  "audit_logs",
  "settings",
];

async function migrate(db: D1Database): Promise<void> {
  for (const path of Object.keys(migrationFiles).sort()) {
    for (const statement of (migrationFiles[path] ?? "").split("--> statement-breakpoint")) {
      if (statement.trim() !== "") await db.prepare(statement).run();
    }
  }
}

/** Deletes every row. Call in `beforeEach` so tests share one migrated in-memory database per file. */
export async function resetDb(env: Env): Promise<void> {
  await env.DB.batch(TABLES_CHILD_FIRST.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
}

/**
 * Local D1, R2, and Queue bindings from wrangler.jsonc (in memory, nothing persisted), migrated from /migrations.
 * Secrets are fixed fake values so tests never depend on a local .dev.vars file.
 */
export async function createTestEnv(overrides: Partial<Env> = {}): Promise<{ env: Env; dispose(): Promise<void> }> {
  const proxy = await getPlatformProxy<Env>({ configPath: "wrangler.jsonc", persist: false });
  await migrate(proxy.env.DB);
  const env: Env = {
    ...proxy.env,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    ACCESS_AUD: "test-aud",
    DEV_BYPASS: "true",
    ...overrides,
  };
  return { env, dispose: () => proxy.dispose() };
}
```

- [ ] Step 3: Create `test/helpers/api.ts`:
```ts
import type { Env } from "../../src/worker/env";
import { app } from "../../src/worker/app";

export const SECRETS = ["s3cret-pw", "restore-pw", "token-id-123", "token-secret-456"] as const;

export function api(env: Env, hono: Pick<typeof app, "request"> = app) {
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await hono.request(
      `http://localhost${path}`,
      { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) },
      env,
    );
    const text = await response.text();
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as any };
  };
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown) => call("POST", path, body),
    patch: (path: string, body?: unknown) => call("PATCH", path, body),
    delete: (path: string) => call("DELETE", path),
  };
}

/** A valid POST /api/targets body for a tunnel target. Every secret is one of SECRETS. */
export function tunnelBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Shop DB",
    projectTag: "shop",
    connectionUrl: "postgres://backup:s3cret-pw@db.example.com:5432/shop",
    restoreUrl: "postgres://restore:restore-pw@db.example.com:5432/shop",
    tunnel: { hostname: "db.example.com", tokenId: "token-id-123", tokenSecret: "token-secret-456" },
    ...overrides,
  };
}
```

- [ ] Step 4: Create `test/helpers/env.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../../src/worker/env";
import { createTestEnv, resetDb } from "./env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());

describe("createTestEnv", () => {
  it("applies every migration to the in-memory D1", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('targets','backups','restores','alert_channels','target_alert_channels','audit_logs','settings') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((row) => row.name)).toEqual(["alert_channels", "audit_logs", "backups", "restores", "settings", "target_alert_channels", "targets"]);
  });

  it("provides working R2 and Queue bindings", async () => {
    await env.BACKUPS.put("probe", "hello");
    expect(await (await env.BACKUPS.get("probe"))?.text()).toBe("hello");
    await env.JOBS.send({ probe: true });
  });

  it("resetDb empties tables", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('k', '1', 'now')").run();
    await resetDb(env);
    const row = await env.DB.prepare("SELECT count(*) AS n FROM settings").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  7 passed (7)` and `Tests  74 passed (74)` (71 + 3 new); typecheck exits 0 with no output
- [ ] Step 6: Commit - `git add vitest.config.ts test/helpers && git commit -m "test: add D1/R2/Queue test harness and API helpers"`

---
### Task 5: API errors and the error handler

**Files:**
- Create: `src/worker/lib/api-error.ts`, `src/worker/middleware/error.ts`
- Test: `test/worker/middleware/error.test.ts`

**Interfaces:**
- Consumes: `AppEnv` from `src/worker/middleware/access.ts`; `redactError(error: unknown): string` from `src/worker/lib/redact.ts`.
- Produces (X6):
  - `type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 500`
  - `class ApiError extends Error { constructor(status: ApiErrorStatus, code: string, message: string, details?: unknown) }` with readonly `status`, `code`, `details`
  - `notFound(what: string): ApiError` (404 `not_found`, message `"<what> not found"`), `conflict(message: string): ApiError` (409 `conflict`), `validationError(path: string, message: string): ApiError` (400 `validation_error`, details `[{ path, message }]`)
  - `errorHandler: ErrorHandler<AppEnv>` and `notFoundHandler: NotFoundHandler<AppEnv>` in `src/worker/middleware/error.ts`

**Gotcha:** This task does not touch `app.ts`; Task 11 registers both handlers. The test mounts them on a local Hono instance. `validationError` messages must never contain a submitted value.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/api-error.ts`:
```ts
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 500;

export class ApiError extends Error {
  constructor(
    readonly status: ApiErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);

export const conflict = (message: string) => new ApiError(409, "conflict", message);

/** `path` is a dotted field path such as "tunnel.hostname". Never put a submitted value in `message`. */
export const validationError = (path: string, message: string) =>
  new ApiError(400, "validation_error", "Invalid request", [{ path, message }]);
```

- [ ] Step 2: Create `src/worker/middleware/error.ts`:
```ts
import type { ErrorHandler, NotFoundHandler } from "hono";
import { ApiError } from "../lib/api-error";
import { redactError } from "../lib/redact";
import type { AppEnv } from "./access";

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof ApiError) {
    const body = { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
    return c.json({ error: body }, error.status);
  }
  console.error(`unhandled error: ${redactError(error)}`);
  return c.json({ error: { code: "internal_error", message: redactError(error) } }, 500);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json({ error: { code: "not_found", message: "Not found" } }, 404);
```

- [ ] Step 3: Create `test/worker/middleware/error.test.ts`:
```ts
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiError, conflict, notFound, validationError } from "../../../src/worker/lib/api-error";
import type { AppEnv } from "../../../src/worker/middleware/access";
import { errorHandler, notFoundHandler } from "../../../src/worker/middleware/error";

const app = new Hono<AppEnv>();
app.onError(errorHandler);
app.notFound(notFoundHandler);
app.get("/api-error", () => {
  throw new ApiError(400, "bad_thing", "Bad thing", { field: "x" });
});
app.get("/not-found", () => {
  throw notFound("Target");
});
app.get("/conflict", () => {
  throw conflict("Name taken");
});
app.get("/validation", () => {
  throw validationError("tunnel.hostname", "Required");
});
app.get("/boom", () => {
  throw new Error("connect failed for postgres://admin:hunter2@db.example.com:5432/app");
});

async function get(path: string) {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as { error: { code: string } } };
}

describe("errorHandler", () => {
  it("maps ApiError to { error: { code, message, details } }", async () => {
    expect(await get("/api-error")).toEqual({
      status: 400,
      body: { error: { code: "bad_thing", message: "Bad thing", details: { field: "x" } } },
    });
  });

  it("omits details when there are none", async () => {
    expect(await get("/conflict")).toEqual({ status: 409, body: { error: { code: "conflict", message: "Name taken" } } });
    expect(await get("/not-found")).toEqual({ status: 404, body: { error: { code: "not_found", message: "Target not found" } } });
  });

  it("builds validation errors with a field path", async () => {
    expect(await get("/validation")).toEqual({
      status: 400,
      body: { error: { code: "validation_error", message: "Invalid request", details: [{ path: "tunnel.hostname", message: "Required" }] } },
    });
  });

  it("turns unknown errors into a redacted 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await get("/boom");
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
    spy.mockRestore();
  });

  it("returns a JSON 404 for unknown routes", async () => {
    expect(await get("/nope")).toEqual({ status: 404, body: { error: { code: "not_found", message: "Not found" } } });
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  8 passed (8)` and `Tests  79 passed (79)` (74 + 5 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/lib/api-error.ts src/worker/middleware/error.ts test/worker/middleware/error.test.ts && git commit -m "feat: add ApiError and error handler"`

---
### Task 6: Request validation and pagination helpers

**Files:**
- Create: `src/worker/lib/validate.ts`, `src/worker/lib/pagination.ts`
- Test: `test/worker/lib/validate.test.ts`

**Interfaces:**
- Consumes: `ApiError` from `src/worker/lib/api-error.ts` (Task 5); `z` from `zod`.
- Produces (X5, X7):
  - `parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>>` - invalid JSON is 400 `validation_error` "Body must be valid JSON"; schema failures are 400 with `details: { path, message }[]`
  - `parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S>`
  - `paginationQuery` - `z.object({ limit: coerce int 1..200 default 50, cursor?: string })`
  - `type Page<T> = { items: T[]; nextCursor: string | null }`
  - `encodeCursor(parts: string[]): string`, `decodeCursor(cursor: string, size: number): string[]` (400 `validation_error` "Invalid cursor" on garbage or a wrong size), `toPage<T>(rows: T[], limit: number, sortKey: (row: T) => string[]): Page<T>` - `rows` must be fetched with `limit + 1`

**Gotcha:** Cursors go through `TextEncoder` before `btoa`, because target names can be Thai and `btoa` rejects characters above U+00FF. Never put `issue.input` or any submitted value into `details`; the test sends `hunter2` in three fields and asserts it never appears.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/validate.ts`:
```ts
import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./api-error";

/** Only the field path and the rule message are returned. Submitted values are never echoed. */
function fail(error: z.ZodError): ApiError {
  const details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  return new ApiError(400, "validation_error", "Invalid request", details);
}

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "validation_error", "Body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw fail(result.error);
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw fail(result.error);
  return result.data;
}
```

- [ ] Step 2: Create `src/worker/lib/pagination.ts`:
```ts
import { z } from "zod";
import { ApiError } from "./api-error";

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Opaque cursor: base64url of the JSON array of the last row's sort key parts. */
export function encodeCursor(parts: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string, size: number): string[] {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))));
    if (Array.isArray(parsed) && parsed.length === size && parsed.every((part) => typeof part === "string")) return parsed;
  } catch {
    // falls through to the error below
  }
  throw new ApiError(400, "validation_error", "Invalid cursor", [{ path: "cursor", message: "Invalid cursor" }]);
}

/** `rows` must be fetched with `limit + 1`: the extra row only signals that another page exists. */
export function toPage<T>(rows: T[], limit: number, sortKey: (row: T) => string[]): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(sortKey(last)) : null };
}
```

- [ ] Step 3: Create `test/worker/lib/validate.test.ts`:
```ts
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeCursor, encodeCursor, paginationQuery, toPage } from "../../../src/worker/lib/pagination";
import { parseBody, parseQuery } from "../../../src/worker/lib/validate";
import type { AppEnv } from "../../../src/worker/middleware/access";
import { errorHandler } from "../../../src/worker/middleware/error";

const bodySchema = z.object({ name: z.string().min(1), count: z.number().int() }).strict();

const app = new Hono<AppEnv>();
app.onError(errorHandler);
app.post("/body", async (c) => c.json(await parseBody(c, bodySchema)));
app.get("/query", (c) => c.json(parseQuery(c, paginationQuery)));

const post = (body: string) => app.request("/body", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("parseBody", () => {
  it("returns parsed data", async () => {
    const response = await post(JSON.stringify({ name: "a", count: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "a", count: 2 });
  });

  it("rejects invalid JSON with 400 validation_error", async () => {
    const response = await post("{nope");
    expect(response.status).toBe(400);
    expect((await response.json()) as object).toEqual({ error: { code: "validation_error", message: "Body must be valid JSON" } });
  });

  it("returns field paths and messages, never the submitted value", async () => {
    const response = await post(JSON.stringify({ name: "", count: "hunter2", extra: "hunter2" }));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    const paths = (JSON.parse(text).error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(["", "count", "name"]);
  });
});

describe("parseQuery and pagination", () => {
  it("defaults limit to 50 and coerces strings", async () => {
    expect(await (await app.request("/query")).json()).toEqual({ limit: 50 });
    expect(await (await app.request("/query?limit=7&cursor=abc")).json()).toEqual({ limit: 7, cursor: "abc" });
  });

  it("rejects limit 0, 201, and non-numbers", async () => {
    for (const limit of ["0", "201", "abc", "1.5"]) {
      expect((await app.request(`/query?limit=${limit}`)).status, limit).toBe(400);
    }
  });

  it("roundtrips cursors, including non-ASCII text", () => {
    for (const parts of [["a"], ["2026-10-24T00:00:00.000Z", "id-1"], ["สำรองข้อมูล"]]) {
      expect(decodeCursor(encodeCursor(parts), parts.length)).toEqual(parts);
    }
    expect(encodeCursor(["สำรองข้อมูล"])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects garbage cursors and cursors of the wrong size", () => {
    expect(() => decodeCursor("!!!", 1)).toThrow("Invalid cursor");
    expect(() => decodeCursor(encodeCursor(["a", "b"]), 1)).toThrow("Invalid cursor");
    expect(() => decodeCursor(btoa("[1]"), 1)).toThrow("Invalid cursor");
  });

  it("toPage drops the extra row and sets nextCursor only when more rows exist", () => {
    const rows = [{ k: "a" }, { k: "b" }, { k: "c" }];
    const first = toPage(rows, 2, (row) => [row.k]);
    expect(first.items).toEqual([{ k: "a" }, { k: "b" }]);
    expect(first.nextCursor && decodeCursor(first.nextCursor, 1)).toEqual(["b"]);
    expect(toPage(rows.slice(0, 2), 2, (row) => [row.k])).toEqual({ items: [{ k: "a" }, { k: "b" }], nextCursor: null });
    expect(toPage([], 2, (row: { k: string }) => [row.k])).toEqual({ items: [], nextCursor: null });
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  9 passed (9)` and `Tests  87 passed (87)` (79 + 8 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/lib/validate.ts src/worker/lib/pagination.ts test/worker/lib/validate.test.ts && git commit -m "feat: add request validation and cursor pagination helpers"`

---
### Task 7: DB client and audit helper

**Files:**
- Create: `src/worker/db/client.ts`, `src/worker/lib/audit.ts`
- Test: `test/worker/lib/audit.test.ts`

**Interfaces:**
- Consumes: `Env`; `auditLogs` from `src/worker/db/schema.ts`; `redactSecrets(input: string): string`; `uuidv7(now?: number): string` (Task 1); `createTestEnv`, `resetDb` (Task 4).
- Produces:
  - `getDb(env: Env)` returning `drizzle(env.DB, { schema })`, and `type Db = ReturnType<typeof getDb>` in `src/worker/db/client.ts` (X11)
  - `type AuditEntry = { actor: string; action: string; entityType: string; entityId?: string | null; details?: unknown; ip?: string | null }`
  - `auditInsert(db: Db, entry: AuditEntry)` - the Drizzle insert statement (not yet executed), for use inside `db.batch`
  - `writeAudit(db: Db, entry: AuditEntry): Promise<void>` (X10) - executes `auditInsert`
  - Both store `details` as `redactSecrets(JSON.stringify(details))`, or `null` when `details` is `undefined`. `at` is `new Date().toISOString()`; `id` is a UUIDv7.

**Gotcha:** Callers that also change data must pass `auditInsert(...)` to the same `db.batch([...])` (D1 batches run in one transaction). Use `writeAudit` only for audit-only events.

**Steps:**
- [ ] Step 1: Create `src/worker/db/client.ts`:
```ts
import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env";
import * as schema from "./schema";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
```

- [ ] Step 2: Create `src/worker/lib/audit.ts`:
```ts
import { auditLogs } from "../db/schema";
import type { Db } from "../db/client";
import { redactSecrets } from "./redact";
import { uuidv7 } from "./uuidv7";

export type AuditEntry = {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: unknown;
  ip?: string | null;
};

/** The insert statement, for callers that commit it in the same `db.batch` as the change it records. */
export function auditInsert(db: Db, entry: AuditEntry) {
  return db.insert(auditLogs).values({
    id: uuidv7(),
    at: new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    details: entry.details === undefined ? null : redactSecrets(JSON.stringify(entry.details)),
    ip: entry.ip ?? null,
  });
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await auditInsert(db, entry);
}
```

- [ ] Step 3: Create `test/worker/lib/audit.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { writeAudit } from "../../../src/worker/lib/audit";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

describe("writeAudit", () => {
  it("stores actor, action, entity, and a UUIDv7 id with a UTC ISO time", async () => {
    await writeAudit(getDb(env), { actor: "alice@example.com", action: "target.create", entityType: "target", entityId: "t1", ip: "203.0.113.9" });
    const [row] = await getDb(env).select().from(auditLogs);
    expect(row).toMatchObject({ actor: "alice@example.com", action: "target.create", entityType: "target", entityId: "t1", ip: "203.0.113.9", details: null });
    expect(row?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(row?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("stores details as redacted JSON", async () => {
    await writeAudit(getDb(env), {
      actor: "system",
      action: "target.update",
      entityType: "target",
      details: { note: "failed for postgres://admin:hunter2@db.example.com/app", password: "hunter2" },
    });
    const [row] = await getDb(env).select().from(auditLogs);
    expect(row?.details).not.toContain("hunter2");
    expect(JSON.parse(row?.details ?? "null")).toHaveProperty("note");
    expect(row?.entityId).toBeNull();
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  10 passed (10)` and `Tests  89 passed (89)` (87 + 2 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/db/client.ts src/worker/lib/audit.ts test/worker/lib/audit.test.ts && git commit -m "feat: add D1 client and audit helper"`

---
### Task 8: PostgreSQL URL parsing

**Files:**
- Create: `src/shared/pg-url.ts`
- Test: `test/shared/pg-url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, imported by Tasks 9, 10, 11 and (Phase 7) by anything that derives a database name:
  - `type PgConnectionInfo = { host: string; port: number; user: string; dbName: string }`
  - `parsePgUrl(url: string): PgConnectionInfo | null` - `postgres://` or `postgresql://`, non-empty user, host, and database name (percent-decoded), port default 5432; `null` for anything else
  - `sanitizeDbName(dbName: string): string` - every character outside `[A-Za-z0-9_-]` becomes `_`

**Gotcha:** passwords with `/`, `?`, or `#` must be percent-encoded by the user; a raw `@` in the password is accepted (the URL parser splits on the last `@`). [uncertain] The tests run in Node; workerd uses the same WHATWG URL rules, and Task 11's route tests and the end-to-end run exercise the parser through the Worker runtime.

**Steps:**
- [ ] Step 1: Create `src/shared/pg-url.ts`:
```ts
export type PgConnectionInfo = { host: string; port: number; user: string; dbName: string };

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Reads host, port, user, and database name from a postgres:// or postgresql:// URL.
 * Returns null when the URL is unusable. Special characters in the password must be percent-encoded.
 */
export function parsePgUrl(url: string): PgConnectionInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  const user = decode(parsed.username);
  const dbName = decode(parsed.pathname.slice(1));
  if (!parsed.hostname || !user || !dbName || dbName.includes("/")) return null;
  return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 5432, user, dbName };
}

/** The value stored in `targets.db_name` and used in R2 keys: every character outside [A-Za-z0-9_-] becomes "_". */
export function sanitizeDbName(dbName: string): string {
  return dbName.replace(/[^A-Za-z0-9_-]/g, "_");
}
```

- [ ] Step 2: Create `test/shared/pg-url.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parsePgUrl, sanitizeDbName } from "../../src/shared/pg-url";

describe("parsePgUrl", () => {
  it("reads host, port, user, and database", () => {
    expect(parsePgUrl("postgres://backup:s3cret@db.example.com:6543/shop")).toEqual({ host: "db.example.com", port: 6543, user: "backup", dbName: "shop" });
  });

  it("defaults the port to 5432 and accepts the postgresql scheme and query parameters", () => {
    expect(parsePgUrl("postgresql://u:p@10.0.0.5/app?sslmode=require")).toEqual({ host: "10.0.0.5", port: 5432, user: "u", dbName: "app" });
  });

  it("accepts a URL without a password", () => {
    expect(parsePgUrl("postgres://u@h/app")?.user).toBe("u");
  });

  it("percent-decodes the user and database name, and accepts a raw @ in the password", () => {
    expect(parsePgUrl("postgres://my%20user:p@ss@h/my%20db")).toEqual({ host: "h", port: 5432, user: "my user", dbName: "my db" });
  });

  it("returns null for anything unusable", () => {
    for (const url of ["", "not a url", "mysql://u:p@h/db", "http://u:p@h/db", "postgres://h/db", "postgres://u:p@/db", "postgres://u:p@h", "postgres://u:p@h/", "postgres://u:p@h/a/b", "postgres://u:p@h:99999/db", "postgres://u:p@h/%E0%A4%A"]) {
      expect(parsePgUrl(url), url).toBeNull();
    }
  });
});

describe("sanitizeDbName", () => {
  it("keeps letters, digits, underscore, and hyphen; replaces everything else with an underscore", () => {
    expect(sanitizeDbName("shop-db_2")).toBe("shop-db_2");
    expect(sanitizeDbName("my db.v2")).toBe("my_db_v2");
    expect(sanitizeDbName("../etc/passwd")).toBe("___etc_passwd");
    expect(sanitizeDbName("ฐานข้อมูล")).toBe("_________");
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  11 passed (11)` and `Tests  95 passed (95)` (89 + 6 new); typecheck exits 0 with no output
- [ ] Step 4: Commit - `git add src/shared/pg-url.ts test/shared/pg-url.test.ts && git commit -m "feat: add PostgreSQL URL parsing"`

---
### Task 9: Target Zod schemas

**Files:**
- Create: `src/shared/target-schema.ts`
- Test: `test/shared/target-schema.test.ts`

**Interfaces:**
- Consumes: `validateCron(expr: string): string | null` (Task 3); `isValidTimeZone(tz: string): boolean` (Task 2); `parsePgUrl(url: string): PgConnectionInfo | null` (Task 8); `z` from `zod`.
- Produces, imported by Tasks 11 to 13 and by Phase 9 (client-side form validation):
  - `TARGET_DEFAULTS` - `{ scheduleCron: "0 2 * * *", timezone: "Asia/Bangkok", keepLast: 3, keepDaily: 7, keepWeekly: 4, keepMonthly: 6, maxAgeDays: null, jobDeadlineMinutes: 120, alertFailureThreshold: 3 }`
  - `createTargetSchema` and `updateTargetSchema` (both `.strict()`), `type CreateTargetInput = z.output<typeof createTargetSchema>`, `type UpdateTargetInput = z.output<typeof updateTargetSchema>`
  - Create: defaults fill `scheduleCron`, `timezone`, `jobDeadlineMinutes`, `alertFailureThreshold` (3), `enabled` (true), `alertChannelIds` (`[]`, de-duplicated). `retention` is left undefined when omitted: the service applies the per-field defaults. `tunnel` (all three fields) is required: connection mode is tunnel only.
  - Update: every field optional; `tunnel` accepts any subset of `hostname`, `tokenId`, `tokenSecret`; an empty object is rejected; `connectionMode` is an unknown key (400). The service (Task 13) replaces only the supplied tunnel parts.

**Gotcha:** There is no `connectionMode` field (owner round 2, answer 1); `.strict()` makes sending it a 400. All refine messages are static strings so no submitted value is echoed (the test asserts this for URL and token fields).

**Steps:**
- [ ] Step 1: Create `src/shared/target-schema.ts`:
```ts
import { z } from "zod";
import { validateCron } from "./cron";
import { parsePgUrl } from "./pg-url";
import { isValidTimeZone } from "./tz";

export const TARGET_DEFAULTS = {
  scheduleCron: "0 2 * * *",
  timezone: "Asia/Bangkok",
  keepLast: 3,
  keepDaily: 7,
  keepWeekly: 4,
  keepMonthly: 6,
  maxAgeDays: null,
  jobDeadlineMinutes: 120,
  alertFailureThreshold: 3,
} as const;

const pgUrl = z
  .string()
  .max(2048)
  .refine((value) => parsePgUrl(value) !== null, "Must be a postgres:// or postgresql:// URL with a user, a host, and a database name");

const cron = z.string().superRefine((value, ctx) => {
  const error = validateCron(value);
  if (error) ctx.addIssue({ code: "custom", message: error });
});

const timezone = z.string().refine(isValidTimeZone, "Must be an IANA time zone such as Asia/Bangkok");

const hostname = z
  .string()
  .max(253)
  .regex(/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/, "Must be a hostname such as db.example.com");

const keepCount = z.number().int().min(0).max(10_000).nullable();
const maxAgeDays = z.number().int().min(1).max(36_500).nullable();
const name = z.string().trim().min(1).max(100);
const projectTag = z.string().trim().min(1).max(50).nullable();
const jobDeadlineMinutes = z.number().int().min(5).max(1440);
const staleAfterHours = z.number().int().min(1).max(8760).nullable();
const alertFailureThreshold = z.number().int().min(1).max(100);
const alertChannelIds = z
  .array(z.string().min(1))
  .max(50)
  .transform((ids) => [...new Set(ids)]);

const retention = z
  .object({ keepLast: keepCount.optional(), daily: keepCount.optional(), weekly: keepCount.optional(), monthly: keepCount.optional(), maxAgeDays: maxAgeDays.optional() })
  .strict();

const tunnel = z.object({ hostname, tokenId: z.string().min(1).max(512), tokenSecret: z.string().min(1).max(1024) }).strict();

export const createTargetSchema = z
  .object({
    name,
    projectTag: projectTag.optional(),
    connectionUrl: pgUrl,
    restoreUrl: pgUrl.nullable().optional(),
    tunnel,
    scheduleCron: cron.default(TARGET_DEFAULTS.scheduleCron),
    timezone: timezone.default(TARGET_DEFAULTS.timezone),
    retention: retention.optional(),
    jobDeadlineMinutes: jobDeadlineMinutes.default(TARGET_DEFAULTS.jobDeadlineMinutes),
    staleAfterHours: staleAfterHours.optional(),
    alertFailureThreshold: alertFailureThreshold.default(TARGET_DEFAULTS.alertFailureThreshold),
    enabled: z.boolean().default(true),
    alertChannelIds: alertChannelIds.default([]),
  })
  .strict();

export const updateTargetSchema = z
  .object({
    name: name.optional(),
    projectTag: projectTag.optional(),
    connectionUrl: pgUrl.optional(),
    restoreUrl: pgUrl.nullable().optional(),
    tunnel: tunnel.partial().strict().optional(),
    scheduleCron: cron.optional(),
    timezone: timezone.optional(),
    retention: retention.optional(),
    jobDeadlineMinutes: jobDeadlineMinutes.optional(),
    staleAfterHours: staleAfterHours.optional(),
    alertFailureThreshold: alertFailureThreshold.optional(),
    enabled: z.boolean().optional(),
    alertChannelIds: alertChannelIds.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Object.values(value).every((field) => field === undefined)) {
      ctx.addIssue({ code: "custom", message: "At least one field is required" });
    }
  });

export type CreateTargetInput = z.output<typeof createTargetSchema>;
export type UpdateTargetInput = z.output<typeof updateTargetSchema>;
```

- [ ] Step 2: Create `test/shared/target-schema.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTargetSchema, TARGET_DEFAULTS, updateTargetSchema } from "../../src/shared/target-schema";

const base = {
  name: "Shop DB",
  connectionUrl: "postgres://backup:s3cret@db.example.com:5432/shop",
  tunnel: { hostname: "db.example.com", tokenId: "id-1", tokenSecret: "secret-1" },
};

function paths(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }): string[] {
  return result.error?.issues.map((issue) => issue.path.join(".")) ?? [];
}

describe("createTargetSchema", () => {
  it("fills the owner defaults", () => {
    const parsed = createTargetSchema.parse(base);
    expect(parsed).toMatchObject({
      scheduleCron: TARGET_DEFAULTS.scheduleCron,
      timezone: "Asia/Bangkok",
      jobDeadlineMinutes: 120,
      alertFailureThreshold: 3,
      enabled: true,
      alertChannelIds: [],
    });
    expect(parsed.retention).toBeUndefined();
  });

  it("rejects each invalid input at its own field", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ scheduleCron: "61 * * * *" }, "scheduleCron"],
      [{ scheduleCron: "* * * *" }, "scheduleCron"],
      [{ timezone: "Mars/Base" }, "timezone"],
      [{ connectionUrl: "mysql://u:p@h/db" }, "connectionUrl"],
      [{ restoreUrl: "nonsense" }, "restoreUrl"],
      [{ name: "   " }, "name"],
      [{ tunnel: undefined }, "tunnel"],
      [{ tunnel: { hostname: "db.example.com", tokenId: "id-1" } }, "tunnel.tokenSecret"],
      [{ tunnel: { hostname: "not a host", tokenId: "a", tokenSecret: "b" } }, "tunnel.hostname"],
      [{ connectionMode: "tunnel" }, ""],
      [{ dbName: "shop" }, ""],
      [{ retention: { keepLast: -1 } }, "retention.keepLast"],
      [{ retention: { maxAgeDays: 0 } }, "retention.maxAgeDays"],
      [{ jobDeadlineMinutes: 1 }, "jobDeadlineMinutes"],
      [{ staleAfterHours: 0 }, "staleAfterHours"],
      [{ alertFailureThreshold: 0 }, "alertFailureThreshold"],
      [{ alertFailureThreshold: 101 }, "alertFailureThreshold"],
      [{ alertFailureThreshold: 2.5 }, "alertFailureThreshold"],
      [{ enabled: "yes" }, "enabled"],
    ];
    for (const [override, path] of cases) {
      const result = createTargetSchema.safeParse({ ...base, ...override });
      expect(result.success, JSON.stringify(override)).toBe(false);
      expect(paths(result), JSON.stringify(override)).toContain(path);
    }
  });

  it("allows null to switch retention rules off and de-duplicates channel ids", () => {
    const parsed = createTargetSchema.parse({ ...base, retention: { keepLast: null, maxAgeDays: 90 }, alertChannelIds: ["a", "b", "a"] });
    expect(parsed.retention).toEqual({ keepLast: null, maxAgeDays: 90 });
    expect(parsed.alertChannelIds).toEqual(["a", "b"]);
  });

  it("never puts a submitted secret into an error message", () => {
    const result = createTargetSchema.safeParse({ ...base, connectionUrl: "mysql://u:leak-pw@h/db", tunnel: { hostname: "x", tokenId: "leak-id", tokenSecret: "" } });
    expect(JSON.stringify(result.error?.issues)).not.toMatch(/leak/);
  });
});

describe("updateTargetSchema", () => {
  it("accepts a single field and leaves the rest undefined", () => {
    expect(updateTargetSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("accepts partial tunnel and retention objects, and null to clear", () => {
    const parsed = updateTargetSchema.parse({ tunnel: { tokenSecret: "new" }, retention: { daily: null }, restoreUrl: null, projectTag: null });
    expect(parsed).toEqual({ tunnel: { tokenSecret: "new" }, retention: { daily: null }, restoreUrl: null, projectTag: null });
  });

  it("rejects an empty body and unknown keys, including connectionMode", () => {
    expect(updateTargetSchema.safeParse({}).success).toBe(false);
    expect(updateTargetSchema.safeParse({ dbName: "x" }).success).toBe(false);
    expect(updateTargetSchema.safeParse({ connectionMode: "tunnel" }).success).toBe(false);
  });

  it("validates the same field rules as create", () => {
    for (const override of [{ scheduleCron: "nope" }, { timezone: "x/y" }, { connectionUrl: "http://h/db" }, { tunnel: { hostname: "bad host" } }, { alertFailureThreshold: 0 }]) {
      expect(updateTargetSchema.safeParse(override).success, JSON.stringify(override)).toBe(false);
    }
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  12 passed (12)` and `Tests  103 passed (103)` (95 + 8 new); typecheck exits 0 with no output
- [ ] Step 4: Commit - `git add src/shared/target-schema.ts test/shared/target-schema.test.ts && git commit -m "feat: add target create and update schemas"`

---
### Task 10: Target response view

**Files:**
- Create: `src/worker/services/target-view.ts`
- Test: `test/worker/services/target-view.test.ts`

**Interfaces:**
- Consumes: `targets`, `backups`, `targetAlertChannels` from `src/worker/db/schema.ts`; `Db` (Task 7); `decrypt(payload: string, keyBase64: string): Promise<string>`; `parsePgUrl` (Task 8).
- Produces, used by Tasks 11 to 14:
  - `type TargetRow = typeof targets.$inferSelect`, `type TargetStats = { backupCount: number; totalBackupBytes: number }`, `EMPTY_STATS: TargetStats`
  - `type TargetView` = `{ id; name; projectTag; dbName; connection: { host; port; dbName; user }; hasRestoreUrl; hasTunnelToken; tunnelHostname; scheduleCron; timezone; enabled; retention: { keepLast; daily; weekly; monthly; maxAgeDays }; jobDeadlineMinutes; staleAfterHours; alertFailureThreshold; nextRunAt; lastBackupAt; lastStatus; alertChannelIds: string[]; stats: TargetStats; createdAt; updatedAt }` (exact field types in the code below)
  - `toTargetView(env: Env, row: TargetRow, alertChannelIds: string[], stats: TargetStats): Promise<TargetView>`
  - `loadStats(db: Db, targetId?: string): Promise<Map<string, TargetStats>>` - successful, not-deleted backups per target
  - `loadAlertChannelIds(db: Db, targetId?: string): Promise<Map<string, string[]>>` - sorted by channel id

**Gotcha:**
- `TargetRow` is inferred from the Phase 1 schema. The only hand-built fixture of it is `row()` in this task's test. Later schema changes (Phases 5, 8) add columns to `targets`; whoever adds one must update that fixture.
- `toTargetView` is the only place that turns a row into a response. It copies fields one by one so a new `*_enc` column can never leak by accident.
- `stats` is approved (owner round 2, answer 4): only non-deleted success backups count.

**Steps:**
- [ ] Step 1: Create `src/worker/services/target-view.ts`:
```ts
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { backups, targetAlertChannels, targets } from "../db/schema";
import type { Env } from "../env";
import { parsePgUrl } from "../../shared/pg-url";
import { decrypt } from "../lib/crypto";

export type TargetRow = typeof targets.$inferSelect;
export type TargetStats = { backupCount: number; totalBackupBytes: number };

export type TargetView = {
  id: string;
  name: string;
  projectTag: string | null;
  dbName: string;
  connection: { host: string; port: number; dbName: string; user: string };
  hasRestoreUrl: boolean;
  hasTunnelToken: boolean;
  tunnelHostname: string;
  scheduleCron: string;
  timezone: string;
  enabled: boolean;
  retention: { keepLast: number | null; daily: number | null; weekly: number | null; monthly: number | null; maxAgeDays: number | null };
  jobDeadlineMinutes: number;
  staleAfterHours: number | null;
  alertFailureThreshold: number;
  nextRunAt: string | null;
  lastBackupAt: string | null;
  lastStatus: string | null;
  alertChannelIds: string[];
  stats: TargetStats;
  createdAt: string;
  updatedAt: string;
};

export const EMPTY_STATS: TargetStats = { backupCount: 0, totalBackupBytes: 0 };

/** Builds the API shape. Reads only masked parts of the stored URL. No `*_enc` value leaves this function. */
export async function toTargetView(env: Env, row: TargetRow, alertChannelIds: string[], stats: TargetStats): Promise<TargetView> {
  const connection = parsePgUrl(await decrypt(row.connectionUrlEnc, env.ENCRYPTION_KEY));
  if (!connection) throw new Error(`Stored connection URL for target ${row.id} is not a valid PostgreSQL URL`);
  return {
    id: row.id,
    name: row.name,
    projectTag: row.projectTag,
    dbName: row.dbName,
    connection,
    hasRestoreUrl: row.restoreUrlEnc !== null,
    hasTunnelToken: row.tunnelTokenIdEnc !== null && row.tunnelTokenSecretEnc !== null,
    tunnelHostname: row.tunnelHostname,
    scheduleCron: row.scheduleCron,
    timezone: row.timezone,
    enabled: row.enabled,
    retention: { keepLast: row.keepLast, daily: row.keepDaily, weekly: row.keepWeekly, monthly: row.keepMonthly, maxAgeDays: row.maxAgeDays },
    jobDeadlineMinutes: row.jobDeadlineMinutes,
    staleAfterHours: row.staleAfterHours,
    alertFailureThreshold: row.alertFailureThreshold,
    nextRunAt: row.nextRunAt,
    lastBackupAt: row.lastBackupAt,
    lastStatus: row.lastStatus,
    alertChannelIds,
    stats,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Successful, not-deleted backups per target. Unfiltered on purpose when no id is given: avoids D1's 100-parameter limit. */
export async function loadStats(db: Db, targetId?: string): Promise<Map<string, TargetStats>> {
  const rows = await db
    .select({ targetId: backups.targetId, backupCount: count(), totalBackupBytes: sql<number>`coalesce(sum(${backups.sizeBytes}), 0)` })
    .from(backups)
    .where(and(eq(backups.status, "success"), isNull(backups.deletedAt), targetId ? eq(backups.targetId, targetId) : undefined))
    .groupBy(backups.targetId);
  return new Map(rows.map((row) => [row.targetId, { backupCount: row.backupCount, totalBackupBytes: row.totalBackupBytes }]));
}

export async function loadAlertChannelIds(db: Db, targetId?: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select()
    .from(targetAlertChannels)
    .where(targetId ? eq(targetAlertChannels.targetId, targetId) : undefined)
    .orderBy(targetAlertChannels.channelId);
  const byTarget = new Map<string, string[]>();
  for (const row of rows) byTarget.set(row.targetId, [...(byTarget.get(row.targetId) ?? []), row.channelId]);
  return byTarget;
}
```

- [ ] Step 2: Create `test/worker/services/target-view.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/worker/env";
import { encrypt } from "../../../src/worker/lib/crypto";
import { EMPTY_STATS, toTargetView, type TargetRow } from "../../../src/worker/services/target-view";
import { TEST_ENCRYPTION_KEY } from "../../helpers/env";

const env = { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY } as Env;

async function row(overrides: Partial<TargetRow> = {}): Promise<TargetRow> {
  return {
    id: "t1",
    name: "Shop",
    dbName: "shop",
    pgVersion: null,
    connectionUrlEnc: await encrypt("postgres://backup:s3cret@db.example.com:6543/shop", TEST_ENCRYPTION_KEY),
    restoreUrlEnc: await encrypt("postgres://restore:r3store@db.example.com:6543/shop", TEST_ENCRYPTION_KEY),
    projectTag: "shop",
    tunnelHostname: "db.example.com",
    tunnelTokenIdEnc: await encrypt("token-id-1", TEST_ENCRYPTION_KEY),
    tunnelTokenSecretEnc: await encrypt("token-secret-1", TEST_ENCRYPTION_KEY),
    scheduleCron: "0 2 * * *",
    timezone: "Asia/Bangkok",
    enabled: true,
    keepLast: 3,
    keepDaily: 7,
    keepWeekly: 4,
    keepMonthly: 6,
    maxAgeDays: null,
    jobDeadlineMinutes: 120,
    staleAfterHours: null,
    alertFailureThreshold: 3,
    nextRunAt: "2026-10-24T19:00:00.000Z",
    lastBackupAt: null,
    lastStatus: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    updatedAt: "2026-10-24T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("toTargetView", () => {
  it("exposes masked connection parts and booleans only", async () => {
    const view = await toTargetView(env, await row(), ["c1"], { backupCount: 2, totalBackupBytes: 300 });
    expect(view.connection).toEqual({ host: "db.example.com", port: 6543, dbName: "shop", user: "backup" });
    expect(view).toMatchObject({ hasRestoreUrl: true, hasTunnelToken: true, alertChannelIds: ["c1"], stats: { backupCount: 2, totalBackupBytes: 300 } });
    const json = JSON.stringify(view);
    for (const secret of ["s3cret", "r3store", "token-id-1", "token-secret-1", "postgres://", "_enc", "v1:"]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("reports hasRestoreUrl false without a restore URL and maps the alert failure threshold", async () => {
    const view = await toTargetView(env, await row({ restoreUrlEnc: null, alertFailureThreshold: 5 }), [], EMPTY_STATS);
    expect(view).toMatchObject({ hasRestoreUrl: false, hasTunnelToken: true, tunnelHostname: "db.example.com", alertFailureThreshold: 5 });
  });

  it("maps the retention columns to the API names", async () => {
    const view = await toTargetView(env, await row({ keepLast: null, maxAgeDays: 90 }), [], EMPTY_STATS);
    expect(view.retention).toEqual({ keepLast: null, daily: 7, weekly: 4, monthly: 6, maxAgeDays: 90 });
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  13 passed (13)` and `Tests  106 passed (106)` (103 + 3 new); typecheck exits 0 with no output
- [ ] Step 4: Commit - `git add src/worker/services/target-view.ts test/worker/services/target-view.test.ts && git commit -m "feat: add target response view with masked connection info"`

---
### Task 11: Create and get a target (first route, app wiring)

**Files:**
- Create: `src/worker/services/targets.ts`, `src/worker/routes/targets.ts`
- Modify: `src/worker/app.ts` (anchor: `export const app = new Hono<AppEnv>();`)
- Test: `test/worker/routes/targets.create.test.ts`

**Interfaces:**
- Consumes: `createTargetSchema`, `CreateTargetInput`, `TARGET_DEFAULTS` (Task 9); `parseBody` (Task 6); `getDb`, `Db` (Task 7); `auditInsert` (Task 7); `toTargetView`, `loadStats`, `loadAlertChannelIds`, `EMPTY_STATS`, `TargetRow`, `TargetView` (Task 10); `parsePgUrl`, `sanitizeDbName` (Task 8); `nextRun` (Task 3); `uuidv7` (Task 1); `encrypt`; `conflict`, `notFound`, `validationError`, `errorHandler`, `notFoundHandler` (Task 5); test helpers (Task 4).
- Produces:
  - `type Actor = { email: string; ip: string | null }` in `src/worker/services/targets.ts`
  - `getTarget(env: Env, id: string): Promise<TargetView>` - 404 `not_found` when missing or soft-deleted
  - `createTarget(env: Env, input: CreateTargetInput, actor: Actor): Promise<TargetView>`
  - `targetRoutes: Hono<AppEnv>` in `src/worker/routes/targets.ts`, mounted at `/api/targets`
  - `POST /api/targets` returns `201 TargetView`; `GET /api/targets/:id` returns `200 TargetView`

**Gotcha:**
- The service file below already imports everything Tasks 12 to 14 need (`asc`, `gt`, `ne`, `decodeCursor`, `toPage`, `Page`, `UpdateTargetInput`). TypeScript does not flag unused imports here (`noUnusedLocals` is off). Do not remove them.
- Insert target + audit row + channel links in one `db.batch`. `getTarget` runs after the batch.
- `db_name` comes from the URL path (percent-decoded, then sanitized); it is not a request field. `retention` defaults apply per field: an omitted field takes the default, an explicit `null` turns the rule off.
- Name uniqueness is checked first (409). A concurrent duplicate would hit the unique index and surface as a redacted 500; accepted for a single-operator tool.
- Alert channel ids are checked against `alert_channels` (at most 50 ids, under D1's 100-parameter limit). A target with no linked channel gets no alerts (Phase 8 documents this).
- The Hono sub-app test builds its own app with a fixed actor to prove the audit actor comes from `actorEmail`.
- Registering handlers: `app.onError` and `app.notFound` are set once here for the whole app.

**Steps:**
- [ ] Step 1: Create `src/worker/services/targets.ts` (create and get only; later tasks append):
```ts
import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { nextRun } from "../../shared/cron";
import { parsePgUrl, sanitizeDbName } from "../../shared/pg-url";
import { TARGET_DEFAULTS, type CreateTargetInput, type UpdateTargetInput } from "../../shared/target-schema";
import { getDb, type Db } from "../db/client";
import { alertChannels, targetAlertChannels, targets } from "../db/schema";
import type { Env } from "../env";
import { conflict, notFound, validationError } from "../lib/api-error";
import { auditInsert } from "../lib/audit";
import { encrypt } from "../lib/crypto";
import { decodeCursor, toPage, type Page } from "../lib/pagination";
import { uuidv7 } from "../lib/uuidv7";
import { EMPTY_STATS, loadAlertChannelIds, loadStats, toTargetView, type TargetRow, type TargetView } from "./target-view";

export type Actor = { email: string; ip: string | null };

type Statements = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

async function assertNameFree(db: Db, name: string, exceptId?: string): Promise<void> {
  const taken = await db
    .select({ id: targets.id })
    .from(targets)
    .where(and(eq(targets.name, name), isNull(targets.deletedAt), exceptId ? ne(targets.id, exceptId) : undefined))
    .limit(1);
  if (taken.length > 0) throw conflict("A target with this name already exists");
}

async function assertChannelsExist(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await db.select({ id: alertChannels.id }).from(alertChannels).where(inArray(alertChannels.id, ids));
  const missing = ids.filter((id) => !found.some((row) => row.id === id));
  if (missing.length > 0) throw validationError("alertChannelIds", `Unknown alert channel ids: ${missing.join(", ")}`);
}

function channelLinks(targetId: string, ids: string[]) {
  return ids.map((channelId) => ({ targetId, channelId }));
}

async function requireTarget(db: Db, id: string): Promise<TargetRow> {
  const [row] = await db.select().from(targets).where(and(eq(targets.id, id), isNull(targets.deletedAt))).limit(1);
  if (!row) throw notFound("Target");
  return row;
}

async function viewOf(env: Env, db: Db, row: TargetRow): Promise<TargetView> {
  const [channels, stats] = await Promise.all([loadAlertChannelIds(db, row.id), loadStats(db, row.id)]);
  return toTargetView(env, row, channels.get(row.id) ?? [], stats.get(row.id) ?? EMPTY_STATS);
}

function dbNameOf(url: string): string {
  const info = parsePgUrl(url);
  if (!info) throw validationError("connectionUrl", "Must be a postgres:// or postgresql:// URL with a user, a host, and a database name");
  return sanitizeDbName(info.dbName);
}

function scheduleFor(cron: string, timezone: string, enabled: boolean, now: Date): string | null {
  return enabled ? nextRun(cron, timezone, now).toISOString() : null;
}

export async function getTarget(env: Env, id: string): Promise<TargetView> {
  const db = getDb(env);
  return viewOf(env, db, await requireTarget(db, id));
}

export async function createTarget(env: Env, input: CreateTargetInput, actor: Actor): Promise<TargetView> {
  const db = getDb(env);
  await assertNameFree(db, input.name);
  await assertChannelsExist(db, input.alertChannelIds);

  const now = new Date();
  const stamp = now.toISOString();
  const id = uuidv7(now.getTime());
  const key = env.ENCRYPTION_KEY;
  const retention = input.retention ?? {};
  const row: typeof targets.$inferInsert = {
    id,
    name: input.name,
    dbName: dbNameOf(input.connectionUrl),
    connectionUrlEnc: await encrypt(input.connectionUrl, key),
    restoreUrlEnc: input.restoreUrl ? await encrypt(input.restoreUrl, key) : null,
    projectTag: input.projectTag ?? null,
    tunnelHostname: input.tunnel.hostname,
    tunnelTokenIdEnc: await encrypt(input.tunnel.tokenId, key),
    tunnelTokenSecretEnc: await encrypt(input.tunnel.tokenSecret, key),
    scheduleCron: input.scheduleCron,
    timezone: input.timezone,
    enabled: input.enabled,
    keepLast: retention.keepLast === undefined ? TARGET_DEFAULTS.keepLast : retention.keepLast,
    keepDaily: retention.daily === undefined ? TARGET_DEFAULTS.keepDaily : retention.daily,
    keepWeekly: retention.weekly === undefined ? TARGET_DEFAULTS.keepWeekly : retention.weekly,
    keepMonthly: retention.monthly === undefined ? TARGET_DEFAULTS.keepMonthly : retention.monthly,
    maxAgeDays: retention.maxAgeDays === undefined ? TARGET_DEFAULTS.maxAgeDays : retention.maxAgeDays,
    jobDeadlineMinutes: input.jobDeadlineMinutes,
    staleAfterHours: input.staleAfterHours ?? null,
    alertFailureThreshold: input.alertFailureThreshold,
    nextRunAt: scheduleFor(input.scheduleCron, input.timezone, input.enabled, now),
    createdAt: stamp,
    updatedAt: stamp,
  };

  const statements: Statements = [
    db.insert(targets).values(row),
    auditInsert(db, {
      actor: actor.email,
      ip: actor.ip,
      action: "target.create",
      entityType: "target",
      entityId: id,
      details: {
        name: row.name,
        projectTag: row.projectTag,
        connection: parsePgUrl(input.connectionUrl),
        hasRestoreUrl: row.restoreUrlEnc !== null,
        tunnelHostname: row.tunnelHostname,
        scheduleCron: row.scheduleCron,
        timezone: row.timezone,
        enabled: row.enabled,
        retention: { keepLast: row.keepLast, daily: row.keepDaily, weekly: row.keepWeekly, monthly: row.keepMonthly, maxAgeDays: row.maxAgeDays },
        jobDeadlineMinutes: row.jobDeadlineMinutes,
        staleAfterHours: row.staleAfterHours,
        alertFailureThreshold: row.alertFailureThreshold,
        alertChannelIds: input.alertChannelIds,
      },
    }),
  ];
  if (input.alertChannelIds.length > 0) statements.push(db.insert(targetAlertChannels).values(channelLinks(id, input.alertChannelIds)));

  await db.batch(statements);
  return getTarget(env, id);
}
```

- [ ] Step 2: Create `src/worker/routes/targets.ts`:
```ts
import { Hono } from "hono";
import { createTargetSchema } from "../../shared/target-schema";
import { parseBody } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, getTarget } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
```

- [ ] Step 3: Replace the whole of `src/worker/app.ts` with:
```ts
import { Hono } from "hono";
import pkg from "../../package.json";
import { access, type AppEnv } from "./middleware/access";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { targetRoutes } from "./routes/targets";

export const app = new Hono<AppEnv>();

app.onError(errorHandler);
app.notFound(notFoundHandler);

// Registration order matters: /api/health must be registered before the Access middleware.
app.get("/api/health", (c) => c.json({ ok: true, version: pkg.version }));
app.use("/api/*", access());
app.route("/api/targets", targetRoutes);
```

- [ ] Step 4: Create `test/worker/routes/targets.create.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { app } from "../../../src/worker/app";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { alertChannels, auditLogs, targetAlertChannels, targets } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { decrypt } from "../../../src/worker/lib/crypto";
import type { AppEnv } from "../../../src/worker/middleware/access";
import { errorHandler } from "../../../src/worker/middleware/error";
import { targetRoutes } from "../../../src/worker/routes/targets";
import { api, SECRETS, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));
afterEach(() => vi.useRealTimers());

async function seedChannel(id: string) {
  await getDb(env).insert(alertChannels).values({ id, type: "discord", name: id, credentialEnc: "v1:x:y", events: "[]", createdAt: "t", updatedAt: "t" });
}

describe("POST /api/targets", () => {
  it("creates a tunnel target with the owner defaults and masked connection info", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const res = await api(env).post("/api/targets", tunnelBody());
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      name: "Shop DB",
      projectTag: "shop",
      dbName: "shop",
      connection: { host: "db.example.com", port: 5432, dbName: "shop", user: "backup" },
      hasRestoreUrl: true,
      hasTunnelToken: true,
      tunnelHostname: "db.example.com",
      scheduleCron: "0 2 * * *",
      timezone: "Asia/Bangkok",
      enabled: true,
      retention: { keepLast: 3, daily: 7, weekly: 4, monthly: 6, maxAgeDays: null },
      jobDeadlineMinutes: 120,
      staleAfterHours: null,
      alertFailureThreshold: 3,
      nextRunAt: "2026-10-24T19:00:00.000Z",
      lastBackupAt: null,
      lastStatus: null,
      alertChannelIds: [],
      stats: { backupCount: 0, totalBackupBytes: 0 },
    });
    expect(res.json.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it("computes next_run_at for a UTC schedule", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T07:00:00Z"));
    const res = await api(env).post("/api/targets", tunnelBody({ timezone: "UTC", scheduleCron: "30 6 * * *" }));
    expect(res.json.nextRunAt).toBe("2026-10-25T06:30:00.000Z");
  });

  it("stores next_run_at as null for a disabled target", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ enabled: false }));
    expect(res.json).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it("never returns a secret, in the response or in the audit row, and stores them encrypted", async () => {
    const res = await api(env).post("/api/targets", tunnelBody());
    const db = getDb(env);
    const [row] = await db.select().from(targets);
    const [audit] = await db.select().from(auditLogs);
    for (const secret of SECRETS) {
      expect(res.text, secret).not.toContain(secret);
      expect(audit?.details, secret).not.toContain(secret);
      expect(JSON.stringify(row), secret).not.toContain(secret);
    }
    expect(res.text).not.toContain("_enc");
    expect(res.text).not.toContain("postgres://");
    expect(row?.connectionUrlEnc).toMatch(/^v1:/);
    expect(await decrypt(row?.connectionUrlEnc ?? "", env.ENCRYPTION_KEY)).toBe(tunnelBody().connectionUrl);
    expect(await decrypt(row?.tunnelTokenSecretEnc ?? "", env.ENCRYPTION_KEY)).toBe("token-secret-456");
  });

  it("derives db_name from the URL path and sanitizes it", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ connectionUrl: "postgres://u:p@h.example.com/my%20db.v2" }));
    expect(res.json).toMatchObject({ dbName: "my_db_v2", connection: { dbName: "my db.v2" } });
  });

  it("stores a custom alert failure threshold and rejects one out of bounds", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ alertFailureThreshold: 5 }));
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ alertFailureThreshold: 5 });
    const bad = await api(env).post("/api/targets", tunnelBody({ name: "Other", alertFailureThreshold: 0 }));
    expect(bad.status).toBe(400);
  });

  it("rejects a body without tunnel fields", async () => {
    const { tunnel: _tunnel, ...rest } = tunnelBody();
    const res = await api(env).post("/api/targets", rest);
    expect(res.status).toBe(400);
  });

  it("links existing alert channels and rejects unknown ones", async () => {
    await seedChannel("c1");
    await seedChannel("c2");
    const ok = await api(env).post("/api/targets", tunnelBody({ alertChannelIds: ["c2", "c1"] }));
    expect(ok.json.alertChannelIds).toEqual(["c1", "c2"]);
    const bad = await api(env).post("/api/targets", tunnelBody({ name: "Other", alertChannelIds: ["c1", "ghost"] }));
    expect(bad.status).toBe(400);
    expect(bad.json.error.details).toEqual([{ path: "alertChannelIds", message: "Unknown alert channel ids: ghost" }]);
    expect(await getDb(env).select().from(targets).where(eq(targets.name, "Other"))).toHaveLength(0);
  });

  it("rejects invalid input with 400 validation_error and creates nothing", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ scheduleCron: "61 * * * *" }, "scheduleCron"],
      [{ timezone: "Mars/Base" }, "timezone"],
      [{ connectionUrl: "mysql://u:p@h/db" }, "connectionUrl"],
      [{ tunnel: undefined }, "tunnel"],
      [{ tunnel: { hostname: "db.example.com", tokenId: "id" } }, "tunnel.tokenSecret"],
      [{ dbName: "shop" }, ""],
    ];
    for (const [override, path] of cases) {
      const res = await api(env).post("/api/targets", tunnelBody(override));
      expect(res.status, JSON.stringify(override)).toBe(400);
      expect(res.json.error.code).toBe("validation_error");
      expect(res.json.error.details.map((d: { path: string }) => d.path)).toContain(path);
    }
    expect(await getDb(env).select().from(targets)).toHaveLength(0);
  });

  it("does not echo a rejected URL's password", async () => {
    const res = await api(env).post("/api/targets", tunnelBody({ connectionUrl: "http://backup:leaky-pw@db.example.com/shop" }));
    expect(res.status).toBe(400);
    expect(res.text).not.toContain("leaky-pw");
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await app.request("http://localhost/api/targets", { method: "POST", body: "{nope" }, env);
    expect(res.status).toBe(400);
  });

  it("returns 409 for a duplicate name", async () => {
    await api(env).post("/api/targets", tunnelBody());
    const res = await api(env).post("/api/targets", tunnelBody());
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("conflict");
  });

  it("writes a target.create audit row for the authenticated actor", async () => {
    const asAlice = new Hono<AppEnv>();
    asAlice.onError(errorHandler);
    asAlice.use("*", async (c, next) => {
      c.set("actorEmail", "alice@example.com");
      await next();
    });
    asAlice.route("/api/targets", targetRoutes);
    const res = await api(env, asAlice).post("/api/targets", tunnelBody());
    const rows = await getDb(env).select().from(auditLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "alice@example.com", action: "target.create", entityType: "target", entityId: res.json.id });
    expect(JSON.parse(rows[0]?.details ?? "{}")).toMatchObject({ name: "Shop DB", connection: { host: "db.example.com", user: "backup" } });
  });

  it("returns 401 without a valid Access token when DEV_BYPASS is off", async () => {
    const res = await api({ ...env, DEV_BYPASS: "" }).post("/api/targets", tunnelBody());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/targets/:id", () => {
  it("returns the target, and the response never contains a secret", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    const res = await api(env).get(`/api/targets/${created.json.id}`);
    expect(res.status).toBe(200);
    expect(res.json).toEqual(created.json);
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
  });

  it("returns 404 not_found for an unknown id", async () => {
    const res = await api(env).get("/api/targets/nope");
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe("not_found");
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  14 passed (14)` and `Tests  122 passed (122)` (106 + 16 new); typecheck exits 0 with no output
- [ ] Step 6: Commit - `git add src/worker/services/targets.ts src/worker/routes/targets.ts src/worker/app.ts test/worker/routes/targets.create.test.ts && git commit -m "feat: add create and get target routes"`

---
### Task 12: List targets

**Files:**
- Modify: `src/worker/services/targets.ts` (append after `createTarget`), `src/worker/routes/targets.ts` (replace whole file)
- Test: `test/worker/routes/targets.list.test.ts`

**Interfaces:**
- Consumes: `paginationQuery`, `decodeCursor`, `toPage`, `Page` (Task 6); `parseQuery`; `loadStats`, `loadAlertChannelIds` (Task 10).
- Produces: `listTargets(env: Env, query: { limit: number; cursor?: string | undefined }): Promise<Page<TargetView>>` - not-deleted targets sorted by `name` ascending (binary order); cursor is `[name]`; `GET /api/targets?limit&cursor` returns `200 { items: TargetView[], nextCursor: string | null }`; bad `limit` or `cursor` is 400.

**Gotcha:** Fetch `limit + 1` rows; `toPage` drops the extra one. A full last page returns `nextCursor: null`. Stats and channel links are loaded once for all targets (no `IN` list). The stats test creates the alert-channel link through POST, so it does not depend on PATCH (Task 13).

**Steps:**
- [ ] Step 1: Append to `src/worker/services/targets.ts`:
```ts
export async function listTargets(env: Env, query: { limit: number; cursor?: string | undefined }): Promise<Page<TargetView>> {
  const db = getDb(env);
  const after = query.cursor ? decodeCursor(query.cursor, 1)[0] : undefined;
  const rows = await db
    .select()
    .from(targets)
    .where(and(isNull(targets.deletedAt), after === undefined ? undefined : gt(targets.name, after)))
    .orderBy(asc(targets.name))
    .limit(query.limit + 1);
  const [channels, stats] = await Promise.all([loadAlertChannelIds(db), loadStats(db)]);
  const views = await Promise.all(rows.map((row) => toTargetView(env, row, channels.get(row.id) ?? [], stats.get(row.id) ?? EMPTY_STATS)));
  return toPage(views, query.limit, (view) => [view.name]);
}
```

- [ ] Step 2: Replace the whole of `src/worker/routes/targets.ts` with:
```ts
import { Hono } from "hono";
import { createTargetSchema } from "../../shared/target-schema";
import { paginationQuery } from "../lib/pagination";
import { parseBody, parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, getTarget, listTargets } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.get("/", async (c) => c.json(await listTargets(c.env, parseQuery(c, paginationQuery))));

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
```

- [ ] Step 3: Create `test/worker/routes/targets.list.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { alertChannels, backups } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { api, SECRETS, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

const NAMES = ["delta", "alpha", "echo", "charlie", "สำรอง", "bravo"];
const SORTED = ["alpha", "bravo", "charlie", "delta", "echo", "สำรอง"];

async function createAll(names: string[]) {
  const ids: Record<string, string> = {};
  for (const name of names) {
    const res = await api(env).post("/api/targets", tunnelBody({ name }));
    ids[name] = res.json.id;
  }
  return ids;
}

function backupRow(targetId: string, id: string, overrides: Partial<typeof backups.$inferInsert> = {}): typeof backups.$inferInsert {
  return { id, targetId, status: "success", trigger: "manual", queuedAt: "2026-10-24T00:00:00.000Z", ...overrides };
}

describe("GET /api/targets", () => {
  it("returns an empty page", async () => {
    const res = await api(env).get("/api/targets");
    expect(res.json).toEqual({ items: [], nextCursor: null });
  });

  it("lists targets by name with the default limit and no cursor", async () => {
    await createAll(NAMES);
    const res = await api(env).get("/api/targets");
    expect(res.status).toBe(200);
    expect(res.json.items.map((t: { name: string }) => t.name)).toEqual(SORTED);
    expect(res.json.nextCursor).toBeNull();
  });

  it("pages through all targets with limit and cursor, with no repeats or gaps", async () => {
    await createAll(NAMES);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await api(env).get(`/api/targets?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.json.items.map((t: { name: string }) => t.name));
      cursor = res.json.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toEqual(SORTED);
    expect(pages).toBe(3);
  });

  it("returns exactly nextCursor null when the last page is full", async () => {
    await createAll(["a", "b"]);
    const res = await api(env).get("/api/targets?limit=2");
    expect(res.json.items).toHaveLength(2);
    expect(res.json.nextCursor).toBeNull();
  });

  it("rejects a bad limit or cursor with 400", async () => {
    for (const query of ["limit=0", "limit=201", "limit=abc", "cursor=%21%21%21"]) {
      const res = await api(env).get(`/api/targets?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.json.error.code).toBe("validation_error");
    }
  });

  it("includes alert channel ids and backup stats, counting only successful, not-deleted backups", async () => {
    const db = getDb(env);
    await db.insert(alertChannels).values({ id: "c1", type: "line", name: "ops", credentialEnc: "v1:x:y", events: "[]", createdAt: "t", updatedAt: "t" });
    const ids = await createAll(["bravo"]);
    const created = await api(env).post("/api/targets", tunnelBody({ name: "alpha", alertChannelIds: ["c1"] }));
    ids.alpha = created.json.id;
    await db.insert(backups).values([
      backupRow(ids.alpha ?? "", "b1", { sizeBytes: 100 }),
      backupRow(ids.alpha ?? "", "b2", { sizeBytes: 200 }),
      backupRow(ids.alpha ?? "", "b3", { status: "failed", sizeBytes: 999 }),
      backupRow(ids.alpha ?? "", "b4", { sizeBytes: 5000, deletedAt: "2026-10-24T01:00:00.000Z" }),
    ]);
    const res = await api(env).get("/api/targets");
    const [alpha, bravo] = res.json.items;
    expect(alpha).toMatchObject({ name: "alpha", alertChannelIds: ["c1"], stats: { backupCount: 2, totalBackupBytes: 300 } });
    expect(bravo).toMatchObject({ name: "bravo", alertChannelIds: [], stats: { backupCount: 0, totalBackupBytes: 0 } });
  });

  it("never contains a secret", async () => {
    await createAll(["alpha"]);
    const res = await api(env).get("/api/targets");
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
    expect(res.text).not.toContain("_enc");
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  15 passed (15)` and `Tests  129 passed (129)` (122 + 7 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/services/targets.ts src/worker/routes/targets.ts test/worker/routes/targets.list.test.ts && git commit -m "feat: add paginated target list with backup stats"`

---
### Task 13: Update a target

**Files:**
- Modify: `src/worker/services/targets.ts` (append after `listTargets`), `src/worker/routes/targets.ts` (replace whole file)
- Test: `test/worker/routes/targets.update.test.ts`

**Interfaces:**
- Consumes: `updateTargetSchema`, `UpdateTargetInput` (Task 9); `auditInsert`; `nextRun`; `encrypt`; `dbNameOf`, `scheduleFor`, `assertNameFree`, `assertChannelsExist`, `requireTarget`, `channelLinks` (private helpers already in `services/targets.ts`).
- Produces: `updateTarget(env: Env, id: string, input: UpdateTargetInput, actor: Actor): Promise<TargetView>`; `PATCH /api/targets/:id` returns `200 TargetView`, 400 for invalid input, 404 for unknown or deleted, 409 for a taken name.

**Gotcha:**
- Omitted secret fields are not re-encrypted: `patch` never contains those columns, so the stored ciphertext stays byte for byte (the first test compares the raw rows).
- `next_run_at` is only touched when cron, timezone, or `enabled` differs from the stored row.
- Audit details are `{ ...plainFields, tunnelHostname, secretsChanged }` where `secretsChanged` lists the NAMES of secret fields in the request (`connectionUrl`, `restoreUrl`, `tunnel.tokenId`, `tunnel.tokenSecret`). The test sends `audit-leak-pw` and asserts it is absent.
- Tunnel only (owner round 2): each supplied `tunnel` part replaces its column; omitted parts keep the stored value. The columns are NOT NULL, so there is no completeness check after the merge.
- Spread order matters in the audit details: `plainFields` excludes `connectionUrl`, `restoreUrl`, and `tunnel` by destructuring.

**Steps:**
- [ ] Step 1: Append to `src/worker/services/targets.ts`:
```ts
export async function updateTarget(env: Env, id: string, input: UpdateTargetInput, actor: Actor): Promise<TargetView> {
  const db = getDb(env);
  const row = await requireTarget(db, id);
  const key = env.ENCRYPTION_KEY;
  if (input.name !== undefined) await assertNameFree(db, input.name, id);
  if (input.alertChannelIds) await assertChannelsExist(db, input.alertChannelIds);

  const patch: Partial<typeof targets.$inferInsert> = {};
  if (input.tunnel?.hostname !== undefined) patch.tunnelHostname = input.tunnel.hostname;
  if (input.tunnel?.tokenId !== undefined) patch.tunnelTokenIdEnc = await encrypt(input.tunnel.tokenId, key);
  if (input.tunnel?.tokenSecret !== undefined) patch.tunnelTokenSecretEnc = await encrypt(input.tunnel.tokenSecret, key);

  if (input.name !== undefined) patch.name = input.name;
  if (input.projectTag !== undefined) patch.projectTag = input.projectTag;
  if (input.connectionUrl !== undefined) {
    patch.connectionUrlEnc = await encrypt(input.connectionUrl, key);
    patch.dbName = dbNameOf(input.connectionUrl);
  }
  if (input.restoreUrl !== undefined) patch.restoreUrlEnc = input.restoreUrl === null ? null : await encrypt(input.restoreUrl, key);
  if (input.retention?.keepLast !== undefined) patch.keepLast = input.retention.keepLast;
  if (input.retention?.daily !== undefined) patch.keepDaily = input.retention.daily;
  if (input.retention?.weekly !== undefined) patch.keepWeekly = input.retention.weekly;
  if (input.retention?.monthly !== undefined) patch.keepMonthly = input.retention.monthly;
  if (input.retention?.maxAgeDays !== undefined) patch.maxAgeDays = input.retention.maxAgeDays;
  if (input.jobDeadlineMinutes !== undefined) patch.jobDeadlineMinutes = input.jobDeadlineMinutes;
  if (input.staleAfterHours !== undefined) patch.staleAfterHours = input.staleAfterHours;
  if (input.alertFailureThreshold !== undefined) patch.alertFailureThreshold = input.alertFailureThreshold;

  const scheduleCron = input.scheduleCron ?? row.scheduleCron;
  const timezone = input.timezone ?? row.timezone;
  const enabled = input.enabled ?? row.enabled;
  patch.scheduleCron = scheduleCron;
  patch.timezone = timezone;
  patch.enabled = enabled;
  const now = new Date();
  if (scheduleCron !== row.scheduleCron || timezone !== row.timezone || enabled !== row.enabled) {
    patch.nextRunAt = scheduleFor(scheduleCron, timezone, enabled, now);
  }
  patch.updatedAt = now.toISOString();

  const { connectionUrl, restoreUrl, tunnel, ...plainFields } = input;
  const secretsChanged = [
    connectionUrl !== undefined && "connectionUrl",
    restoreUrl !== undefined && "restoreUrl",
    tunnel?.tokenId !== undefined && "tunnel.tokenId",
    tunnel?.tokenSecret !== undefined && "tunnel.tokenSecret",
  ].filter(Boolean);

  const statements: Statements = [
    db.update(targets).set(patch).where(eq(targets.id, id)),
    auditInsert(db, {
      actor: actor.email,
      ip: actor.ip,
      action: "target.update",
      entityType: "target",
      entityId: id,
      details: { ...plainFields, tunnelHostname: tunnel?.hostname, secretsChanged },
    }),
  ];
  if (input.alertChannelIds) {
    statements.push(db.delete(targetAlertChannels).where(eq(targetAlertChannels.targetId, id)));
    if (input.alertChannelIds.length > 0) statements.push(db.insert(targetAlertChannels).values(channelLinks(id, input.alertChannelIds)));
  }
  await db.batch(statements);
  return getTarget(env, id);
}
```

- [ ] Step 2: Replace the whole of `src/worker/routes/targets.ts` with:
```ts
import { Hono } from "hono";
import { createTargetSchema, updateTargetSchema } from "../../shared/target-schema";
import { paginationQuery } from "../lib/pagination";
import { parseBody, parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, getTarget, listTargets, updateTarget } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.get("/", async (c) => c.json(await listTargets(c.env, parseQuery(c, paginationQuery))));

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

targetRoutes.patch("/:id", async (c) => {
  const input = await parseBody(c, updateTargetSchema);
  return c.json(await updateTarget(c.env, c.req.param("id"), input, actorOf(c)));
});

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
```

- [ ] Step 3: Create `test/worker/routes/targets.update.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { alertChannels, auditLogs, targetAlertChannels, targets } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { decrypt } from "../../../src/worker/lib/crypto";
import { api, SECRETS, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));
afterEach(() => vi.useRealTimers());

async function create(overrides: Record<string, unknown> = {}) {
  const res = await api(env).post("/api/targets", tunnelBody(overrides));
  expect(res.status).toBe(201);
  return res.json as { id: string; nextRunAt: string | null };
}

async function rowOf(id: string) {
  const [row] = await getDb(env).select().from(targets).where(eq(targets.id, id));
  if (!row) throw new Error("row missing");
  return row;
}

describe("PATCH /api/targets/:id", () => {
  it("keeps every stored secret byte for byte when the secret fields are omitted", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    const res = await api(env).patch(`/api/targets/${id}`, { name: "Renamed", scheduleCron: "0 3 * * *", retention: { daily: 14 } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ name: "Renamed", scheduleCron: "0 3 * * *", retention: { keepLast: 3, daily: 14, weekly: 4, monthly: 6, maxAgeDays: null } });
    const after = await rowOf(id);
    for (const column of ["connectionUrlEnc", "restoreUrlEnc", "tunnelTokenIdEnc", "tunnelTokenSecretEnc", "tunnelHostname", "dbName"] as const) {
      expect(after[column], column).toBe(before[column]);
    }
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
  });

  it("re-encrypts a new connection URL and updates db_name and the masked connection", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    const res = await api(env).patch(`/api/targets/${id}`, { connectionUrl: "postgres://other:new-pw@db2.example.com:6000/orders" });
    expect(res.json).toMatchObject({ dbName: "orders", connection: { host: "db2.example.com", port: 6000, dbName: "orders", user: "other" } });
    expect(res.text).not.toContain("new-pw");
    const after = await rowOf(id);
    expect(after.connectionUrlEnc).not.toBe(before.connectionUrlEnc);
    expect(await decrypt(after.connectionUrlEnc, env.ENCRYPTION_KEY)).toBe("postgres://other:new-pw@db2.example.com:6000/orders");
    expect(after.tunnelTokenSecretEnc).toBe(before.tunnelTokenSecretEnc);
  });

  it("replaces only the tunnel token secret when only that is sent", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    await api(env).patch(`/api/targets/${id}`, { tunnel: { tokenSecret: "rotated-secret" } });
    const after = await rowOf(id);
    expect(await decrypt(after.tunnelTokenSecretEnc ?? "", env.ENCRYPTION_KEY)).toBe("rotated-secret");
    expect(after.tunnelTokenIdEnc).toBe(before.tunnelTokenIdEnc);
    expect(after.tunnelHostname).toBe(before.tunnelHostname);
  });

  it("sets or clears the restore URL and the project tag", async () => {
    const { id } = await create();
    const cleared = await api(env).patch(`/api/targets/${id}`, { restoreUrl: null, projectTag: null });
    expect(cleared.json).toMatchObject({ hasRestoreUrl: false, projectTag: null });
    const set = await api(env).patch(`/api/targets/${id}`, { restoreUrl: "postgres://r:r2@db.example.com/shop" });
    expect(set.json.hasRestoreUrl).toBe(true);
  });

  it("recomputes next_run_at when cron or timezone changes (Asia/Bangkok and UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const { id, nextRunAt } = await create();
    expect(nextRunAt).toBe("2026-10-24T19:00:00.000Z");
    const utc = await api(env).patch(`/api/targets/${id}`, { timezone: "UTC" });
    expect(utc.json.nextRunAt).toBe("2026-10-24T02:00:00.000Z");
    const cron = await api(env).patch(`/api/targets/${id}`, { scheduleCron: "30 6 * * *" });
    expect(cron.json.nextRunAt).toBe("2026-10-24T06:30:00.000Z");
  });

  it("sets next_run_at to null when disabled and recomputes it when enabled again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const { id } = await create();
    const off = await api(env).patch(`/api/targets/${id}`, { enabled: false });
    expect(off.json).toMatchObject({ enabled: false, nextRunAt: null });
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    const on = await api(env).patch(`/api/targets/${id}`, { enabled: true });
    expect(on.json).toMatchObject({ enabled: true, nextRunAt: "2026-10-26T19:00:00.000Z" });
  });

  it("leaves next_run_at alone when schedule, timezone, and enabled do not change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
    const { id } = await create();
    vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
    const res = await api(env).patch(`/api/targets/${id}`, { name: "Renamed", scheduleCron: "0 2 * * *", enabled: true });
    expect(res.json.nextRunAt).toBe("2026-10-24T19:00:00.000Z");
  });

  it("merges retention field by field and lets null switch a rule off", async () => {
    const { id } = await create();
    const res = await api(env).patch(`/api/targets/${id}`, { retention: { keepLast: null, maxAgeDays: 90 } });
    expect(res.json.retention).toEqual({ keepLast: null, daily: 7, weekly: 4, monthly: 6, maxAgeDays: 90 });
  });

  it("replaces only the supplied tunnel part and keeps the other tunnel columns", async () => {
    const { id } = await create();
    const before = await rowOf(id);
    const res = await api(env).patch(`/api/targets/${id}`, { tunnel: { hostname: "db2.example.com" } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tunnelHostname: "db2.example.com", hasTunnelToken: true });
    const after = await rowOf(id);
    expect([after.tunnelTokenIdEnc, after.tunnelTokenSecretEnc]).toEqual([before.tunnelTokenIdEnc, before.tunnelTokenSecretEnc]);
  });

  it("updates the alert failure threshold and rejects one out of bounds", async () => {
    const { id } = await create();
    const res = await api(env).patch(`/api/targets/${id}`, { alertFailureThreshold: 7 });
    expect(res.json).toMatchObject({ alertFailureThreshold: 7 });
    expect((await rowOf(id)).alertFailureThreshold).toBe(7);
    expect((await api(env).patch(`/api/targets/${id}`, { alertFailureThreshold: 101 })).status).toBe(400);
  });

  it("rejects connectionMode as an unknown field", async () => {
    const { id } = await create();
    const res = await api(env).patch(`/api/targets/${id}`, { connectionMode: "tunnel" });
    expect(res.status).toBe(400);
  });

  it("replaces, keeps, and clears alert channel links", async () => {
    for (const id of ["c1", "c2"]) {
      await getDb(env).insert(alertChannels).values({ id, type: "discord", name: id, credentialEnc: "v1:x:y", events: "[]", createdAt: "t", updatedAt: "t" });
    }
    const { id } = await create({ alertChannelIds: ["c1"] });
    expect((await api(env).patch(`/api/targets/${id}`, { alertChannelIds: ["c2"] })).json.alertChannelIds).toEqual(["c2"]);
    expect((await api(env).patch(`/api/targets/${id}`, { name: "Renamed" })).json.alertChannelIds).toEqual(["c2"]);
    expect((await api(env).patch(`/api/targets/${id}`, { alertChannelIds: [] })).json.alertChannelIds).toEqual([]);
    expect(await getDb(env).select().from(targetAlertChannels)).toHaveLength(0);
    const bad = await api(env).patch(`/api/targets/${id}`, { alertChannelIds: ["ghost"] });
    expect(bad.status).toBe(400);
  });

  it("returns 400 for an empty body or invalid values, 404 for unknown or deleted targets, 409 for a taken name", async () => {
    const { id } = await create();
    await create({ name: "Second" });
    expect((await api(env).patch(`/api/targets/${id}`, {})).status).toBe(400);
    expect((await api(env).patch(`/api/targets/${id}`, { scheduleCron: "nope" })).status).toBe(400);
    expect((await api(env).patch(`/api/targets/${id}`, { timezone: "Mars/Base" })).status).toBe(400);
    expect((await api(env).patch("/api/targets/missing", { name: "x" })).status).toBe(404);
    expect((await api(env).patch(`/api/targets/${id}`, { name: "Second" })).status).toBe(409);
    expect((await api(env).patch(`/api/targets/${id}`, { name: "Shop DB" })).status).toBe(200);
  });

  it("writes a target.update audit row that lists changed secrets by name only", async () => {
    const { id } = await create();
    await api(env).patch(`/api/targets/${id}`, { name: "Renamed", connectionUrl: "postgres://u:audit-leak-pw@h.example.com/db", tunnel: { tokenSecret: "audit-leak-secret" } });
    const rows = await getDb(env).select().from(auditLogs).where(eq(auditLogs.action, "target.update"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "dev@localhost", entityType: "target", entityId: id });
    const details = JSON.parse(rows[0]?.details ?? "{}");
    expect(details).toMatchObject({ name: "Renamed", secretsChanged: ["connectionUrl", "tunnel.tokenSecret"] });
    expect(rows[0]?.details).not.toContain("audit-leak");
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  16 passed (16)` and `Tests  143 passed (143)` (129 + 14 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/services/targets.ts src/worker/routes/targets.ts test/worker/routes/targets.update.test.ts && git commit -m "feat: add target update with secret-preserving patch"`

---
### Task 14: Soft-delete a target

**Files:**
- Modify: `src/worker/services/targets.ts` (append after `updateTarget`), `src/worker/routes/targets.ts` (replace whole file)
- Test: `test/worker/routes/targets.delete.test.ts`

**Interfaces:**
- Consumes: `requireTarget`, `auditInsert`, `Actor`.
- Produces: `deleteTarget(env: Env, id: string, actor: Actor): Promise<void>`; `DELETE /api/targets/:id` returns `204` with an empty body, or 404 for unknown or already-deleted.

**Gotcha:** Only the `targets` row changes (`deleted_at`, `enabled` false, `next_run_at` null, `updated_at`). Backups, R2 objects, alert links, and history are left alone. The name is free for reuse at once (partial `uq_targets_name`, owner round 2); a new target with that name gets a new id and its own history.

**Steps:**
- [ ] Step 1: Append to `src/worker/services/targets.ts`:
```ts
export async function deleteTarget(env: Env, id: string, actor: Actor): Promise<void> {
  const db = getDb(env);
  const row = await requireTarget(db, id);
  const stamp = new Date().toISOString();
  await db.batch([
    db.update(targets).set({ deletedAt: stamp, enabled: false, nextRunAt: null, updatedAt: stamp }).where(eq(targets.id, id)),
    auditInsert(db, { actor: actor.email, ip: actor.ip, action: "target.delete", entityType: "target", entityId: id, details: { name: row.name } }),
  ]);
}
```

- [ ] Step 2: Replace the whole of `src/worker/routes/targets.ts` with:
```ts
import { Hono } from "hono";
import { createTargetSchema, updateTargetSchema } from "../../shared/target-schema";
import { paginationQuery } from "../lib/pagination";
import { parseBody, parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { createTarget, deleteTarget, getTarget, listTargets, updateTarget } from "../services/targets";

export const targetRoutes = new Hono<AppEnv>();

targetRoutes.get("/", async (c) => c.json(await listTargets(c.env, parseQuery(c, paginationQuery))));

targetRoutes.post("/", async (c) => {
  const input = await parseBody(c, createTargetSchema);
  return c.json(await createTarget(c.env, input, actorOf(c)), 201);
});

targetRoutes.get("/:id", async (c) => c.json(await getTarget(c.env, c.req.param("id"))));

targetRoutes.patch("/:id", async (c) => {
  const input = await parseBody(c, updateTargetSchema);
  return c.json(await updateTarget(c.env, c.req.param("id"), input, actorOf(c)));
});

targetRoutes.delete("/:id", async (c) => {
  await deleteTarget(c.env, c.req.param("id"), actorOf(c));
  return c.body(null, 204);
});

function actorOf(c: { get(key: "actorEmail"): string; req: { header(name: string): string | undefined } }) {
  return { email: c.get("actorEmail"), ip: c.req.header("CF-Connecting-IP") ?? null };
}
```

- [ ] Step 3: Create `test/worker/routes/targets.delete.test.ts`:
```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs, backups, targets } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { api, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

describe("DELETE /api/targets/:id", () => {
  it("soft deletes: 204, hidden from get and list, schedule stopped, backups kept", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    const id = created.json.id as string;
    await getDb(env).insert(backups).values({ id: "b1", targetId: id, status: "success", trigger: "manual", queuedAt: "2026-10-24T00:00:00.000Z", sizeBytes: 10 });

    const res = await api(env).delete(`/api/targets/${id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    expect((await api(env).get(`/api/targets/${id}`)).status).toBe(404);
    expect((await api(env).get("/api/targets")).json.items).toEqual([]);

    const [row] = await getDb(env).select().from(targets).where(eq(targets.id, id));
    expect(row?.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row).toMatchObject({ enabled: false, nextRunAt: null });
    const kept = await getDb(env).select().from(backups).where(eq(backups.targetId, id));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.deletedAt).toBeNull();
  });

  it("returns 404 for an unknown id and for a second delete", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    expect((await api(env).delete("/api/targets/missing")).status).toBe(404);
    expect((await api(env).delete(`/api/targets/${created.json.id}`)).status).toBe(204);
    expect((await api(env).delete(`/api/targets/${created.json.id}`)).status).toBe(404);
  });

  it("cannot patch a deleted target, and its name can be reused by a new target", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    await api(env).delete(`/api/targets/${created.json.id}`);
    expect((await api(env).patch(`/api/targets/${created.json.id}`, { enabled: true })).status).toBe(404);
    const reused = await api(env).post("/api/targets", tunnelBody());
    expect(reused.status).toBe(201);
    expect(reused.json.id).not.toBe(created.json.id);
    expect((await api(env).post("/api/targets", tunnelBody())).status).toBe(409);
  });

  it("writes a target.delete audit row for the actor", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    await api(env).delete(`/api/targets/${created.json.id}`);
    const [row] = await getDb(env).select().from(auditLogs).where(eq(auditLogs.action, "target.delete"));
    expect(row).toMatchObject({ actor: "dev@localhost", entityType: "target", entityId: created.json.id });
    expect(JSON.parse(row?.details ?? "{}")).toEqual({ name: "Shop DB" });
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  17 passed (17)` and `Tests  147 passed (147)` (143 + 4 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/services/targets.ts src/worker/routes/targets.ts test/worker/routes/targets.delete.test.ts && git commit -m "feat: add target soft delete"`

---
### Task 15: Audit log list

**Files:**
- Create: `src/worker/routes/audit-logs.ts`
- Modify: `src/worker/app.ts` (anchor: `app.route("/api/targets", targetRoutes);`)
- Test: `test/worker/routes/audit-logs.test.ts`

**Interfaces:**
- Consumes: `paginationQuery`, `decodeCursor`, `toPage` (Task 6); `parseQuery`; `getDb`; `auditLogs`.
- Produces: `auditLogRoutes: Hono<AppEnv>` mounted at `/api/audit-logs`. `GET /api/audit-logs?entityType&entityId&limit&cursor` returns `200 { items, nextCursor }`, newest first. Each item is `{ id, at, actor, action, entityType, entityId, details, ip }` where `details` is the parsed JSON (or the raw string if it is not valid JSON, or `null`). Phase 9 reads this route.

**Gotcha:** Sort is `at DESC, id DESC`; the cursor is `[at, id]` and the next page is `at < cursor.at OR (at = cursor.at AND id < cursor.id)`, so rows with the same millisecond are never repeated or skipped (the test inserts three rows with one timestamp). Query values are validated by Zod; `limit` above 200 is 400.

**Steps:**
- [ ] Step 1: Create `src/worker/routes/audit-logs.ts`:
```ts
import { and, desc, eq, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { auditLogs } from "../db/schema";
import { decodeCursor, paginationQuery, toPage } from "../lib/pagination";
import { parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";

const auditQuery = paginationQuery.extend({ entityType: z.string().min(1).optional(), entityId: z.string().min(1).optional() });

export const auditLogRoutes = new Hono<AppEnv>();

auditLogRoutes.get("/", async (c) => {
  const query = parseQuery(c, auditQuery);
  const [at, id] = query.cursor ? decodeCursor(query.cursor, 2) : [];
  const rows = await getDb(c.env)
    .select()
    .from(auditLogs)
    .where(
      and(
        query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined,
        query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined,
        at === undefined || id === undefined ? undefined : or(lt(auditLogs.at, at), and(eq(auditLogs.at, at), lt(auditLogs.id, id))),
      ),
    )
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(query.limit + 1);
  const items = rows.map((row) => ({ ...row, details: row.details === null ? null : parseDetails(row.details) }));
  return c.json(toPage(items, query.limit, (row) => [row.at, row.id]));
});

function parseDetails(details: string): unknown {
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}
```

- [ ] Step 2: Replace the whole of `src/worker/app.ts` with:
```ts
import { Hono } from "hono";
import pkg from "../../package.json";
import { access, type AppEnv } from "./middleware/access";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { auditLogRoutes } from "./routes/audit-logs";
import { targetRoutes } from "./routes/targets";

export const app = new Hono<AppEnv>();

app.onError(errorHandler);
app.notFound(notFoundHandler);

// Registration order matters: /api/health must be registered before the Access middleware.
app.get("/api/health", (c) => c.json({ ok: true, version: pkg.version }));
app.use("/api/*", access());
app.route("/api/targets", targetRoutes);
app.route("/api/audit-logs", auditLogRoutes);
```

- [ ] Step 3: Create `test/worker/routes/audit-logs.test.ts`:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../../src/worker/db/client";
import { auditLogs } from "../../../src/worker/db/schema";
import type { Env } from "../../../src/worker/env";
import { api, SECRETS, tunnelBody } from "../../helpers/api";
import { createTestEnv, resetDb } from "../../helpers/env";

let env: Env;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterAll(() => dispose());
beforeEach(() => resetDb(env));

function row(id: string, at: string, overrides: Partial<typeof auditLogs.$inferInsert> = {}): typeof auditLogs.$inferInsert {
  return { id, at, actor: "alice@example.com", action: "target.update", entityType: "target", entityId: "t1", details: null, ip: null, ...overrides };
}

describe("GET /api/audit-logs", () => {
  it("returns an empty page", async () => {
    expect((await api(env).get("/api/audit-logs")).json).toEqual({ items: [], nextCursor: null });
  });

  it("lists newest first, with parsed details, after create, update, and delete", async () => {
    const created = await api(env).post("/api/targets", tunnelBody());
    const id = created.json.id as string;
    await api(env).patch(`/api/targets/${id}`, { name: "Renamed" });
    await api(env).delete(`/api/targets/${id}`);
    const res = await api(env).get("/api/audit-logs");
    expect(res.status).toBe(200);
    expect(res.json.items.map((item: { action: string }) => item.action)).toEqual(["target.delete", "target.update", "target.create"]);
    expect(res.json.items[0]).toMatchObject({ actor: "dev@localhost", entityType: "target", entityId: id, details: { name: "Renamed" } });
    for (const secret of SECRETS) expect(res.text).not.toContain(secret);
  });

  it("filters by entityType and entityId", async () => {
    await getDb(env).insert(auditLogs).values([
      row("a", "2026-10-24T01:00:00.000Z"),
      row("b", "2026-10-24T02:00:00.000Z", { entityId: "t2" }),
      row("c", "2026-10-24T03:00:00.000Z", { entityType: "backup", entityId: "b1", action: "backup.delete" }),
    ]);
    const ids = async (query: string) => (await api(env).get(`/api/audit-logs?${query}`)).json.items.map((i: { id: string }) => i.id);
    expect(await ids("entityType=target")).toEqual(["b", "a"]);
    expect(await ids("entityType=target&entityId=t1")).toEqual(["a"]);
    expect(await ids("entityId=b1")).toEqual(["c"]);
    expect(await ids("entityType=nothing")).toEqual([]);
  });

  it("pages newest first without repeats or gaps, including rows with the same timestamp", async () => {
    const same = "2026-10-24T05:00:00.000Z";
    await getDb(env).insert(auditLogs).values([
      row("r1", "2026-10-24T01:00:00.000Z"),
      row("r2", same),
      row("r3", same),
      row("r4", same),
      row("r5", "2026-10-24T09:00:00.000Z"),
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await api(env).get(`/api/audit-logs?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.json.items.map((i: { id: string }) => i.id));
      cursor = res.json.nextCursor;
    } while (cursor);
    expect(seen).toEqual(["r5", "r4", "r3", "r2", "r1"]);
  });

  it("returns details that is not valid JSON as plain text, and rejects bad limits and cursors", async () => {
    await getDb(env).insert(auditLogs).values(row("x", "2026-10-24T01:00:00.000Z", { details: "plain text" }));
    expect((await api(env).get("/api/audit-logs")).json.items[0].details).toBe("plain text");
    for (const query of ["limit=0", "limit=201", "cursor=%21%21%21"]) {
      expect((await api(env).get(`/api/audit-logs?${query}`)).status, query).toBe(400);
    }
  });
});
```

- [ ] Verify - Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  18 passed (18)` and `Tests  152 passed (152)` (147 + 5 new); typecheck exits 0 with no output
- [ ] Step 5: Commit - `git add src/worker/routes/audit-logs.ts src/worker/app.ts test/worker/routes/audit-logs.test.ts && git commit -m "feat: add paginated audit log route"`

---
### Task 16: Sync docs/PLAN.md with Phase 2

**Files:**
- Modify: `docs/PLAN.md` (anchors listed per edit below)

**Interfaces:**
- Consumes: the decisions in "Decisions that differ from the PRD / docs/PLAN.md".
- Produces: PLAN.md consistent with the code. Phase 1 Task 6 edits other lines (`src/`, `test/`, `lib/uuidv7.ts` mention, `still behind Access`); these edits do not overlap with it.

**Steps:**
- [ ] Step 1: Apply the 11 replacements below to `docs/PLAN.md`. Each `old` text occurs exactly once (checked against PLAN.md after the owner's round 2 edits; if one does not match, grep the anchor and adjust minimally). The owner already applied the `middleware/` line, the `name` uniqueness row, tunnel-only wording, `alertFailureThreshold`, and `stats`, so those are not repeated. Section 4 table rows keep their `|` characters.

1. **Section 2 (structure).**

old:

```text
routes/  targets.ts  backups.ts  restores.ts  alerts.ts  settings.ts  audit.ts  internal.ts
```

new:

```text
routes/  targets.ts  backups.ts  restores.ts  alerts.ts  settings.ts  audit-logs.ts  internal.ts
```

2. **Section 2 (structure).**

old:

```text
lib/  crypto.ts  redact.ts  r2-key.ts  uuidv7.ts  audit.ts  validate.ts  s3-presign.ts
```

new:

```text
lib/  crypto.ts  redact.ts  r2-key.ts  uuidv7.ts  audit.ts  api-error.ts  validate.ts  pagination.ts  s3-presign.ts
```

3. **Section 2 (notes).**

old:

```text
- The container entrypoint is TypeScript and runs on Bun.
```

new:

```text
- The container entrypoint is TypeScript and runs on Bun.
- `src/shared/` (`tz.ts`, `cron.ts`, `pg-url.ts`, `target-schema.ts`) holds code used by both the Worker and the UI, with tests in `test/shared/`. `src/worker/services/` holds the D1 logic that routes call. `test/helpers/` holds the shared D1/R2/Queue test harness (`getPlatformProxy`).
- Audit rows are written by `src/worker/lib/audit.ts` (a helper, not middleware). Services commit the audit insert in the same `db.batch` as the change.
- Cron grammar is numeric 5-field (no names, no @macros). A wall time inside a DST gap runs just after the gap; a wall time that happens twice runs once.
```

4. **Section 3 (targets).**

old:

```text
| db_name | text NOT NULL | used in R2 key; sanitized `[A-Za-z0-9_-]` |
```

new:

```text
| db_name | text NOT NULL | derived from the connection URL path (not a request field); used in R2 key; sanitized `[A-Za-z0-9_-]` |
```

5. **Section 4 (routes).**

old:

```text
| GET /api/targets | - | `{ items: Target[] }` |
```

new:

```text
| GET /api/targets | `?limit&cursor` | `{ items: Target[], nextCursor }`, sorted by name |
```

6. **Section 4 (routes).**

old:

```text
| POST /api/targets | `{ name, projectTag?, connectionUrl, restoreUrl?, tunnel:{hostname,tokenId,tokenSecret}, scheduleCron?, timezone?, retention?:{keepLast?,daily?,weekly?,monthly?,maxAgeDays?}, jobDeadlineMinutes?, staleAfterHours?, alertFailureThreshold?, alertChannelIds?, enabled? }` (omitted fields take the defaults in section 3; `db_name` is derived from the connection URL) | `201 Target` |
```

new:

```text
| POST /api/targets | `{ name, projectTag?, connectionUrl, restoreUrl?, tunnel:{hostname,tokenId,tokenSecret}, scheduleCron?, timezone?, retention?:{keepLast?,daily?,weekly?,monthly?,maxAgeDays?}, jobDeadlineMinutes?, staleAfterHours?, alertFailureThreshold?, alertChannelIds?, enabled? }` (unknown keys are rejected; `alertFailureThreshold` is 1 to 100, default 3; omitted fields take the defaults in section 3; `db_name` is derived from the connection URL) | `201 Target` |
```

7. **Section 4 (routes).**

old:

```text
| GET /api/targets/:id | - | `Target` (+ latest backup) |
```

new:

```text
| GET /api/targets/:id | - | `Target` |
```

8. **Section 4 (routes).**

old:

```text
| PATCH /api/targets/:id | partial of POST body; omitted secret fields keep their stored values; `alertChannelIds` replaces the set when present | `Target` |
```

new:

```text
| PATCH /api/targets/:id | partial of POST body; omitted secret fields keep their stored values; each supplied `tunnel` part replaces only that part; `restoreUrl: null` and `projectTag: null` clear; `retention` merges per field; `alertChannelIds` replaces the set when present | `Target` |
```

9. **Section 4 (intro).**

old:

```text
Errors: `{ "error": { "code": string, "message": string } }` with redacted messages.
```

new:

```text
Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with redacted messages. Codes: `validation_error` (400, `details` is `{ path, message }[]`), `unauthorized` (401), `not_found` (404), `conflict` (409), `internal_error` (500).
```

10. **Section 4 (intro).**

old:

```text
Secrets are write-only: responses show `has_connection_url: true`, never the value.
```

new:

```text
Secrets are write-only: responses show `connection: { host, port, dbName, user }`, `hasRestoreUrl`, and `hasTunnelToken`, never a URL, token, or `*_enc` value.
```

11. **Section 4 (after the table).**

old:

```text
`Target` fields mirror the schema minus `*_enc`. Connection info is `connection: { host, port, dbName, user }` plus booleans `hasRestoreUrl` and `hasTunnelToken`. The response also has `stats: { backupCount, totalBackupBytes }`, counting only non-deleted success backups, and `alertChannelIds`.
```

new:

```text
`Target` fields: id, name, projectTag, dbName, connection (`{ host, port, dbName, user }`), hasRestoreUrl, hasTunnelToken, tunnelHostname, scheduleCron, timezone, enabled, retention, jobDeadlineMinutes, staleAfterHours, alertFailureThreshold, nextRunAt, lastBackupAt, lastStatus, alertChannelIds, stats (`{ backupCount, totalBackupBytes }`, counting only non-deleted success backups), createdAt, updatedAt.
```

- [ ] Step 2: Verify - Run: `grep -c "audit-logs.ts" docs/PLAN.md; grep -c "latest backup" docs/PLAN.md; grep -c "has_connection_url" docs/PLAN.md; grep -c "Cron grammar" docs/PLAN.md; grep -c "connectionMode" docs/PLAN.md; grep -c $'\xe2\x80\x94' docs/PLAN.md` - Expected: `1`, `0`, `0`, `1`, `0`, `0`
- [ ] Step 3: Commit - `git add docs/PLAN.md && git commit -m "docs: align PLAN.md with phase 2"`

---

## Failure handling summary

- **`getPlatformProxy` fails to start workerd (binary missing, sandbox error)** - Detect: Task 4 verify errors mention `workerd`, `ENOENT`, or a spawn failure. Respond: run `bunx wrangler --version` and retry once; if it fails again, STOP and report. Do not replace the harness with mocks.
- **A reference snippet fails to compile or a test fails** - Detect: `bun run typecheck` errors in files from this plan. Respond: fix minimally, record a `> Deviation:` line. If the same step fails 3 times, STOP and report what you tried.
- **`bun add zod` resolves a different major version** - Detect: Task 9 or Task 6 type errors on `z.` calls (for example `.issues`, `.default()` on coerce, `superRefine` issue shape). Respond: adjust to that version's API and record the version in a deviation.
- **Any `wrangler` command prints `remote`, asks to log in, or tries to create a resource** - Detect: output mentions `remote`, `login`, or `create`. Respond: STOP immediately and report.
- **A Phase gate or `test -f` check fails** - Detect: missing file or wrong test count. Respond: STOP and report that Phase 1 moved.

## End-to-end verification

These run on the integrated result through the real Worker runtime (`wrangler dev --local`, simulated bindings, no network to Cloudflare). They use fake values only.

- [ ] Run: `bun run test && bun run typecheck` - Expected: Vitest `Test Files  18 passed (18)` and `Tests  152 passed (152)`; typecheck prints nothing and exits 0
- [ ] Run: `printf 'ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\nACCESS_TEAM_DOMAIN=test.cloudflareaccess.com\nACCESS_AUD=test-aud\nDEV_BYPASS=true\n' > .dev.vars && rm -rf .wrangler && bun run db:migrate:local` - Expected: output contains `Executing on local database cellar` and `0000_init.sql | ✅`; no mention of `remote` beyond the standard hint line
- [ ] Manual: start `bunx wrangler dev --local --port 8799` in the background and wait for `Ready on http://localhost:8799`. Then create a target: `curl -s -w ' %{http_code}\n' -X POST localhost:8799/api/targets -H 'content-type: application/json' -d '{"name":"Shop DB","connectionUrl":"postgres://backup:s3cret-pw@db.example.com:5432/shop","tunnel":{"hostname":"db.example.com","tokenId":"token-id-123","tokenSecret":"token-secret-456"}}'` - Expected: HTTP `201`; body has `"dbName":"shop"`, `"connection":{"host":"db.example.com","port":5432,"user":"backup","dbName":"shop"}`, `"scheduleCron":"0 2 * * *"`, `"timezone":"Asia/Bangkok"`, `"hasTunnelToken":true`, `"alertFailureThreshold":3`, a `nextRunAt` ending in `T19:00:00.000Z` (02:00 in Bangkok; the date depends on today), and none of `s3cret-pw`, `token-id-123`, `token-secret-456`, `postgres://`, `_enc`
- [ ] Manual: `curl -s -w ' %{http_code}\n' -X POST localhost:8799/api/targets -H 'content-type: application/json' -d '{"name":"X","connectionUrl":"postgres://u:p@h/db","scheduleCron":"61 * * * *","tunnel":{"hostname":"db.example.com","tokenId":"a","tokenSecret":"b"}}'` - Expected: `400` with `"code":"validation_error"` and a detail whose `path` is `scheduleCron`
- [ ] Manual: `curl -s -w ' %{http_code}\n' "localhost:8799/api/targets?limit=5"` - Expected: `200`, `items` holds the one target, `"nextCursor":null`, and the body contains none of the secret strings above
- [ ] Manual: take the `id` from the create response as `<ID>` (or `curl -s localhost:8799/api/targets` and copy `items[0].id`). Then `curl -s -w ' %{http_code}\n' -X PATCH localhost:8799/api/targets/<ID> -H 'content-type: application/json' -d '{"enabled":false}'` - Expected: `200`, `"enabled":false`, `"nextRunAt":null`
- [ ] Manual: `curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:8799/api/targets/<ID>`, then `curl -s -w ' %{http_code}\n' localhost:8799/api/targets/<ID>` - Expected: `204`, then `{"error":{"code":"not_found","message":"Target not found"}} 404`
- [ ] Manual: `curl -s -w ' %{http_code}\n' "localhost:8799/api/audit-logs?entityType=target&limit=10"` - Expected: `200`; `items` has three rows in this order: `target.delete`, `target.update`, `target.create`, all with `"actor":"dev@localhost"` and the same `entityId`; the `target.create` details hold `connection` with host and user but no password
- [ ] Manual: `curl -s -w ' %{http_code}\n' localhost:8799/api/nope` - Expected: `{"error":{"code":"not_found","message":"Not found"}} 404`
- [ ] Manual: stop the dev server, remove `DEV_BYPASS=true` from `.dev.vars`, restart it, then `curl -s -w ' %{http_code}\n' localhost:8799/api/targets` - Expected: `{"error":{"code":"unauthorized","message":"Unauthorized"}} 401`
- [ ] Manual: stop the dev server, `rm .dev.vars`, then `lsof -i :8799` - Expected: no output; `git status --short` shows no `.dev.vars` and `git ls-files .wrangler | wc -l` prints `0`
- [ ] Run: `git status --short && git log --oneline | head -18` - Expected: clean tree; commits for Tasks 0 to 16 on branch `phase-2-targets-crud-audit-log`

When all boxes are ticked, end with the phase summary required by `AGENTS.md`:

- ✅ Completed: list the routes, the shared helpers (`uuidv7`, `tz`, `cron`, `pg-url`, `target-schema`, `validate`, `pagination`, `audit`, `error`, test harness), and the PLAN.md edits.
- Root edits (approved in owner round 2, answer 6): `package.json` and `bun.lock` (`zod`, Task 1), `vitest.config.ts` (`testTimeout` and `hookTimeout`, Task 4), `src/worker/app.ts` (error handlers and route mounts, Tasks 11 and 15), `docs/PLAN.md` (Task 16). Shared code: `src/shared/tz.ts` (Task 2) is shared with Phase 3.
- 🧪 Tests and results: `bun run test` (18 files, 152 tests) and `bun run typecheck` results, plus the end-to-end curl results.
- ⚠️ Open issues and decisions needed:
  - Assumed input bounds (decision 8), no minimum cron interval, and numeric-only cron grammar (decision 9).
  - Audit rows are written only for successful create, update, and delete.
  - The Worker runtime was exercised through `getPlatformProxy` and `wrangler dev --local` only; nothing was deployed.
