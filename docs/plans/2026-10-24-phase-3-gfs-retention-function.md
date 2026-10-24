# Phase 3: GFS Retention Function Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-3-gfs-retention-function.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Preflight` checks BEFORE task 1 and report anything down.
> The code in the steps is a reference implementation. It was type-checked and run in a scratch project (`/tmp/phase-3-scratch`) against a stand-in `src/shared/tz.ts`, not in this repo.
> When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Add the pure GFS retention decision function `selectBackupsToDelete(backups, policy, now, tz)` with full unit tests.
**Architecture:** One pure module, `src/worker/retention/gfs.ts`, plus a types file. It filters to `success` backups, sorts newest first, and applies four keep rules (`keep_last`, `daily`, `weekly`, `monthly`) and the `max_age_days` limit. Day, ISO week, and month buckets come from `getZonedParts` (Phase 2, `src/shared/tz.ts`). The latest success is always kept. No I/O, no `Date.now()`, no D1 or R2.
**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Vitest (Node), Bun.
**Spec:** `docs/plans/prds/phase-3.md`, resolved by `docs/plans/2026-10-24-phases-2-10-decisions.md` (section "Phase 3" and X9, X15, X18).
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`). Every anchor below describes a tree where Phases 1 and 2 are merged. Neither exists in the tree at planning time, so no file anchor could be checked (planned, not yet in tree). This phase only creates new files, so it has no line anchors.
**Confidence:** 6/10. Rubric: start 10, minus 2 for anchors in files that do not exist yet (X18, once), minus 2 for the Phase gate commands, which were written but could not be run because `src/shared/tz.ts` does not exist yet. The pure logic and all 35 tests were run in scratch (details in "How the code was validated"). Residual risk: the real `getZonedParts` from Phase 2 may differ from the stand-in (for example a 0-based month). Task 1 adds a contract test that fails fast if so.
**ASK:** none. Two small interpretation choices are listed under "Decisions that differ from the PRD / docs/PLAN.md" (items 4 and 5) so the owner can object when approving the plan.
**NOT building:**
- Anything that reads D1, deletes from R2, writes audit rows, or runs on a schedule (Phase 6).
- Mapping from DB columns to `RetentionBackup` / `RetentionPolicy` (Phase 6: `keep_daily` becomes `daily`, `created_at` is `backups.started_at`).
- Policy validation (Phase 2 validates request bodies with Zod). The function treats `null`, `undefined`, `0`, and negative numbers as "rule off" and floors fractions, and does nothing else about bad numbers.
- A barrel `src/worker/retention/index.ts`. Phase 6 imports `src/worker/retention/gfs.ts` directly.
- Dry-run, preview, or reporting code.
- New dependencies. None are needed.
- Any change to `src/shared/tz.ts` (Phase 2 owns it; this phase only imports `getZonedParts`).
- Any edit to `README.md` (Phase 10 owns it; see the note on its wording in Task 5).

## Decisions that differ from the PRD / docs/PLAN.md

1. **File names.** The PRD says only "src/worker/retention/". `docs/PLAN.md` section 2 lists `retention/ gfs.ts runner.ts`, so the function lives in `gfs.ts`. Types live in `types.ts` (decisions register, Phase 3). Task 5 adds `types.ts` to the PLAN.md layout line.
2. **Type names and keys.** The PRD uses `Backup` and snake_case policy keys. The register fixes `RetentionBackup = { id, status, created_at }` and `RetentionPolicy = { keep_last, daily, weekly, monthly, max_age_days? }`. This plan uses those. Return type is named `RetentionDecision`.
3. **Bucket rule.** "daily N" keeps the newest backup of each of the N most recent local days that HAVE a backup. Gaps do not count as days. The same applies to weeks and months. `keep_last N` keeps the N newest successes. All rules are evaluated on `success` backups only.
4. **`max_age_days` scope** (register: "removes the age-based keeps only"). Backups older than `max_age_days` are removed from consideration for all four rules, so they cannot be kept by `keep_last`, `daily`, `weekly`, or `monthly`. Only `latest_success` can keep them. Rules do not "backfill": if only one backup is young enough, `keep_last: 3` keeps only that one. Choice: a backup that is exactly `max_age_days * 86 400 000` ms old is kept (`>=`); one millisecond older is deleted. The PRD does not say; this is the least surprising reading of "older than".
5. **Ordering.** `keep` and `delete` are sorted newest first, ties broken by id descending, so output does not depend on input order. `reasons` has one key per kept backup, with reasons in the fixed order `keep_last`, `daily`, `weekly`, `monthly`, `latest_success`.
6. **Invalid `created_at`** throws `RangeError` (message contains the backup id only). The PRD is silent. A silent skip would let a corrupt row escape deletion decisions unnoticed, and Phase 6 can catch the error and report it.
7. **Root wiring (X15).** None is needed. Phase 1 `vitest.config.ts` already includes `test/**/*.test.ts` and `tsconfig.json` already includes `src` and `test`, so the new folders run in `bun run test` and `bun run typecheck` with no edits. The PRD says this phase touches ONLY `src/worker/retention/` and its tests; the register additionally requires a `docs/PLAN.md` update, done in Task 5 (one line).

## Global Constraints

- TypeScript everywhere; Bun is the package manager; `bun run test` runs Vitest.
- Pure and deterministic: no `Date.now()`, no `new Date()` without an argument, no randomness, no I/O inside `src/worker/retention/`.
- Only `success` backups are candidates. Non-success backups appear in neither `keep` nor `delete` (AGENTS.md: the most recent successful backup is never deleted; PRD: never delete failed or running ones here).
- A backup is kept if ANY rule keeps it. `max_age_days` never removes the latest success. The latest success is kept even if every rule is 0.
- Day, week, and month buckets use the target time zone. Weeks start Monday (ISO week, ISO week-year).
- Default timezone `Asia/Bangkok` is configurable per target; the function takes `tz` as an argument and never assumes one.
- Source in `src/worker/`, tests in `test/worker/` mirroring the src path (X1).
- Import time-zone parts only through `getZonedParts` from `src/shared/tz.ts` (X9). Do not modify that file.
- Phase 1 tsconfig is strict with `noUncheckedIndexedAccess`; guard every indexed access.
- No new dependency (AGENTS.md "Stack (locked)").
- No remote command, no `wrangler` command in this phase.
- If the same step fails 3 times, stop and report what you tried.
- No em dash in any file you write. Use a plain dash.
- Do not add the agent as co-author in commit messages.

## Patterns to Mirror

No Phase 1 or Phase 2 code is in the tree yet. These conventions come from the Phase 1 plan, section "Patterns to Mirror" (`docs/plans/2026-10-24-phase-1-foundation.md`, planned, not yet in tree):

- **Naming:** files are `kebab-case.ts`; test files are `test/worker/<mirrors src/worker path>.test.ts`. Here: `src/worker/retention/gfs.ts` is tested by `test/worker/retention/gfs.test.ts`. Policy keys are snake_case because they mirror the PRD and DB columns; everything else is camelCase.
- **Error handling:** errors never include secrets. The only error here is `RangeError` carrying a backup id.
- **Tests:** Vitest, Node environment, `import { describe, expect, it } from "vitest"`. Files that are not `*.test.ts` (`helpers.ts`) are not collected as tests.

## Preflight

### DURABLE - true until the repo itself changes

- **Test collection already covers the new folder.** Evidence: Phase 1 plan, Task 1, Step 4 sets `include: ["test/**/*.test.ts"]`, and Step 3 sets tsconfig `include: ["src", "test", ...]`. Consequence: no root config edit (see Decision 7).
- **The scratch run used Bun's test runner and the real Vitest 5.0.5.** Evidence: scratch ran `bunx vitest run` with 35 passing tests and `bunx tsc --noEmit` with 0 errors. Consequence: the test code is trusted for syntax and logic, not for the repo's real `tz.ts`.

### PERISHABLE - recapture before task 1

- **Phase gate: Phases 1 and 2 are merged into the branch this plan runs on.** Check: `test -f src/shared/tz.ts && test -f src/worker/env.ts && test -f vitest.config.ts && grep -n "export function getZonedParts" src/shared/tz.ts` - Expected: all `test -f` succeed and grep prints one line. If any file or the export is missing or has a different name or signature: STOP and report, the earlier phase moved (register, rule 3).
- **Baseline is green.** Check: `bun run test && bun run typecheck` - Expected: both exit 0. Record the pass count printed by Vitest as the baseline; every later "full suite" Verify says "baseline + N". If it is red, STOP: this phase must not hide earlier red.
- **Bun and Node.** Check: `bun --version && node --version` - Expected: Bun 1.3.x (planning run: 1.3.5) and Node 20 or newer (planning run: v22.19.0).
- **Dependencies installed in this checkout.** Check: `test -d node_modules && bun run typecheck` exits 0.
- **Git state.** Check: `git status --short` - Expected: no output (clean tree). Then `git switch -c phase-3-retention-function`.
- **Secrets.** None needed. No network, no Docker, no Cloudflare resource.

## Execution

**Tracks:** one track, sequential. Five small tasks, all in `src/worker/retention/` and `test/worker/retention/`, far below the parallel cost floor (a track needs at least 3 tasks and 5 files to repay a worktree, and these files depend on each other in order).
**Merge order:** not applicable (single track).
**Shared files:** none. `package.json`, `bun.lock`, `vitest.config.ts`, `tsconfig.json`, and migrations are not touched. `docs/PLAN.md` is owned by Task 5 only.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on branch `phase-3-retention-function`.
**treehouse:** not needed for a single track.

---

### Task 1: Types, test helpers, and the `getZonedParts` contract test

**Files:**
- Create: `src/worker/retention/types.ts`
- Create: `test/worker/retention/helpers.ts`
- Create: `test/worker/retention/tz-contract.test.ts`

**Interfaces:**
- Consumes: `getZonedParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }` from `src/shared/tz.ts` (Phase 2, X9; month and day are 1-based, weekday 1=Mon..7=Sun).
- Produces:
  - `RetentionBackup`, `RetentionPolicy`, `RetentionDecision` in `src/worker/retention/types.ts` (below).
  - Test helpers `OFF: RetentionPolicy`, `mk(id: string, createdAt: string, status?: string): RetentionBackup`, `ids(list: RetentionBackup[]): string[]` in `test/worker/retention/helpers.ts`.

**Gotcha:** The contract test exists because this plan assumes `getZonedParts` returns a 1-based month. The register (X9) does not state the base. If the test fails, STOP and report: do not adapt `gfs.ts` to a different base without the owner knowing, because Phase 2 owns `tz.ts`.

**Steps:**
- [ ] Step 1: Create `src/worker/retention/types.ts`:
      ```ts
      export interface RetentionBackup {
        id: string;
        status: string;
        /** ISO-8601 UTC instant, for example "2026-10-24T19:00:00.000Z". */
        created_at: string;
      }

      /** A rule set to null, undefined, or 0 is off. */
      export interface RetentionPolicy {
        keep_last: number | null;
        daily: number | null;
        weekly: number | null;
        monthly: number | null;
        max_age_days?: number | null;
      }

      export interface RetentionDecision {
        keep: RetentionBackup[];
        delete: RetentionBackup[];
        /** One entry per kept backup, never for deleted or non-success backups. */
        reasons: Record<string, string[]>;
      }
      ```
- [ ] Step 2: Create `test/worker/retention/helpers.ts`:
      ```ts
      import type { RetentionBackup, RetentionPolicy } from "../../../src/worker/retention/types";

      export const OFF: RetentionPolicy = { keep_last: 0, daily: 0, weekly: 0, monthly: 0 };

      export function mk(id: string, createdAt: string, status = "success"): RetentionBackup {
        return { id, status, created_at: createdAt };
      }

      export function ids(list: RetentionBackup[]): string[] {
        return list.map((b) => b.id);
      }
      ```
- [ ] Step 3: Create `test/worker/retention/tz-contract.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { getZonedParts } from "../../../src/shared/tz";

      describe("Phase 2 contract: getZonedParts", () => {
        it("returns 1-based month and day in the requested zone", () => {
          const p = getZonedParts(new Date("2026-03-05T18:30:00Z"), "Asia/Bangkok");
          expect(p).toMatchObject({ year: 2026, month: 3, day: 6, hour: 1, minute: 30 });
        });
      });
      ```
- [ ] Step 4: Verify - Run: `bunx vitest run test/worker/retention/tz-contract.test.ts && bun run typecheck` - Expected: 1 test passes, 0 fail; `tsc` prints nothing and exits 0
- [ ] Step 5: Commit - `git add src/worker/retention/types.ts test/worker/retention/helpers.ts test/worker/retention/tz-contract.test.ts && git commit -m "feat(retention): add retention types and getZonedParts contract test"`

---

### Task 2: `selectBackupsToDelete` and core tests

**Files:**
- Create: `src/worker/retention/gfs.ts`
- Test: `test/worker/retention/gfs.test.ts`

**Interfaces:**
- Consumes: `getZonedParts` (see Task 1); `RetentionBackup`, `RetentionPolicy`, `RetentionDecision` from Task 1; `ids`, `mk`, `OFF` from `test/worker/retention/helpers.ts`.
- Produces, all in `src/worker/retention/gfs.ts`:
  - `selectBackupsToDelete(backups: RetentionBackup[], policy: RetentionPolicy, now: Date, tz: string): RetentionDecision` (Phase 6 consumes this unchanged).
  - `dayKey(at: Date, tz: string): string` (`"2026-03-05"`), `isoWeekKey(at: Date, tz: string): string` (`"2026-W10"`), `monthKey(at: Date, tz: string): string` (`"2026-03"`). Exported for Task 3 tests only.

**Semantics (write these in the commit body if asked):**
- `keep_last N`: the N newest success backups.
- `daily N` / `weekly N` / `monthly N`: take the N most recent distinct local days / ISO weeks / months that contain at least one success backup, and keep the newest backup of each.
- `max_age_days M` (M > 0): first drop every success backup with `created_at < now - M days` from the four rules above.
- `latest_success`: the single newest success backup, always.
- Delete = success backups with no reason. Non-success backups are returned nowhere.

**Steps:**
- [ ] Step 1: Create `src/worker/retention/gfs.ts`:
      ```ts
      import { getZonedParts } from "../../shared/tz";
      import type { RetentionBackup, RetentionDecision, RetentionPolicy } from "./types";

      const DAY_MS = 86_400_000;

      const pad = (n: number, width: number): string => String(n).padStart(width, "0");

      function limit(n: number | null | undefined): number {
        return n != null && n > 0 ? Math.floor(n) : 0;
      }

      /** Local calendar day, for example "2026-03-05". */
      export function dayKey(at: Date, tz: string): string {
        const p = getZonedParts(at, tz);
        return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
      }

      /** Local calendar month, for example "2026-03". */
      export function monthKey(at: Date, tz: string): string {
        const p = getZonedParts(at, tz);
        return `${pad(p.year, 4)}-${pad(p.month, 2)}`;
      }

      /** Local ISO week (Monday start, ISO week-year), for example "2026-W10". */
      export function isoWeekKey(at: Date, tz: string): string {
        const p = getZonedParts(at, tz);
        const day = Date.UTC(p.year, p.month - 1, p.day);
        const mondayIndex = (new Date(day).getUTCDay() + 6) % 7;
        const thursday = day + (3 - mondayIndex) * DAY_MS;
        const isoYear = new Date(thursday).getUTCFullYear();
        const week = Math.floor((thursday - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
        return `${pad(isoYear, 4)}-W${pad(week, 2)}`;
      }

      interface Candidate {
        backup: RetentionBackup;
        at: Date;
      }

      /** Newest backup of each of the `count` most recent distinct keys. */
      function newestPerBucket(newestFirst: Candidate[], count: number, keyOf: (at: Date) => string): RetentionBackup[] {
        if (count === 0) return [];
        const winners = new Map<string, RetentionBackup>();
        for (const c of newestFirst) {
          const key = keyOf(c.at);
          if (winners.has(key)) continue;
          if (winners.size === count) break;
          winners.set(key, c.backup);
        }
        return [...winners.values()];
      }

      export function selectBackupsToDelete(
        backups: RetentionBackup[],
        policy: RetentionPolicy,
        now: Date,
        tz: string,
      ): RetentionDecision {
        const newestFirst: Candidate[] = backups
          .filter((b) => b.status === "success")
          .map((backup) => {
            const at = new Date(backup.created_at);
            if (Number.isNaN(at.getTime())) throw new RangeError(`Invalid created_at for backup ${backup.id}`);
            return { backup, at };
          })
          .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.backup.id < b.backup.id ? 1 : -1));

        const maxAgeDays = limit(policy.max_age_days);
        const oldestAllowed = maxAgeDays > 0 ? now.getTime() - maxAgeDays * DAY_MS : -Infinity;
        const ageEligible = newestFirst.filter((c) => c.at.getTime() >= oldestAllowed);

        const reasons: Record<string, string[]> = {};
        const addReason = (id: string, reason: string): void => {
          (reasons[id] ??= []).push(reason);
        };

        for (const b of ageEligible.slice(0, limit(policy.keep_last))) addReason(b.backup.id, "keep_last");
        for (const b of newestPerBucket(ageEligible, limit(policy.daily), (d) => dayKey(d, tz))) addReason(b.id, "daily");
        for (const b of newestPerBucket(ageEligible, limit(policy.weekly), (d) => isoWeekKey(d, tz))) addReason(b.id, "weekly");
        for (const b of newestPerBucket(ageEligible, limit(policy.monthly), (d) => monthKey(d, tz))) addReason(b.id, "monthly");

        const latest = newestFirst[0];
        if (latest) addReason(latest.backup.id, "latest_success");

        const keep: RetentionBackup[] = [];
        const del: RetentionBackup[] = [];
        for (const c of newestFirst) (reasons[c.backup.id] ? keep : del).push(c.backup);
        return { keep, delete: del, reasons };
      }
      ```
- [ ] Step 2: Create `test/worker/retention/gfs.test.ts` (15 tests: empty, all-zero policy, null rules, keep_last, same-day newest, gaps for day, week, month, reason order, failed or running never listed, failed not counted as latest success, no success at all, input order independence, no input mutation, invalid date):
      ```ts
      import { describe, expect, it } from "vitest";
      import { selectBackupsToDelete } from "../../../src/worker/retention/gfs";
      import { OFF, ids, mk } from "./helpers";

      const TZ = "Asia/Bangkok";
      const NOW = new Date("2026-10-24T03:00:00+07:00");

      describe("selectBackupsToDelete: basics", () => {
        it("returns empty results for an empty list", () => {
          const r = selectBackupsToDelete([], { keep_last: 3, daily: 7, weekly: 4, monthly: 6 }, NOW, TZ);
          expect(r).toEqual({ keep: [], delete: [], reasons: {} });
        });

        it("keeps a single backup when every rule is 0", () => {
          const r = selectBackupsToDelete([mk("a", "2026-10-20T00:00:00Z")], OFF, NOW, TZ);
          expect(ids(r.keep)).toEqual(["a"]);
          expect(r.delete).toEqual([]);
          expect(r.reasons).toEqual({ a: ["latest_success"] });
        });

        it("treats null and omitted rules as off", () => {
          const policy = { keep_last: null, daily: null, weekly: null, monthly: null };
          const r = selectBackupsToDelete(
            [mk("new", "2026-10-20T00:00:00Z"), mk("old", "2026-10-19T00:00:00Z")],
            policy,
            NOW,
            TZ,
          );
          expect(ids(r.keep)).toEqual(["new"]);
          expect(ids(r.delete)).toEqual(["old"]);
        });

        it("keep_last keeps the N newest successes", () => {
          const list = ["01", "02", "03", "04", "05"].map((d) => mk(`b${d}`, `2026-10-${d}T00:00:00Z`));
          const r = selectBackupsToDelete(list, { ...OFF, keep_last: 2 }, NOW, TZ);
          expect(ids(r.keep)).toEqual(["b05", "b04"]);
          expect(ids(r.delete)).toEqual(["b03", "b02", "b01"]);
          expect(r.reasons).toEqual({ b05: ["keep_last", "latest_success"], b04: ["keep_last"] });
        });

        it("keeps only the newest backup of a day for the daily rule", () => {
          const list = [
            mk("d1-early", "2026-10-10T01:00:00Z"),
            mk("d1-mid", "2026-10-10T05:00:00Z"),
            mk("d1-late", "2026-10-10T09:00:00Z"),
            mk("d2", "2026-10-11T02:00:00Z"),
          ];
          const r = selectBackupsToDelete(list, { ...OFF, daily: 2 }, NOW, TZ);
          expect(ids(r.keep)).toEqual(["d2", "d1-late"]);
          expect(ids(r.delete)).toEqual(["d1-mid", "d1-early"]);
          expect(r.reasons).toEqual({ d2: ["daily", "latest_success"], "d1-late": ["daily"] });
        });

        it("counts days that have a backup, so gaps do not use up the daily quota", () => {
          const list = ["2026-10-01", "2026-10-02", "2026-10-10", "2026-10-11", "2026-10-20"].map((d) =>
            mk(d, `${d}T05:00:00Z`),
          );
          const r = selectBackupsToDelete(list, { ...OFF, daily: 3 }, NOW, TZ);
          expect(ids(r.keep)).toEqual(["2026-10-20", "2026-10-11", "2026-10-10"]);
        });

        it("counts weeks that have a backup, so gaps do not use up the weekly quota", () => {
          // ISO weeks 2026-W36 (Sep 1), W38 (Sep 16), W42 (Oct 14), W43 (Oct 21)
          const list = ["2026-09-01", "2026-09-16", "2026-10-14", "2026-10-21"].map((d) => mk(d, `${d}T05:00:00Z`));
          const r = selectBackupsToDelete(list, { ...OFF, weekly: 3 }, NOW, TZ);
          expect(ids(r.keep)).toEqual(["2026-10-21", "2026-10-14", "2026-09-16"]);
          expect(ids(r.delete)).toEqual(["2026-09-01"]);
        });

        it("counts months that have a backup, so gaps do not use up the monthly quota", () => {
          const list = ["2026-01-15", "2026-02-15", "2026-06-15", "2026-10-15"].map((d) => mk(d, `${d}T05:00:00Z`));
          const r = selectBackupsToDelete(list, { ...OFF, monthly: 3 }, NOW, TZ);
          expect(ids(r.keep)).toEqual(["2026-10-15", "2026-06-15", "2026-02-15"]);
        });

        it("lists every rule that keeps a backup, in a fixed order", () => {
          const r = selectBackupsToDelete([mk("a", "2026-10-20T00:00:00Z")], { keep_last: 1, daily: 1, weekly: 1, monthly: 1 }, NOW, TZ);
          expect(r.reasons).toEqual({ a: ["keep_last", "daily", "weekly", "monthly", "latest_success"] });
        });
      });

      describe("selectBackupsToDelete: non-success backups", () => {
        it("never puts failed, running, or timed_out backups in keep or delete", () => {
          const list = [
            mk("ok-new", "2026-10-20T00:00:00Z"),
            mk("failed", "2026-10-22T00:00:00Z", "failed"),
            mk("running", "2026-10-23T00:00:00Z", "running"),
            mk("timed", "2026-10-21T00:00:00Z", "timed_out"),
            mk("ok-old", "2026-10-01T00:00:00Z"),
          ];
          const r = selectBackupsToDelete(list, { ...OFF, keep_last: 1 }, NOW, TZ);
          const seen = [...ids(r.keep), ...ids(r.delete)].sort();
          expect(seen).toEqual(["ok-new", "ok-old"]);
          expect(ids(r.keep)).toEqual(["ok-new"]);
        });

        it("does not count failed backups toward keep_last or as the latest success", () => {
          const list = [mk("failed-new", "2026-10-23T00:00:00Z", "failed"), mk("ok", "2026-10-01T00:00:00Z")];
          const r = selectBackupsToDelete(list, OFF, NOW, TZ);
          expect(r.reasons).toEqual({ ok: ["latest_success"] });
          expect(r.delete).toEqual([]);
        });

        it("returns empty results when no backup succeeded", () => {
          const r = selectBackupsToDelete([mk("f", "2026-10-23T00:00:00Z", "failed")], OFF, NOW, TZ);
          expect(r).toEqual({ keep: [], delete: [], reasons: {} });
        });
      });

      describe("selectBackupsToDelete: determinism", () => {
        it("does not depend on input order and breaks identical timestamps by id", () => {
          const a = mk("a", "2026-10-20T00:00:00Z");
          const b = mk("b", "2026-10-20T00:00:00Z");
          const c = mk("c", "2026-10-19T00:00:00Z");
          const p = { ...OFF, keep_last: 1 };
          const r1 = selectBackupsToDelete([a, b, c], p, NOW, TZ);
          const r2 = selectBackupsToDelete([c, b, a], p, NOW, TZ);
          expect(r1).toEqual(r2);
          expect(ids(r1.keep)).toEqual(["b"]);
        });

        it("does not mutate its input", () => {
          const list = [mk("a", "2026-10-20T00:00:00Z"), mk("b", "2026-10-21T00:00:00Z")];
          const copy = JSON.parse(JSON.stringify(list)) as typeof list;
          selectBackupsToDelete(list, OFF, NOW, TZ);
          expect(list).toEqual(copy);
        });

        it("throws RangeError for an unparseable created_at", () => {
          expect(() => selectBackupsToDelete([mk("x", "not a date")], OFF, NOW, TZ)).toThrow(RangeError);
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/retention/gfs.test.ts && bun run typecheck` - Expected: 15 pass, 0 fail; `tsc` prints nothing and exits 0
- [ ] Step 4: Commit - `git add src/worker/retention/gfs.ts test/worker/retention/gfs.test.ts && git commit -m "feat(retention): add GFS selectBackupsToDelete"`

---

### Task 3: Boundary tests (time zone, week, month, year, max age)

**Files:**
- Test: `test/worker/retention/boundaries.test.ts`

**Interfaces:**
- Consumes: `selectBackupsToDelete`, `dayKey`, `isoWeekKey`, `monthKey` from `src/worker/retention/gfs.ts` (Task 2); helpers from Task 1.
- Produces: nothing for later tasks.

**Gotcha:** The 16 tests cover the PRD list items "day boundary differs between UTC and Asia/Bangkok", "week and month boundaries, year rollover", and "max_age_days older than everything". Expected values come from calendar facts, not from the code: 2026-12-28 to 2027-01-03 are all ISO week 2026-W53 (2026 starts on a Thursday); 2024-12-30 is 2025-W01; 2021-01-03 is 2020-W53. If a test fails, check the calendar fact before touching `gfs.ts`.

**Steps:**
- [ ] Step 1: Create `test/worker/retention/boundaries.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { dayKey, isoWeekKey, monthKey, selectBackupsToDelete } from "../../../src/worker/retention/gfs";
      import { OFF, ids, mk } from "./helpers";

      const NOW = new Date("2026-10-24T03:00:00+07:00");
      const DAY_MS = 86_400_000;

      describe("bucket keys", () => {
        it("uses the local calendar in the given zone", () => {
          const at = new Date("2026-03-05T18:30:00Z");
          expect(dayKey(at, "UTC")).toBe("2026-03-05");
          expect(dayKey(at, "Asia/Bangkok")).toBe("2026-03-06");
        });

        it("handles a daylight saving change day", () => {
          // New York clocks moved forward on 2026-03-08. 04:30Z is Mar 7 23:30 EST, 06:30Z is Mar 8 01:30 EST.
          expect(dayKey(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
          expect(dayKey(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe("2026-03-08");
        });

        it("starts ISO weeks on Monday", () => {
          expect(isoWeekKey(new Date("2026-03-01T12:00:00Z"), "UTC")).toBe("2026-W09"); // Sunday
          expect(isoWeekKey(new Date("2026-03-02T12:00:00Z"), "UTC")).toBe("2026-W10"); // Monday
        });

        it("uses the ISO week-year across the new year", () => {
          expect(isoWeekKey(new Date("2026-12-28T12:00:00Z"), "UTC")).toBe("2026-W53");
          expect(isoWeekKey(new Date("2027-01-03T12:00:00Z"), "UTC")).toBe("2026-W53");
          expect(isoWeekKey(new Date("2027-01-04T12:00:00Z"), "UTC")).toBe("2027-W01");
          expect(isoWeekKey(new Date("2024-12-30T12:00:00Z"), "UTC")).toBe("2025-W01");
          expect(isoWeekKey(new Date("2021-01-03T12:00:00Z"), "UTC")).toBe("2020-W53");
          expect(isoWeekKey(new Date("2026-01-01T12:00:00Z"), "UTC")).toBe("2026-W01");
        });

        it("rolls the month at local midnight", () => {
          const at = new Date("2026-12-31T17:30:00Z");
          expect(monthKey(at, "UTC")).toBe("2026-12");
          expect(monthKey(at, "Asia/Bangkok")).toBe("2027-01");
        });
      });

      describe("day boundary differs between UTC and Asia/Bangkok", () => {
        // 10:00Z is 17:00 in Bangkok on Mar 5. 18:00Z is 01:00 in Bangkok on Mar 6.
        const list = [mk("early", "2026-03-05T10:00:00Z"), mk("late", "2026-03-05T18:00:00Z")];
        const policy = { ...OFF, daily: 2 };

        it("keeps both in Asia/Bangkok because they are on different local days", () => {
          const r = selectBackupsToDelete(list, policy, NOW, "Asia/Bangkok");
          expect(ids(r.keep)).toEqual(["late", "early"]);
        });

        it("keeps only the newest in UTC because they are on the same day", () => {
          const r = selectBackupsToDelete(list, policy, NOW, "UTC");
          expect(ids(r.keep)).toEqual(["late"]);
          expect(ids(r.delete)).toEqual(["early"]);
        });
      });

      describe("week boundaries", () => {
        it("keeps one backup per ISO week, the newest", () => {
          const list = [
            mk("mon", "2026-03-02T05:00:00Z"),
            mk("wed", "2026-03-04T05:00:00Z"),
            mk("sun-prev", "2026-03-01T05:00:00Z"),
          ];
          const r = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, NOW, "UTC");
          expect(ids(r.keep)).toEqual(["wed", "sun-prev"]);
          expect(ids(r.delete)).toEqual(["mon"]);
        });

        it("moves a Sunday-night UTC backup into Monday's week in Asia/Bangkok", () => {
          // 2026-03-01T17:30Z is Monday 00:30 in Bangkok, so it shares W10 with Wednesday.
          const list = [mk("wed", "2026-03-04T05:00:00Z"), mk("sun-night-utc", "2026-03-01T17:30:00Z")];
          const bkk = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, NOW, "Asia/Bangkok");
          expect(ids(bkk.keep)).toEqual(["wed"]);
          const utc = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, NOW, "UTC");
          expect(ids(utc.keep)).toEqual(["wed", "sun-night-utc"]);
        });

        it("puts late December and early January in one ISO week when they share it", () => {
          const list = [mk("jan", "2027-01-02T05:00:00Z"), mk("dec", "2026-12-29T05:00:00Z")];
          const r = selectBackupsToDelete(list, { ...OFF, weekly: 2 }, new Date("2027-01-05T00:00:00Z"), "UTC");
          expect(ids(r.keep)).toEqual(["jan"]);
          expect(ids(r.delete)).toEqual(["dec"]);
        });
      });

      describe("month boundaries and year rollover", () => {
        it("keeps the newest backup of each month across a year change", () => {
          const list = [
            mk("dec-early", "2026-12-02T05:00:00Z"),
            mk("dec-late", "2026-12-30T05:00:00Z"),
            mk("jan", "2027-01-10T05:00:00Z"),
          ];
          const r = selectBackupsToDelete(list, { ...OFF, monthly: 2 }, new Date("2027-01-15T00:00:00Z"), "UTC");
          expect(ids(r.keep)).toEqual(["jan", "dec-late"]);
          expect(ids(r.delete)).toEqual(["dec-early"]);
        });

        it("uses the local month: Dec 31 17:30Z is already January in Asia/Bangkok", () => {
          const list = [mk("dec31", "2026-12-31T17:30:00Z"), mk("dec15", "2026-12-15T05:00:00Z")];
          const now = new Date("2027-01-15T00:00:00Z");
          const bkk = selectBackupsToDelete(list, { ...OFF, monthly: 2 }, now, "Asia/Bangkok");
          expect(ids(bkk.keep)).toEqual(["dec31", "dec15"]);
          const utc = selectBackupsToDelete(list, { ...OFF, monthly: 2 }, now, "UTC");
          expect(ids(utc.keep)).toEqual(["dec31"]);
        });
      });

      describe("max_age_days", () => {
        const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString();
        const wide = { keep_last: 10, daily: 10, weekly: 10, monthly: 10 };

        it("keeps only the latest success when max_age_days is shorter than every backup's age", () => {
          const list = [mk("a", daysAgo(5)), mk("b", daysAgo(6)), mk("c", daysAgo(40))];
          const r = selectBackupsToDelete(list, { ...wide, max_age_days: 1 }, NOW, "UTC");
          expect(ids(r.keep)).toEqual(["a"]);
          expect(r.reasons).toEqual({ a: ["latest_success"] });
          expect(ids(r.delete)).toEqual(["b", "c"]);
        });

        it("deletes age-eligible rule keeps that are too old", () => {
          const list = [mk("new", daysAgo(1)), mk("mid", daysAgo(10)), mk("old", daysAgo(40)), mk("older", daysAgo(100))];
          const r = selectBackupsToDelete(list, { ...wide, max_age_days: 30 }, NOW, "UTC");
          expect(ids(r.keep)).toEqual(["new", "mid"]);
          expect(ids(r.delete)).toEqual(["old", "older"]);
        });

        it("keeps a backup that is exactly max_age_days old and deletes one a millisecond older", () => {
          const edge = new Date(NOW.getTime() - 30 * DAY_MS);
          const list = [
            mk("fresh", daysAgo(1)),
            mk("edge", edge.toISOString()),
            mk("just-over", new Date(edge.getTime() - 1).toISOString()),
          ];
          const r = selectBackupsToDelete(list, { ...wide, max_age_days: 30 }, NOW, "UTC");
          expect(ids(r.keep)).toEqual(["fresh", "edge"]);
          expect(ids(r.delete)).toEqual(["just-over"]);
        });

        it("treats null, 0, and omitted max_age_days as no age limit", () => {
          const list = [mk("new", daysAgo(1)), mk("ancient", daysAgo(900))];
          for (const max_age_days of [null, 0, undefined]) {
            const r = selectBackupsToDelete(list, { ...wide, max_age_days }, NOW, "UTC");
            expect(ids(r.keep)).toEqual(["new", "ancient"]);
          }
        });
      });
      ```
- [ ] Step 2: Verify - Run: `bunx vitest run test/worker/retention/boundaries.test.ts && bun run typecheck` - Expected: 16 pass, 0 fail; `tsc` prints nothing and exits 0
- [ ] Step 3: Commit - `git add test/worker/retention/boundaries.test.ts && git commit -m "test(retention): cover time zone, week, month, year, and max age boundaries"`

---

### Task 4: README example test (exact kept count)

**Files:**
- Test: `test/worker/retention/readme-example.test.ts`

**Interfaces:**
- Consumes: `selectBackupsToDelete` (Task 2); `mk` (Task 1).
- Produces: nothing for later tasks.

**The number and how it was computed.** `README.md` section "Retention (GFS)" gives the example `keep_last=3, daily=7, weekly=4, monthly=6` ("keeps roughly 7 to 20 backups covering six months"). The PRD asks for the exact count over 200 days of daily backups. The count depends on where `now` falls in the calendar, so the test pins the dates: one backup per day at 02:00 `Asia/Bangkok`, 200 of them, newest on Saturday 2026-10-24, `now` = 2026-10-24 03:00 `Asia/Bangkok`.

Result: **14 kept, 186 deleted.** Breakdown:
- 7 daily: the 7 newest days (b0 to b6). b0, b1, b2 are also `keep_last`.
- Weekly 4: ISO weeks W43 (b0), W42 (b6), W41 (b13), W40 (b20). Only b13 and b20 are new keeps.
- Monthly 6: October (b0), then the last backup of September (b24), August (b54), July (b85), June (b116), May (b146). Five new keeps.
- 7 + 2 + 5 = 14.

Method: (a) the TypeScript implementation run in scratch with the README policy; (b) an independent brute-force script in Python (`zoneinfo`, `date.isocalendar()`, one set of kept indexes per rule) that computed 14 for both `Asia/Bangkok` and `UTC`. A second pinned date (newest on Monday 2026-10-26) also gave 14 in both implementations. The count depends on the pinned dates, so the test pins them. 14 sits inside the README's "roughly 7 to 20".

**Steps:**
- [ ] Step 1: Create `test/worker/retention/readme-example.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { selectBackupsToDelete } from "../../../src/worker/retention/gfs";
      import { mk } from "./helpers";

      const DAY_MS = 86_400_000;
      const POLICY = { keep_last: 3, daily: 7, weekly: 4, monthly: 6 };

      describe("README example: keep_last=3, daily=7, weekly=4, monthly=6 over 200 days", () => {
        // One backup per day at 02:00 Asia/Bangkok for 200 days. b0 is the newest, on Sat 2026-10-24.
        // now is 03:00 the same morning.
        const newest = Date.parse("2026-10-24T02:00:00+07:00");
        const now = new Date("2026-10-24T03:00:00+07:00");
        const backups = Array.from({ length: 200 }, (_, i) => mk(`b${i}`, new Date(newest - i * DAY_MS).toISOString()));

        it("keeps exactly 14 and deletes 186", () => {
          const r = selectBackupsToDelete(backups, POLICY, now, "Asia/Bangkok");
          expect(r.keep).toHaveLength(14);
          expect(r.delete).toHaveLength(186);
        });

        it("keeps these backups: 7 newest days, 2 older weeks, 5 older months", () => {
          const r = selectBackupsToDelete(backups, POLICY, now, "Asia/Bangkok");
          // b0..b6 = daily (b0..b2 also keep_last). b13, b20 = weeks W41 and W40 (b0 and b6 cover W43 and W42).
          // b24, b54, b85, b116, b146 = last day of Sep, Aug, Jul, Jun, May (b0 covers Oct).
          expect(r.keep.map((b) => b.id)).toEqual([
            "b0", "b1", "b2", "b3", "b4", "b5", "b6", "b13", "b20", "b24", "b54", "b85", "b116", "b146",
          ]);
          expect(r.reasons["b0"]).toEqual(["keep_last", "daily", "weekly", "monthly", "latest_success"]);
          expect(r.reasons["b6"]).toEqual(["daily", "weekly"]);
          expect(r.reasons["b13"]).toEqual(["weekly"]);
          expect(r.reasons["b146"]).toEqual(["monthly"]);
        });

        it("is stable when the clock moves to the next day with no new backup", () => {
          const r = selectBackupsToDelete(backups, POLICY, new Date(now.getTime() + DAY_MS), "Asia/Bangkok");
          expect(r.keep).toHaveLength(14);
        });
      });
      ```
- [ ] Step 2: Verify - Run: `bunx vitest run test/worker/retention/readme-example.test.ts && bun run typecheck` - Expected: 3 pass, 0 fail; `tsc` prints nothing and exits 0
- [ ] Step 3: Commit - `git add test/worker/retention/readme-example.test.ts && git commit -m "test(retention): assert README example keeps exactly 14 of 200"`

---

### Task 5: Update docs/PLAN.md, full suite, phase summary

**Files:**
- Modify: `docs/PLAN.md` (anchor: `retention/  gfs.ts  runner.ts`, in the section 2 file layout, ~L63)

**Interfaces:**
- Consumes: everything above.
- Produces: `docs/PLAN.md` that lists `types.ts` in the retention folder.

**Steps:**
- [ ] Step 1: In `docs/PLAN.md`, replace the exact text `retention/  gfs.ts  runner.ts` with `retention/  types.ts  gfs.ts  runner.ts`. (The line number is a hint only; grep the anchor.)
- [ ] Step 2: Verify - Run: `grep -c "retention/  types.ts  gfs.ts  runner.ts" docs/PLAN.md` - Expected: `1`
- [ ] Step 3: Verify - Run: `bun run test && bun run typecheck` - Expected: both exit 0; the Vitest total equals the baseline recorded in Preflight plus 35 (1 contract + 15 core + 16 boundary + 3 README); `tsc` prints nothing
- [ ] Step 4: Verify - Run: `grep -rnE "Date\.now|new Date\(\)|Math\.random" src/worker/retention/ ; echo "exit=$?"` - Expected: no matches printed and `exit=1` (the function is pure)
- [ ] Step 5: Verify - Run: `git status --short` - Expected: only `docs/PLAN.md` modified; no other uncommitted file
- [ ] Step 6: Commit - `git add docs/PLAN.md && git commit -m "docs: list retention types file in PLAN layout"`
- [ ] Step 7: Output the phase summary below (fill in the real numbers) and stop:
      - ✅ Completed: `selectBackupsToDelete` with `RetentionBackup` / `RetentionPolicy` / `RetentionDecision` types; 5 commits on `phase-3-retention-function`.
      - 🧪 Tests and results: 35 retention tests pass (1 contract, 15 core, 16 boundary, 3 README example); full `bun run test` and `bun run typecheck` pass.
      - ⚠️ Open issues and decisions needed: see "Open issues for the owner" below.

## How the code was validated

Run in `/tmp/phase-3-scratch` (not in the repo):
- `gfs.ts`, `types.ts`, all five test files, and a stand-in `src/shared/tz.ts` (an `Intl.DateTimeFormat` implementation of `getZonedParts`, 1-based month).
- `bunx tsc --noEmit` with the Phase 1 compiler flags (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`): 0 errors. (`lib` was `ES2022` only, which is why the test uses `JSON.parse(JSON.stringify(...))` and not `structuredClone`.)
- `bunx vitest run` with Vitest 5.0.5: 4 files, 35 tests, all pass.
- The 14-of-200 count cross-checked with an independent Python script.

NOT run: anything against the real Phase 2 `tz.ts` or the real repo config. The Task 1 contract test and the Phase gate cover that gap.

## Failure handling summary

- **Phase gate fails (missing `src/shared/tz.ts`, or `getZonedParts` renamed or different).** Detect: the Preflight `test -f` or `grep` fails. Respond: STOP and report. Do not write a local copy of the time zone logic.
- **Task 1 contract test fails (for example month is 0-based).** Detect: `tz-contract.test.ts` fails. Respond: STOP and report to the owner; Phase 2 owns `tz.ts`.
- **A Task 3 or Task 4 expectation fails.** Detect: Vitest diff. Respond: re-derive the expected value from the calendar (weekday and ISO week of the dates involved) before editing `gfs.ts`. If `gfs.ts` is wrong, fix it minimally and record a `> Deviation:`.

## End-to-end verification

This phase is a pure function with no endpoint, so feature-level behavior is the whole retention test folder run as a user of the public function would run it.

- [ ] Run: `bunx vitest run test/worker/retention` - Expected: 4 files, 35 tests pass, 0 fail
- [ ] Run: `bun run test && bun run typecheck` - Expected: both exit 0
- [ ] Run: `grep -rn "from \"\.\./\.\./shared/tz\"" src/worker/retention/gfs.ts` - Expected: exactly one import line, and `git diff --stat HEAD~5 HEAD -- src/shared` prints nothing (this phase did not touch `tz.ts`)

## Open issues for the owner

- No ASK items.
- **README wording (Phase 10):** the README says `daily` keeps "one backup per day for the last N days". The implemented rule counts days that have a backup, so a database that was down for 3 days still keeps N backups. Phase 10 should say "the last N days that have a backup". The README's "Every 5 minutes" wording is already covered by X13.
- **README retention sentence (Phase 10):** "Everything else is deleted ... and marked `deleted` in D1" conflicts with the soft-delete columns (`deleted_at`, `deleted_reason`); Phase 6 owns that wording, flagged here for Phase 10.
- **Interpretation choices to confirm when approving:** Decision 4 (age limit also blocks `keep_last`, inclusive at the exact limit) and Decision 6 (invalid `created_at` throws).
