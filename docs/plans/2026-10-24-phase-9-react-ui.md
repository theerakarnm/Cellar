# Phase 9: React UI Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-9-react-ui.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE task 1 and report anything down or different.
> The pure modules, their tests, the pages, the CSS, `ui/vite.config.ts`, `scripts/dev.ts` and the `wrangler.jsonc` assets block were written and run in a scratch project (`/tmp/phase-9-scratch`) with stand-ins for the Phase 2 shared modules.
> They were not run against this repo, because Phases 1-8 do not exist in the tree yet.
> When a tool rejects the code, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Build the Cellar operator UI (dashboard, targets list and form, target detail with restore and retention preview, settings with alert channels and audit log) against the finished Phase 2-8 API, served by the Worker as static assets, with `bun run dev` serving UI and API together.
**Architecture:** A Vite + React SPA in `ui/` builds to `dist/ui` and is served by Workers Static Assets (`run_worker_first` for `/api/*` and `/internal/*`, SPA fallback for everything else). In dev, `scripts/dev.ts` starts `wrangler dev` (port 8787) and the Vite dev server (port 5173, proxying `/api` and `/internal` to 8787), so the UI is opened at `http://localhost:5173`. Logic that can be wrong (time zones, health classification, form payloads, restore gating, polling, API client) lives in pure modules under `ui/src/lib/` and `ui/src/api/`, tested with plain Vitest in `test/ui/`. Pages are thin and are verified in a real browser.
**Tech Stack:** React 19, React Router 8 (`react-router`), Vite 8 (no `@vitejs/plugin-react`; JSX via `tsconfig` `jsx: react-jsx`), hand-written CSS, Zod (already added in Phase 2), Vitest.
**Spec:** `docs/plans/prds/phase-9.md`, resolved by `docs/plans/2026-10-24-phases-2-10-decisions.md` (section "Phase 9" and X1, X2, X5, X6, X7, X9, X12, X16, X17, X18).
**Reconciled with:** owner answers round 2 in `docs/plans/2026-10-24-phases-2-10-decisions.md` (binding): tunnel only, unsaved-target flow, `acknowledgeOverwrite`, `alertFailureThreshold`, Discord host allowlist, approved dependencies.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`). That tree has only `AGENTS.md`, `README.md`, `LICENSE`, and `docs/`. Phases 1-8 are not in it. Every "(planned, not yet in tree)" below describes code from an earlier plan. When an anchor does not match, run `git log --oneline 5f7ddc8..HEAD` to tell "the plan was wrong" from "the file moved on".
**Confidence:** 5/10. Rubric: start 10; -2 once because every anchor is in a file that does not exist yet (register X18); -1 for one Consumes entry without a full signature (`targetCreateSchema` / `targetUpdateSchema` from the Phase 2 plan, exact file and export names not known until Phase 2 exists; Task 1 pins them); -2 because the Phase gate and Preflight commands that touch repo files (`bun run test`, `test -f`, `db:migrate:local`, the seed script) were written but could not be run. Below 7, so execution is single track, sequential. Uncertain: exact request and response field names of Phases 2-8 (this plan assumes the camelCase shapes in `docs/PLAN.md` section 4 and register X12; Task 1 checks them and confines any change to three files).
**NOT building:**
- Any API change. If an endpoint or field is missing, Task 1 stops the phase.
- Delete target, delete backup, restore history list, or any other control the PRD page list does not name. The API has those endpoints (Phases 2, 6, 7) but the PRD lists the pages' contents explicitly.
- A separate alert-settings page or endpoint (the threshold is a target field, answer 22).
- Testing a target before it is saved (answer 24). Test connection works on saved targets only.
- Component tests (`jsdom`, `@testing-library/*`): not approved for v1 (answer 10). Pages are verified in a real browser instead (register X17).
- `@vitejs/plugin-react` (Fast Refresh): open item Q-plugin-react (default no). Dev changes do a full reload without it.
- A UI kit, a data-fetching library, a form library, a CSS framework, dark mode, i18n.
- Docs and README updates (Phase 10), except the `docs/PLAN.md` edits in the last task.
- Deploying, creating Cloudflare resources, or any remote command.

## ASK - owner decisions needed before executing

| ID | Question | Default this plan implements |
|---|---|---|
| Q-plugin-react | Add `@vitejs/plugin-react` for Fast Refresh in dev? It is not on the approved dependency list (round 2, answers 7-9). | No. JSX compiles through `tsconfig` `jsx: react-jsx` (verified in scratch with Vite 8: build and render both work). |

### Closed by owner (round 2)

- Q-stats (answer 4): `stats: { backupCount, totalBackupBytes }` stays in the target response (non-deleted success backups only). The dashboard uses it for total R2 size.
- Q-testing-libs (answer 10): `jsdom` and Testing Library are not approved for v1. No UI tests; logic stays in pure modules under `test/ui/`. Browser walkthroughs by the agent stay as Manual verifies.
- Q-test-create (answer 24): unsaved targets are never tested. The create form saves the target with `enabled = false`, the detail page offers Test connection, then an Enable button. The form and the detail page say so.
- Q-restore-ack (answer 19): the typed destination name is always required. `acknowledgeOverwrite: true` is also sent and required when the destination is the source database (the API answers 400 otherwise). A restore answers 409 when the destination has an active backup or restore; the dialog shows the message.
- Q-direct (answer 1): direct mode is removed. Tunnel only; the tunnel fields are required and there is no mode field in the UI.
- Alert threshold (answer 22): `alertFailureThreshold` lives in target create and update (Phase 2). The form has the field. There is no separate alert-settings endpoint.
- Discord webhooks (answer 23): the channel form accepts only URLs starting with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`.
- Dependencies (answer 9): `@types/react` and `@types/react-dom` are approved.

## Decisions that differ from the PRD / docs/PLAN.md

1. **`bun run dev` is a script, not `wrangler dev`.** `dev` runs `scripts/dev.ts`, which starts `bun run dev:api` (the previous `dev` command, unchanged) and `bun run dev:ui` (`vite ui`) and stops both when either exits. Open `http://localhost:5173`. Reason: Vite gives fast reloads and SPA routing; the proxy sends `/api` and `/internal` to the Worker. Verified in scratch: through the proxy the Worker saw host `127.0.0.1`, which is in the Phase 1 `DEV_BYPASS` allow-list (`localhost`, `127.0.0.1`, `[::1]`), so `DEV_BYPASS=true` works. `wrangler dev` refuses to start when `assets.directory` does not exist (verified), so the script creates `dist/ui` first.
2. **`deploy` builds the UI first** (`bun run build:ui && wrangler deploy`). The script is edited but never run in this phase.
3. **`typecheck` gains `&& tsc -p ui --noEmit`.** The UI needs the DOM lib; the Worker config uses `@cloudflare/workers-types` and no DOM lib. They are kept as two configs [uncertain: sharing one config was not tried in scratch]. The root `tsc --noEmit` still checks the UI's pure modules because `test/ui/` imports them, so those modules must not use DOM types.
4. **Total R2 size** comes from `stats.totalBackupBytes` (confirmed by the owner, answer 4).
5. **Health (red) classification is computed in the UI** from `lastStatus`, `lastBackupAt`, `createdAt`, `staleAfterHours`, `scheduleCron`, `timezone`, using the Phase 8 rule: threshold is `stale_after_hours`, else `approxIntervalMs(cron, tz, now) + 2 h` (daily = 26 h). [uncertain: the register does not say the API returns a stale flag. If the Phase 8 plan exports a shared helper or adds a field, use it and delete `staleThresholdMs`. Task 1 checks.] A disabled target is never highlighted. A target with no success yet gets the same threshold measured from `createdAt`.
6. **Audit log times**: a row whose entity is a known target uses that target's time zone. Other rows use `Asia/Bangkok` (the locked default). The PRD rule "times in the target's time zone" cannot apply to settings or channel rows.
7. **Alert events offered** are the three Phase 8 emits: `backup_failed`, `backup_consecutive_failures`, `backup_stale`.
8. **API field names are assumed** from `docs/PLAN.md` section 4 and register X12: camelCase, `tunnel: { hostname, tokenId, tokenSecret }` and `retention: { keepLast, daily, weekly, monthly, maxAgeDays }` nested in requests and responses, settings keys `max_concurrent_jobs` and `retention_dry_run`, channel credential sent as `credential: { ... }`, target field `alertFailureThreshold` (integer, default 3), restore body `{ destinationTargetId, confirmName, acknowledgeOverwrite? }`. The Phase 2 PRD writes the same fields in snake_case. Task 1 compares with what Phases 2-8 actually built. Any difference changes only `ui/src/api/types.ts`, `ui/src/lib/form.ts` (form keys are the dotted payload paths), `ui/src/lib/channel.ts`, and `ui/src/lib/restore.ts`.

## Global Constraints

- Build only UI against the existing API. Do not change API behavior. If an endpoint is missing, stop and ask (PRD).
- Minimal dependencies: React, React Router, a fetch wrapper. Ask before adding a UI kit (PRD). Any package not in `AGENTS.md` "Stack (locked)" or the approved table needs approval (register X16).
- Times shown in the target's time zone (PRD). Default zone is Asia/Bangkok (AGENTS.md).
- Secret fields are write-only: show "set" / "not set", never values (PRD, AGENTS.md "Never return them in plaintext after save").
- Works at 375 px and 1440 px widths (PRD).
- Restore has no default destination. The typed destination target name is always required. Restoring into the source database also needs `acknowledgeOverwrite: true` (UI checkbox; API 400 otherwise). A restore can answer 409 when the destination has an active backup or restore (AGENTS.md, answers 19-20).
- Tunnel only: no direct mode, no `connection_mode`, no mode field in the UI (answer 1).
- No UI or component tests in v1: no `jsdom`, no Testing Library (AGENTS.md, answer 10).
- No testing of unsaved targets: create saves with `enabled = false`, then Test connection, then enable (answer 24).
- Discord webhook URLs start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/` only (answer 23).
- Never hardcode secrets. Redact connection strings and passwords. No real hostnames or tokens in any file: use `example.com` placeholders.
- Never run `wrangler deploy`, `bun run deploy`, `bun run db:migrate:remote`, or any remote command. Local D1 only (`--local`).
- Strict TypeScript with `noUncheckedIndexedAccess`. Hono is not touched.
- Source layout (register X1): UI in `ui/`, tests in `test/ui/`, shared code in `src/shared/` (imported, not modified).
- API conventions the client relies on: errors are `{ "error": { "code", "message", "details"? } }` (X6); lists are `{ items, nextCursor: string | null }` with `?limit` (max 200) and `?cursor` (X7).
- No em dash in any file you write. Use a plain dash. One sentence per line in prose.
- Do not add the agent as co-author in commit messages.
- Only build what the PRD asks. No extra features, abstractions, or files.
- If the same step fails 3 times, stop and report what you tried.

## Dependencies (approved by the owner, round 2, answer 9)

| Package | Why | Kind |
|---|---|---|
| `@types/react` | strict TypeScript for React (React ships no types) | dev |
| `@types/react-dom` | same, for `react-dom/client` | dev |

Runtime packages `react`, `react-dom`, `react-router` are named by the PRD and AGENTS.md ("React + Vite"). `vite` is named by AGENTS.md. `zod` was added in Phase 2. `playwright-core` is installed only in `/tmp/cellar-e2e` (outside the repo) for the browser walkthrough and is not a project dependency. Nothing else is added: no `jsdom`, no Testing Library, no `@vitejs/plugin-react`. Versions resolved in scratch: react 19.3.1, react-dom 19.3.1, react-router 8.5.0, vite 8.3.5, @types/react 19.3.0, @types/react-dom 19.3.0 (`bun.lock` is the source after Task 2).

## Patterns to Mirror

All sources are plans, not code: nothing from Phases 1-8 is in the tree yet (planned, not yet in tree).

### Naming
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md "Patterns to Mirror" (planned) -->
Phase 1: files are `kebab-case.ts`; tests at `test/<mirrors src path>.test.ts`; Vitest in the Node environment.
Phase 9 follows this for logic (`ui/src/lib/form.ts`, tests in `test/ui/lib/form.test.ts`). React component files are `PascalCase.tsx` (`RestoreDialog.tsx`), the usual React convention. No existing pattern for UI files - establishing new convention: `ui/src/{api,lib,components,pages}`, pages are route targets, components are shared pieces.

### Error handling
<!-- SOURCE: docs/plans/2026-10-24-phases-2-10-decisions.md X6 -->
Server errors are `{ "error": { "code", "message", "details"? } }`. The client turns every failure into one `ApiError(status, code, message)`. Pages show `error.message` in a `role="alert"` note. A non-JSON body (for example an Access login page) becomes `ApiError` with code `bad_response` and a "reload to sign in again" message.

### Tests
<!-- SOURCE: docs/plans/2026-10-24-phases-2-10-decisions.md X17 -->
Plain Vitest, Node environment, no `jsdom`. `fetch` is stubbed with `vi.stubGlobal`. Pages are verified in a real browser.

## Phase gate

Run before Task 1. All of it must hold, or STOP and report: the earlier phase moved.

- [ ] `bun run test && bun run typecheck` - Expected: both exit 0. Record the pass count (PERISHABLE baseline below).
- [ ] Files from earlier plans exist (planned, not yet in tree):
  ```bash
  for f in package.json wrangler.jsonc vitest.config.ts tsconfig.json .dev.vars.example \
    src/worker/env.ts src/worker/app.ts src/worker/index.ts src/worker/middleware/access.ts \
    src/worker/middleware/error.ts src/worker/db/client.ts src/worker/db/schema.ts \
    src/worker/lib/validate.ts src/worker/lib/audit.ts src/worker/lib/uuidv7.ts \
    src/shared/tz.ts src/shared/cron.ts test/helpers/env.ts \
    container/hmac.ts src/worker/container/job-runner.ts src/worker/retention/types.ts; do
    test -f "$f" || echo "MISSING $f"; done
  ```
  Expected: no output.
- [ ] `grep -q "export function approxIntervalMs" src/shared/cron.ts && grep -q "export function validateCron" src/shared/cron.ts && echo ok` - Expected: `ok` (the UI imports `approxIntervalMs(expr: string, tz: string, after: Date): number`, register X9).
- [ ] `ls src/shared` - Expected: contains the Zod schema file for targets from Phase 2 (PRD item 1). Note its file name and the export names of the create and update schemas. Task 1 uses them.

## Preflight

### DURABLE - true until the repo itself changes

- **React compiles under Vite 8 without a plugin.** Evidence: in `/tmp/phase-9-scratch`, `tsconfig` `jsx: react-jsx` + `vite build ui` built, and the app rendered in Chromium with no page errors. Consequence: no `@vitejs/plugin-react`.
- **`wrangler dev` fails when `assets.directory` is missing.** Evidence: scratch run printed `The directory specified by the "assets.directory" field in your configuration file does not exist`. Consequence: `scripts/dev.ts` runs `mkdirSync("dist/ui", { recursive: true })` first.
- **`assets` config behaves as intended.** Evidence: scratch `wrangler dev` with `"run_worker_first": ["/api/*", "/internal/*"]` and `"not_found_handling": "single-page-application"`: `/`, `/x`, `/targets/abc` returned 200 `text/html`; `/api/health` returned JSON from the Worker; `/api/nope` and `/internal/jobs/callback` returned the Worker's 404 text.
- **Vite proxy plus `scripts/dev.ts` work.** Evidence: scratch run, `curl localhost:5173/api/health` returned the Worker JSON; `curl localhost:5173/targets/x` returned 200 (SPA); sending SIGTERM to the script left no `vite` or `wrangler` process running.
- **Hono lists mounted routes.** Evidence: scratch, `app.routes` included sub-app routes as `GET /api/targets/:id` after `app.route("/api/targets", sub)`. Task 1 relies on it (`ALL` entries are middleware and are skipped).
- **The root `tsconfig` checks UI pure modules under the Workers types, which lack some DOM fields.** Evidence: scratch root `tsc` failed with TS2353 on `credentials` in `RequestInit` until it was removed. Consequence: UI pure modules (`ui/src/lib`, `ui/src/api/client.ts`, `poll.ts`, `types.ts`) avoid DOM-only APIs; the UI has its own `ui/tsconfig.json` with the DOM lib for components.

### PERISHABLE - recapture before task 1

- **Bun version.** Check: `bun --version` - Expected `1.3.x` (planning run: 1.3.5). Needed by: every task.
- **Dependencies installed.** Check: `test -d node_modules && bun run typecheck` exits 0. Needed by: every task.
- **Baseline red count.** Check: `bun run test 2>&1 | tail -6; bun run typecheck 2>&1 | tail -3`. Record the exact pass/fail counts and any pre-existing failure by file here before task 1 (not known at planning time: Phases 1-8 do not exist). Every "N pass" Verify below counts only the new `test/ui/` file named in that task, so it does not depend on the baseline. Do NOT widen the baseline mid-run to make a Verify pass.
- **Migrations applied to local D1.** Check: `ls migrations | wc -l` then `bun run db:migrate:local` - Expected: applies or says nothing to apply. Needed by: End-to-end verification. Local only.
- **`.dev.vars` is set for local dev.** Check: `grep -c '^DEV_BYPASS=true$' .dev.vars` - Expected: `1`. Also `ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` non-empty (fake values are fine locally; `openssl rand -base64 32` for the key). Needed by: End-to-end verification. Report "set" or "NOT set"; never print values.
- **Docker running.** Check: `docker info >/dev/null 2>&1 && echo up` - Expected: `up`. Needed by: `bun run dev`, because Phase 5 puts a `containers` block in `wrangler.jsonc` and `wrangler dev` builds that image locally. If down: STOP and ask; do not remove the containers block.
- **Free ports 5173 (Vite) and 8787 (wrangler).** Check: `lsof -i :5173 -i :8787` - Expected: no output. If used, stop the owner of the port or STOP and ask. The ports are written in `ui/vite.config.ts` and the `dev:api` script.
- **Chromium for the walkthrough.** Check: `ls ~/Library/Caches/ms-playwright | grep '^chromium-'` - Expected: at least one `chromium-<n>` directory. If none: `npx playwright-core install chromium` from `/tmp/cellar-e2e`. Needed by: End-to-end verification.
- **Driver install outside the repo.** Check: `mkdir -p /tmp/cellar-e2e && cd /tmp/cellar-e2e && (test -f package.json || bun init -y >/dev/null) && bun add playwright-core` - Expected: `playwright-core` listed. Needed by: End-to-end verification.
- **Seed ids.** Obtain: End-to-end verification step 2 prints `<OK> <FAILING> <STALE>` (three target ids). Needed by: every Manual browser check.
- **Real backups, test connection, restore.** These need the Phase 4/5 local setup (Docker, RustFS, a local Postgres). Check: `docker compose -f test/docker-compose.test.yml ps` (Phase 4). If it is not up, the walkthrough still runs: seeded rows replace real backups, and Test connection and Backup now are asserted at the HTTP level only (202 or 409, a status line appears). Channel Test sends one request to `discord.com` with a nonexistent webhook id and is expected to report a failure. Restoring is never submitted in this phase (destructive; Phase 7 owns its local end-to-end).

## Execution

**Tracks:** one track, sequential. Single track because the plan's confidence is below 7, and no parallel slice would reach the cost floor (3 tasks or 5 files) without sharing `ui/src/main.tsx` and `package.json`.
**Merge order:** not applicable (single track).
**Shared files:** `package.json` and `bun.lock` are owned by Task 2 only. `wrangler.jsonc` is owned by Task 2 only. `ui/src/main.tsx` is created in Task 2, replaced in Task 10, and edited in Tasks 11, 12, 14, and 15 (each adds its own routes, in order). `ui/src/pages/Settings.tsx` is created in Task 15 and edited in Tasks 16 and 17. `docs/PLAN.md` is owned by Task 18 only. `.dev.vars.example` is not touched (no new secret or var). Migration directory is not touched (no schema change).
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch: `git switch -c phase-9-react-ui`.
**treehouse:** not needed for a single track.

---

### Task 1: API gap check (read-only, STOP gate)

**Files:**
- Create (not committed): `/tmp/phase-9-gap.ts`
- Nothing in the repo changes in this task.

**Interfaces:**
- Consumes: `app` from `src/worker/app.ts` (register X2): `Hono<AppEnv>` with `.routes: { method: string; path: string }[]`.
- Produces: a confirmed endpoint list and a confirmed field map (the assumptions in "Decisions" item 8), recorded as `> Deviation:` lines in this plan if anything differs.

**Gotcha:** Hono reports mounted sub-app routes with full paths, and reports middleware as method `ALL`. Parameter names differ between plans (`:id`, `:backupId`), so the script normalizes every `:name` to `:p`.

**Steps:**
- [ ] Step 1: Create `/tmp/phase-9-gap.ts` (run from the repo root; the script was validated against a stub app in scratch):
```ts
const { app } = await import(`${process.cwd()}/src/worker/app`);

const norm = (path: string) => path.replace(/:[A-Za-z]+/g, ":p");
const have = new Set<string>(
  (app.routes as { method: string; path: string }[]).filter((r) => r.method !== "ALL").map((r) => `${r.method} ${norm(r.path)}`),
);
const need = [
  "GET /api/targets",
  "POST /api/targets",
  "GET /api/targets/:p",
  "PATCH /api/targets/:p",
  "POST /api/targets/:p/test",
  "GET /api/targets/:p/test/:p",
  "POST /api/targets/:p/backup",
  "GET /api/targets/:p/backups",
  "GET /api/targets/:p/retention-preview",
  "POST /api/backups/:p/download-url",
  "POST /api/backups/:p/restore",
  "GET /api/restores/:p",
  "GET /api/alert-channels",
  "POST /api/alert-channels",
  "PATCH /api/alert-channels/:p",
  "DELETE /api/alert-channels/:p",
  "POST /api/alert-channels/:p/test",
  "GET /api/settings",
  "PUT /api/settings",
  "GET /api/audit-logs",
];
const missing = need.filter((entry) => !have.has(entry));
for (const entry of need) console.log(have.has(entry) ? "ok     " : "MISSING", entry);
console.log(missing.length === 0 ? `all ${need.length} endpoints present` : `${missing.length} missing`);
process.exit(missing.length === 0 ? 0 : 1);
```
- [ ] Step 2: Run it: `bun /tmp/phase-9-gap.ts`. For each MISSING line: STOP and report. Do not build around it. Known inputs from the register: target `stats` (Phase 2, answer 4), settings routes (Phase 5), retention preview (Phase 6), restore status (Phase 7), alert channels (Phase 8).
- [ ] Step 3: Confirm field shapes by reading the Phase 2-8 plans' `Produces:` blocks and the route and schema source (`src/shared/` schema file, route files). Check each line; a renamed field is a Deviation limited to the three files in "Decisions" item 8, a field that does not exist at all is a STOP:
  1. Target response has: `id, name, projectTag, connection{host,port,dbName,user}, hasRestoreUrl, hasTunnelToken, tunnelHostname, scheduleCron, timezone, enabled, retention{keepLast,daily,weekly,monthly,maxAgeDays}, jobDeadlineMinutes, staleAfterHours, alertFailureThreshold, alertChannelIds, lastStatus, lastBackupAt, nextRunAt, createdAt, stats{backupCount,totalBackupBytes}`.
  2. Target create/update body field names match the dotted keys in `emptyFormValues()` (Task 7): `name, projectTag, connectionUrl, restoreUrl, tunnel.hostname, tunnel.tokenId, tunnel.tokenSecret, scheduleCron, timezone, retention.*, jobDeadlineMinutes, staleAfterHours, alertFailureThreshold, enabled, alertChannelIds`. There is no `connectionMode` (tunnel only); if the API still has one, STOP.
  3. Record the file name and export names of the target create and update Zod schemas (used by `ui/src/lib/schemas.ts`, Task 7), and confirm they import nothing Worker-only (they are bundled into the browser).
  4. `GET /api/targets/:id/backups` items have `id, targetId, status, trigger, sizeBytes, sha256, pgVersionServer, durationMs, errorCode, errorMessage, queuedAt, startedAt, finishedAt`.
  5. `POST /api/targets/:id/test` returns `202 { testId }`; `GET .../test/:testId` returns `{ status, result?: { pgServerVersion?, hasReadAllData? }, error?: { code, message } }` with status in `queued|running|success|failed|timed_out`.
  6. `POST /api/targets/:id/backup` returns `202 { backupId }` and `409` when one is active.
  7. `POST /api/backups/:id/download-url` returns `{ url, expiresAt }`.
  8. `POST /api/backups/:id/restore` accepts `{ destinationTargetId, confirmName, acknowledgeOverwrite? }` (400 when the destination is the source database and `acknowledgeOverwrite` is not `true`; 409 when the destination has an active backup or restore) and returns `{ restoreId, sameDatabase }` (202); `GET /api/restores/:id` returns `{ id, status, errorCode, errorMessage }`.
  9. `GET /api/targets/:id/retention-preview` returns `{ keep: string[], delete: string[], reasons: Record<string, string[]> }` (ids). If it returns backup objects instead, change `RetentionPreview` and `deletionRows` (Task 8) only.
  10. Alert channel response: `id, type, name, events, enabled, hasCredential`; create/update body: `type, name, events, enabled, credential` (`{ token, to }` for line, `{ webhookUrl }` for discord); `POST .../test` returns `{ ok, error? }`. Update (PATCH) leaves the stored credential unchanged when `credential` is omitted.
  11. `GET /api/settings` returns `{ max_concurrent_jobs, retention_dry_run }`; `PUT /api/settings` accepts both keys.
  12. `GET /api/audit-logs` items have `id, at, actor, action, entityType, entityId, details`; `entityType` filter is the query key `entityType`.
  13. Whether any response carries a ready-made stale flag, or Phase 8 exports a shared stale-threshold helper (see "Decisions" item 5). If yes, use it in Task 4 instead of `staleThresholdMs`.
- [ ] Step 4: Verify - Run: `bun /tmp/phase-9-gap.ts; echo "exit=$?"` - Expected: 20 `ok` lines, `all 20 endpoints present`, `exit=0`
- [ ] Step 5: No commit (nothing in the repo changed). Create the branch now: `git switch -c phase-9-react-ui`.

---

### Task 2: UI scaffold, dev script, static assets

**Files:**
- Modify: `package.json` (anchor: `"scripts"`) and `bun.lock` (emitted by `bun add`)
- Modify: `wrangler.jsonc` (anchor: `"compatibility_date"`)
- Create: `ui/index.html`, `ui/vite.config.ts`, `ui/tsconfig.json`, `ui/src/main.tsx`, `scripts/dev.ts`
- This task exceeds the usual 3-file ceiling on purpose: these files only build together, and each commit must build.

**Interfaces:**
- Consumes: scripts and `wrangler.jsonc` from Phase 1 (and Phase 4/5 edits to them); `.gitignore` already ignores `dist/` (Phase 1 Task 1).
- Produces: scripts `dev`, `dev:api`, `dev:ui`, `build:ui`, a `typecheck` that also checks `ui/`, `dist/ui` build output, the `assets` block, and a placeholder `ui/src/main.tsx` that Task 10 replaces.

**Gotcha:**
- `dev:api` must keep the old `dev` command verbatim. It has to listen on port 8787 (the `--port` flag if the old command does not already pin it) because `ui/vite.config.ts` proxies to `http://127.0.0.1:8787`. If a later phase pinned another port, change the proxy constant to match.
- Never run `bun run deploy` (the edited script builds then deploys).
- The `assets` block is added next to the other top-level keys. Do not touch the `containers`, `durable_objects`, `queues`, `triggers` blocks from Phase 5.
- `"use client"` warnings from `react-router` during `vite build` are harmless.

**Steps:**
- [ ] Step 1: Install (`@types/*` are approved, see the dependency table above):
  ```bash
  bun add react react-dom react-router
  bun add -d vite @types/react @types/react-dom
  ```
- [ ] Step 2: Edit `package.json` scripts to this shape. Read the current `dev` and `typecheck` values first; keep them as described:
```json
"scripts": {
  "dev": "bun scripts/dev.ts",
  "dev:api": "<the previous value of the dev script, verbatim, for example: wrangler dev --port 8787>",
  "dev:ui": "vite ui",
  "build:ui": "vite build ui",
  "typecheck": "<the current value> && tsc -p ui --noEmit",
  "deploy": "bun run build:ui && wrangler deploy"
}
```
- [ ] Step 3: Add to `wrangler.jsonc`, after `"compatibility_date"`:
  ```jsonc
  "assets": {
    "directory": "dist/ui",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/internal/*"]
  },
  ```
- [ ] Step 4: Create `ui/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cellar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
- [ ] Step 5: Create `ui/vite.config.ts`:
```ts
import { defineConfig } from "vite";

// 8787 is wrangler's default port. `bun run dev:api` must listen there (see scripts/dev.ts).
const api = "http://127.0.0.1:8787";

export default defineConfig({
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { "/api": api, "/internal": api } },
});
```
- [ ] Step 6: Create `ui/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src", "vite.config.ts"]
}
```
- [ ] Step 7: Create the placeholder `ui/src/main.tsx` (Task 10 replaces it):
```tsx
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root") as HTMLElement).render(<h1>Cellar</h1>);
```
- [ ] Step 8: Create `scripts/dev.ts`:
```ts
import { mkdirSync } from "node:fs";

// wrangler refuses to start when assets.directory is missing. In dev the UI comes from Vite, so an empty folder is enough.
mkdirSync("dist/ui", { recursive: true });

const children = [Bun.spawn(["bun", "run", "dev:api"], { stdio: ["inherit", "inherit", "inherit"] }), Bun.spawn(["bun", "run", "dev:ui"], { stdio: ["inherit", "inherit", "inherit"] })];

function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(children.map((child) => child.exited));
stop();
process.exit(1);
```
- [ ] Step 9: Verify - Run: `bun run typecheck && bun run build:ui && test -f dist/ui/index.html && echo built` - Expected: typecheck exits 0 (both `tsc` runs print nothing), Vite prints `built in`, then `built`
- [ ] Step 10: Verify - Manual: start `bun run dev` in the background, then `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/targets/x; curl -s http://localhost:5173/api/health`, then stop it (`kill` the dev process) and run `pgrep -fl 'vite|wrangler'` - Expected: `200`, then `{"ok":true}` (the Phase 1 health body), and no leftover `vite` or `wrangler` process after stopping
- [ ] Step 11: Commit - `git add package.json bun.lock wrangler.jsonc ui scripts && git commit -m "feat(ui): scaffold Vite React app, dev script, and static assets"`

---

### Task 3: API types and time formatting

**Files:**
- Create: `ui/src/api/types.ts`, `ui/src/lib/time.ts`
- Test: `test/ui/lib/time.test.ts`

**Interfaces:**
- Consumes: nothing (types follow the field map confirmed in Task 1; apply any Deviation from Task 1 here).
- Produces:
  - Types in `ui/src/api/types.ts`: `JobStatus`, `Page<T>`, `RetentionFields`, `TargetSummary`, `Backup`, `ConnectionTest`, `RestoreRun`, `RetentionPreview`, `ChannelType`, `ChannelEvent`, `AlertChannel`, `Settings`, `AuditEntry` (full declarations below).
  - `DEFAULT_TIMEZONE: "Asia/Bangkok"`
  - `formatInTimeZone(iso: string | null | undefined, timeZone: string): string` - `2026-10-24 02:00 GMT+7`, or `-`.
  - `formatRelative(iso: string | null | undefined, now: Date): string` - `5 min ago`, `in 2 h`, `just now`, or `-`.
  - `timeZoneForAudit(entityType: string, entityId: string | null, targets: readonly Pick<TargetSummary, "id" | "timezone">[]): string`

**Gotcha:** UTC renders as `GMT` (not `UTC`) with `timeZoneName: "shortOffset"` in `en-GB`. The test pins that. `Intl.DateTimeFormat` throws `RangeError` on an invalid zone; targets are validated by Phase 2, so there is no catch.

**Steps:**
- [ ] Step 1: Create `ui/src/api/types.ts`:
```ts
export type JobStatus = "queued" | "running" | "success" | "failed" | "timed_out";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface RetentionFields {
  keepLast: number | null;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
  maxAgeDays: number | null;
}

export interface TargetSummary {
  id: string;
  name: string;
  projectTag: string | null;
  connection: { host: string; port: number; dbName: string; user: string };
  hasRestoreUrl: boolean;
  hasTunnelToken: boolean;
  tunnelHostname: string | null;
  scheduleCron: string;
  timezone: string;
  enabled: boolean;
  retention: RetentionFields;
  jobDeadlineMinutes: number;
  staleAfterHours: number | null;
  alertFailureThreshold: number;
  alertChannelIds: string[];
  lastStatus: JobStatus | null;
  lastBackupAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  stats: { backupCount: number; totalBackupBytes: number };
}

export interface Backup {
  id: string;
  targetId: string;
  status: JobStatus;
  trigger: "schedule" | "manual";
  sizeBytes: number | null;
  sha256: string | null;
  pgVersionServer: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ConnectionTest {
  status: JobStatus;
  result?: { pgServerVersion?: string; hasReadAllData?: boolean };
  error?: { code: string; message: string };
}

export interface RestoreRun {
  id: string;
  status: JobStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface RetentionPreview {
  keep: string[];
  delete: string[];
  reasons: Record<string, string[]>;
}

export type ChannelType = "line" | "discord";
export type ChannelEvent = "backup_failed" | "backup_stale" | "backup_consecutive_failures";

export interface AlertChannel {
  id: string;
  type: ChannelType;
  name: string;
  events: ChannelEvent[];
  enabled: boolean;
  hasCredential: boolean;
}

export interface Settings {
  max_concurrent_jobs: number;
  retention_dry_run: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: string | null;
}
```
- [ ] Step 2: Create `ui/src/lib/time.ts`:
```ts
import type { TargetSummary } from "../api/types";

export const DEFAULT_TIMEZONE = "Asia/Bangkok";

/** `2026-10-24 02:00 GMT+7`. Returns "-" for missing or invalid input. */
export function formatInTimeZone(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${part("timeZoneName")}`;
}

/** `5 min ago`, `3 h ago`, `in 2 d`. */
export function formatRelative(iso: string | null | undefined, now: Date): string {
  if (!iso) return "-";
  const diffMs = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(diffMs)) return "-";
  const abs = Math.abs(diffMs);
  if (abs < 60_000) return "just now";
  const unit = abs < 3_600_000 ? `${Math.round(abs / 60_000)} min` : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)} h` : `${Math.round(abs / 86_400_000)} d`;
  return diffMs < 0 ? `${unit} ago` : `in ${unit}`;
}

/** Audit rows use the target's zone when the entity is a known target, else the default zone. */
export function timeZoneForAudit(entityType: string, entityId: string | null, targets: readonly Pick<TargetSummary, "id" | "timezone">[]): string {
  if (entityType !== "target" || !entityId) return DEFAULT_TIMEZONE;
  return targets.find((t) => t.id === entityId)?.timezone ?? DEFAULT_TIMEZONE;
}
```
- [ ] Step 3: Create `test/ui/lib/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE, formatInTimeZone, formatRelative, timeZoneForAudit } from "../../../ui/src/lib/time";

describe("formatInTimeZone", () => {
  it("shows the same instant in the target's zone", () => {
    expect(formatInTimeZone("2026-10-23T19:00:00.000Z", "Asia/Bangkok")).toBe("2026-10-24 02:00 GMT+7");
    expect(formatInTimeZone("2026-10-23T19:00:00.000Z", "UTC")).toBe("2026-10-23 19:00 GMT");
  });

  it("follows daylight saving in the zone", () => {
    expect(formatInTimeZone("2026-07-01T12:00:00.000Z", "Europe/London")).toBe("2026-07-01 13:00 GMT+1");
    expect(formatInTimeZone("2026-01-01T12:00:00.000Z", "Europe/London")).toBe("2026-01-01 12:00 GMT");
  });

  it("rolls the date over at midnight local time", () => {
    expect(formatInTimeZone("2026-12-31T17:30:00.000Z", "Asia/Bangkok")).toBe("2027-01-01 00:30 GMT+7");
  });

  it("returns a dash for missing or invalid input", () => {
    expect(formatInTimeZone(null, "UTC")).toBe("-");
    expect(formatInTimeZone("not a date", "UTC")).toBe("-");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  it.each([
    ["2026-10-24T11:59:30.000Z", "just now"],
    ["2026-10-24T11:55:00.000Z", "5 min ago"],
    ["2026-10-24T09:00:00.000Z", "3 h ago"],
    ["2026-10-22T12:00:00.000Z", "2 d ago"],
    ["2026-10-24T14:00:00.000Z", "in 2 h"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});

describe("timeZoneForAudit", () => {
  const targets = [{ id: "t1", timezone: "UTC" }];
  it("uses the target's zone for target entries", () => {
    expect(timeZoneForAudit("target", "t1", targets)).toBe("UTC");
  });
  it("falls back to the default zone", () => {
    expect(timeZoneForAudit("target", "gone", targets)).toBe(DEFAULT_TIMEZONE);
    expect(timeZoneForAudit("settings", null, targets)).toBe(DEFAULT_TIMEZONE);
  });
});
```
- [ ] Step 4: Verify - Run: `bunx vitest run test/ui/lib/time.test.ts && bun run typecheck` - Expected: 11 pass, 0 fail; typecheck exits 0
- [ ] Step 5: Commit - `git add ui/src/api/types.ts ui/src/lib/time.ts test/ui/lib/time.test.ts && git commit -m "feat(ui): add API types and time-zone formatting"`

---

### Task 4: Target health classification

**Files:**
- Create: `ui/src/lib/status.ts`
- Test: `test/ui/lib/status.test.ts`

**Interfaces:**
- Consumes: `approxIntervalMs(expr: string, tz: string, after: Date): number` from `src/shared/cron.ts` (register X9; planned, not yet in tree); `TargetSummary`, `JobStatus` (Task 3).
- Produces:
  - `type TargetHealth = "failing" | "stale" | "ok" | "never" | "disabled"`
  - `staleThresholdMs(target: Pick<TargetSummary, "staleAfterHours" | "scheduleCron" | "timezone">, now: Date): number`
  - `classifyTarget(target: Pick<TargetSummary, "enabled" | "lastStatus" | "lastBackupAt" | "createdAt" | "staleAfterHours" | "scheduleCron" | "timezone">, now: Date): TargetHealth`
  - `isRedHealth(health: TargetHealth): boolean`, `isActiveStatus(status: JobStatus): boolean`, `isTerminalStatus(status: JobStatus): boolean`

**Gotcha:** In scratch the test ran against a stub `approxIntervalMs` that returns 24 h for every input. Against the real Phase 2 function a daily cron in `Asia/Bangkok` also gives 24 h (no DST), so `26 h` holds; if the real value differs, fix the code, not the test. If Task 1 found a shared stale helper, import it here and delete `staleThresholdMs` and its test block.

**Steps:**
- [ ] Step 1: Create `ui/src/lib/status.ts`:
```ts
import { approxIntervalMs } from "../../../src/shared/cron";
import type { JobStatus, TargetSummary } from "../api/types";

export type TargetHealth = "failing" | "stale" | "ok" | "never" | "disabled";

const HOUR_MS = 3_600_000;
const STALE_GRACE_MS = 2 * HOUR_MS;

/** Mirrors the Phase 8 rule: `stale_after_hours`, else the schedule interval plus 2 hours (daily = 26 h). */
export function staleThresholdMs(target: Pick<TargetSummary, "staleAfterHours" | "scheduleCron" | "timezone">, now: Date): number {
  if (target.staleAfterHours !== null) return target.staleAfterHours * HOUR_MS;
  return approxIntervalMs(target.scheduleCron, target.timezone, now) + STALE_GRACE_MS;
}

export function classifyTarget(
  target: Pick<TargetSummary, "enabled" | "lastStatus" | "lastBackupAt" | "createdAt" | "staleAfterHours" | "scheduleCron" | "timezone">,
  now: Date,
): TargetHealth {
  if (!target.enabled) return "disabled";
  if (target.lastStatus === "failed" || target.lastStatus === "timed_out") return "failing";
  const reference = new Date(target.lastBackupAt ?? target.createdAt).getTime();
  if (now.getTime() - reference > staleThresholdMs(target, now)) return "stale";
  return target.lastBackupAt ? "ok" : "never";
}

export function isRedHealth(health: TargetHealth): boolean {
  return health === "failing" || health === "stale";
}

export function isActiveStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

export function isTerminalStatus(status: JobStatus): boolean {
  return !isActiveStatus(status);
}
```
- [ ] Step 2: Create `test/ui/lib/status.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classifyTarget, isActiveStatus, isRedHealth, staleThresholdMs } from "../../../ui/src/lib/status";

const now = new Date("2026-10-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const base = { enabled: true, lastStatus: "success" as const, lastBackupAt: hoursAgo(2), createdAt: hoursAgo(500), staleAfterHours: null, scheduleCron: "0 2 * * *", timezone: "Asia/Bangkok" };

describe("staleThresholdMs", () => {
  it("is the schedule interval plus 2 hours when not overridden (daily = 26 h)", () => {
    expect(staleThresholdMs(base, now)).toBe(26 * 3_600_000);
  });
  it("uses stale_after_hours when set", () => {
    expect(staleThresholdMs({ ...base, staleAfterHours: 5 }, now)).toBe(5 * 3_600_000);
  });
});

describe("classifyTarget", () => {
  it("is ok for a recent success", () => {
    expect(classifyTarget(base, now)).toBe("ok");
  });
  it("is failing when the last job failed or timed out", () => {
    expect(classifyTarget({ ...base, lastStatus: "failed" }, now)).toBe("failing");
    expect(classifyTarget({ ...base, lastStatus: "timed_out" }, now)).toBe("failing");
  });
  it("is not failing while a job is queued or running", () => {
    expect(classifyTarget({ ...base, lastStatus: "running" }, now)).toBe("ok");
  });
  it("turns stale just past the threshold, not before", () => {
    expect(classifyTarget({ ...base, lastBackupAt: hoursAgo(25.9) }, now)).toBe("ok");
    expect(classifyTarget({ ...base, lastBackupAt: hoursAgo(26.1) }, now)).toBe("stale");
  });
  it("uses stale_after_hours for the threshold", () => {
    expect(classifyTarget({ ...base, staleAfterHours: 1, lastBackupAt: hoursAgo(2) }, now)).toBe("stale");
  });
  it("gives a new target with no backup a grace period, then calls it stale", () => {
    const fresh = { ...base, lastStatus: null, lastBackupAt: null };
    expect(classifyTarget({ ...fresh, createdAt: hoursAgo(1) }, now)).toBe("never");
    expect(classifyTarget({ ...fresh, createdAt: hoursAgo(30) }, now)).toBe("stale");
  });
  it("never highlights a disabled target", () => {
    expect(classifyTarget({ ...base, enabled: false, lastStatus: "failed" }, now)).toBe("disabled");
  });
});

describe("helpers", () => {
  it("marks only failing and stale as red", () => {
    expect(["failing", "stale", "ok", "never", "disabled"].map((h) => isRedHealth(h as never))).toEqual([true, true, false, false, false]);
  });
  it("treats queued and running as active", () => {
    expect(["queued", "running", "success", "failed", "timed_out"].map((s) => isActiveStatus(s as never))).toEqual([true, true, false, false, false]);
  });
});
```
- [ ] Step 3: Verify - Run: `bunx vitest run test/ui/lib/status.test.ts && bun run typecheck` - Expected: 11 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add ui/src/lib/status.ts test/ui/lib/status.test.ts && git commit -m "feat(ui): classify target health for red highlighting"`

---

### Task 5: Display helpers

**Files:**
- Create: `ui/src/lib/display.ts`
- Test: `test/ui/lib/display.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatBytes(bytes: number | null | undefined): string`, `formatDuration(ms: number | null | undefined): string`, `secretLabel(isSet: boolean): "set" | "not set"`, `connectionLabel(connection: { host: string; port: number; dbName: string; user: string }): string`.

**Steps:**
- [ ] Step 1: Create `ui/src/lib/display.ts`:
```ts
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Secrets are write-only: the UI only ever shows whether one is stored. */
export function secretLabel(isSet: boolean): "set" | "not set" {
  return isSet ? "set" : "not set";
}

export function connectionLabel(connection: { host: string; port: number; dbName: string; user: string }): string {
  return `${connection.user}@${connection.host}:${connection.port}/${connection.dbName}`;
}
```
- [ ] Step 2: Create `test/ui/lib/display.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { connectionLabel, formatBytes, formatDuration, secretLabel } from "../../../ui/src/lib/display";

describe("display", () => {
  it.each([
    [null, "-"],
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1536 * 1024, "1.5 MiB"],
    [5 * 1024 ** 3, "5.0 GiB"],
    [150 * 1024 ** 2, "150 MiB"],
  ])("formatBytes(%s) = %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it.each([
    [null, "-"],
    [4_000, "4 s"],
    [125_000, "2 min 5 s"],
    [3_900_000, "1 h 5 min"],
  ])("formatDuration(%s) = %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it("labels secrets as set or not set and never takes a value", () => {
    expect(secretLabel(true)).toBe("set");
    expect(secretLabel(false)).toBe("not set");
  });

  it("formats the masked connection without a password", () => {
    expect(connectionLabel({ host: "db.example.com", port: 5432, dbName: "app", user: "backup" })).toBe("backup@db.example.com:5432/app");
  });
});
```
- [ ] Step 3: Verify - Run: `bunx vitest run test/ui/lib/display.test.ts && bun run typecheck` - Expected: 13 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add ui/src/lib/display.ts test/ui/lib/display.test.ts && git commit -m "feat(ui): add byte, duration, and masked-connection formatters"`

---

### Task 6: Fetch wrapper and polling

**Files:**
- Create: `ui/src/api/client.ts`, `ui/src/api/poll.ts`
- Test: `test/ui/api/client.test.ts`, `test/ui/api/poll.test.ts`

**Interfaces:**
- Consumes: `Page<T>` (Task 3).
- Produces:
  - `class ApiError extends Error { constructor(status: number, code: string, message: string); readonly status: number; readonly code: string }`
  - `withQuery(path: string, params: Record<string, string | number | undefined>): string`
  - `api<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T>` (returns `undefined` for 204)
  - `listAll<T>(path: string): Promise<T[]>` (follows `nextCursor`, `limit=200`)
  - `pollUntil<T>(fetchOnce: () => Promise<T>, isDone: (value: T) => boolean, options: { intervalMs: number; maxAttempts: number; signal?: AbortSignal; onUpdate?: (value: T) => void }): Promise<T>`

**Gotcha:** These files are type-checked by the root `tsc` (through the tests) under `@cloudflare/workers-types`, so no DOM-only `RequestInit` fields (`credentials`) are used. `fetch` sends same-origin cookies by default, which is what Access needs.

**Steps:**
- [ ] Step 1: Create `ui/src/api/client.ts`:
```ts
import type { Page } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}${path.includes("?") ? "&" : "?"}${text}` : path;
}

export async function api<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new ApiError(response.status, "bad_response", `Unexpected response (HTTP ${response.status}). Reload the page to sign in again.`);
  }
  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(response.status, error?.code ?? "unknown", error?.message ?? `Request failed (HTTP ${response.status})`);
  }
  return parsed as T;
}

export async function listAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const page: Page<T> = await api("GET", withQuery(path, { limit: 200, cursor: cursor ?? undefined }));
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
```
- [ ] Step 2: Create `ui/src/api/poll.ts`:
```ts
export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: { intervalMs: number; maxAttempts: number; signal?: AbortSignal; onUpdate?: (value: T) => void },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const value = await fetchOnce();
    options.onUpdate?.(value);
    if (isDone(value)) return value;
    if (attempt >= options.maxAttempts) throw new Error("Timed out waiting for the result");
    if (options.signal?.aborted) throw new Error("Cancelled");
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
```
- [ ] Step 3: Create `test/ui/api/client.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, listAll, withQuery } from "../../../ui/src/api/client";

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends JSON and returns the parsed body", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    expect(await api("POST", "/api/x", { a: 1 })).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
  });

  it("returns undefined for 204", async () => {
    stubFetch(new Response(null, { status: 204 }));
    expect(await api("DELETE", "/api/x")).toBeUndefined();
  });

  it("turns the error envelope into an ApiError", async () => {
    stubFetch(Response.json({ error: { code: "conflict", message: "Name taken" } }, { status: 409 }));
    await expect(api("POST", "/api/x", {})).rejects.toMatchObject({ status: 409, code: "conflict", message: "Name taken" });
  });

  it("reports a non-JSON body (for example an Access login page) as bad_response", async () => {
    stubFetch(new Response("<html>login</html>", { status: 200 }));
    const error = await api("GET", "/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("bad_response");
  });
});

describe("withQuery", () => {
  it("skips empty values and appends to an existing query", () => {
    expect(withQuery("/api/x", { limit: 5, cursor: undefined, entityType: "" })).toBe("/api/x?limit=5");
    expect(withQuery("/api/x?a=1", { b: "2" })).toBe("/api/x?a=1&b=2");
    expect(withQuery("/api/x", {})).toBe("/api/x");
  });
});

describe("listAll", () => {
  it("follows nextCursor until it is null", async () => {
    const fetchMock = stubFetch(Response.json({ items: [1, 2], nextCursor: "c1" }), Response.json({ items: [3], nextCursor: null }));
    expect(await listAll<number>("/api/x")).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/x?limit=200", "/api/x?limit=200&cursor=c1"]);
  });
});
```
- [ ] Step 4: Create `test/ui/api/poll.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { pollUntil } from "../../../ui/src/api/poll";

describe("pollUntil", () => {
  it("polls until done and reports each value", async () => {
    const values = ["queued", "running", "success"];
    const seen: string[] = [];
    const result = await pollUntil(async () => values.shift() as string, (v) => v === "success", { intervalMs: 1, maxAttempts: 10, onUpdate: (v) => seen.push(v) });
    expect(result).toBe("success");
    expect(seen).toEqual(["queued", "running", "success"]);
  });

  it("gives up after maxAttempts", async () => {
    await expect(pollUntil(async () => "running", (v) => v === "success", { intervalMs: 1, maxAttempts: 3 })).rejects.toThrow("Timed out");
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(pollUntil(async () => "running", () => false, { intervalMs: 1, maxAttempts: 50, signal: controller.signal })).rejects.toThrow("Cancelled");
  });

  it("propagates fetch errors", async () => {
    await expect(pollUntil(async () => Promise.reject(new Error("boom")), () => true, { intervalMs: 1, maxAttempts: 3 })).rejects.toThrow("boom");
  });
});
```
- [ ] Step 5: Verify - Run: `bunx vitest run test/ui/api && bun run typecheck` - Expected: 10 pass (6 client, 4 poll), 0 fail; typecheck exits 0
- [ ] Step 6: Commit - `git add ui/src/api/client.ts ui/src/api/poll.ts test/ui/api && git commit -m "feat(ui): add typed fetch wrapper, pagination, and polling helper"`

---

### Task 7: Target form logic

**Files:**
- Create: `ui/src/lib/form.ts`, `ui/src/lib/schemas.ts`
- Test: `test/ui/lib/form.test.ts`

**Interfaces:**
- Consumes: `TargetSummary` (Task 3); the Phase 2 Zod schemas for target create and update, exported from `src/shared/` (file and export names confirmed in Task 1 step 3; the reference uses `src/shared/targets.ts` with `targetCreateSchema` and `targetUpdateSchema`, each a Zod object schema with `.safeParse(input: unknown)`).
- Produces:
  - `type FormValues = Record<string, string>`, `type FormMode = "create" | "edit"`
  - `emptyFormValues(): FormValues` (keys are dotted API payload paths; defaults: `0 2 * * *`, `Asia/Bangkok`, retention 3/7/4/6, deadline 120, failure threshold 3, `enabled: "false"` so a new target is saved disabled, tested, then enabled)
  - `targetToFormValues(target: TargetSummary): FormValues` (secrets blank)
  - `toPayload(values: FormValues, mode: FormMode, alertChannelIds: string[]): Record<string, unknown>`
  - `fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string>`
  - `targetCreateSchema`, `targetUpdateSchema` re-exported from `ui/src/lib/schemas.ts` (the one place the UI imports Phase 2's schemas)

**Gotcha:**
- `schemas.ts` is not imported by any test (so the root `tsc` and Vitest do not need `src/shared/<schemas>` to be Workers-free); the UI `tsc -p ui` checks it. If Task 1 found a different file or export name, change only this file and record a Deviation.
- Zod 4 `issue.path` is `PropertyKey[]`. `fieldErrors` joins with `.` so a nested issue `["tunnel","hostname"]` matches the form key `tunnel.hostname`.
- Tunnel hostname, token id and token secret are required on create (tunnel only, columns are NOT NULL; there is no direct mode). On edit, blank secrets are omitted, so the stored values are kept.
- `alertFailureThreshold` lives in the target create and update body (Phase 2). It is never cleared (NOT NULL, default 3).
- Edit mode sends `null` for a cleared optional field and omits blank secrets. If the Phase 2 update schema does not accept `null` for a field, it is a STOP (it would make "clear max age" impossible).

**Steps:**
- [ ] Step 1: Create `ui/src/lib/form.ts`:
```ts
import type { TargetSummary } from "../api/types";

/** Form state is flat: each key is the dotted path of the field in the API payload. */
export type FormValues = Record<string, string>;
export type FormMode = "create" | "edit";

const NUMBER_KEYS = new Set([
  "retention.keepLast",
  "retention.daily",
  "retention.weekly",
  "retention.monthly",
  "retention.maxAgeDays",
  "jobDeadlineMinutes",
  "staleAfterHours",
  "alertFailureThreshold",
]);
const SECRET_KEYS = new Set(["connectionUrl", "restoreUrl", "tunnel.tokenId", "tunnel.tokenSecret"]);
const CLEARABLE_KEYS = new Set(["projectTag", "staleAfterHours", "retention.keepLast", "retention.daily", "retention.weekly", "retention.monthly", "retention.maxAgeDays"]);

export function emptyFormValues(): FormValues {
  return {
    name: "",
    projectTag: "",
    connectionUrl: "",
    restoreUrl: "",
    "tunnel.hostname": "",
    "tunnel.tokenId": "",
    "tunnel.tokenSecret": "",
    scheduleCron: "0 2 * * *",
    timezone: "Asia/Bangkok",
    "retention.keepLast": "3",
    "retention.daily": "7",
    "retention.weekly": "4",
    "retention.monthly": "6",
    "retention.maxAgeDays": "",
    jobDeadlineMinutes: "120",
    staleAfterHours: "",
    alertFailureThreshold: "3",
    enabled: "false",
  };
}

/** Secret fields start blank: the API never returns them. */
export function targetToFormValues(target: TargetSummary): FormValues {
  const text = (value: number | string | null) => (value === null ? "" : String(value));
  return {
    ...emptyFormValues(),
    name: target.name,
    projectTag: text(target.projectTag),
    "tunnel.hostname": text(target.tunnelHostname),
    scheduleCron: target.scheduleCron,
    timezone: target.timezone,
    "retention.keepLast": text(target.retention.keepLast),
    "retention.daily": text(target.retention.daily),
    "retention.weekly": text(target.retention.weekly),
    "retention.monthly": text(target.retention.monthly),
    "retention.maxAgeDays": text(target.retention.maxAgeDays),
    jobDeadlineMinutes: String(target.jobDeadlineMinutes),
    staleAfterHours: text(target.staleAfterHours),
    alertFailureThreshold: String(target.alertFailureThreshold),
    enabled: String(target.enabled),
  };
}

function setDeep(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (typeof next === "object" && next !== null) {
      cursor = next as Record<string, unknown>;
    } else {
      const created: Record<string, unknown> = {};
      cursor[part] = created;
      cursor = created;
    }
  }
  cursor[parts[parts.length - 1] as string] = value;
}

/**
 * Builds the API body. Blank secrets are always omitted (edit keeps the stored value).
 * Blank clearable fields are omitted on create and sent as null on edit.
 * A new target starts disabled (`emptyFormValues`), so it is tested before it is enabled. A non-numeric number field stays a string so Zod reports it.
 */
export function toPayload(values: FormValues, mode: FormMode, alertChannelIds: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (key === "enabled") {
      setDeep(payload, key, value === "true");
    } else if (value === "") {
      if (mode === "edit" && CLEARABLE_KEYS.has(key)) setDeep(payload, key, null);
    } else if (NUMBER_KEYS.has(key)) {
      setDeep(payload, key, Number.isFinite(Number(value)) ? Number(value) : value);
    } else {
      setDeep(payload, key, SECRET_KEYS.has(key) ? raw : value);
    }
  }
  payload.alertChannelIds = alertChannelIds;
  return payload;
}

/** First message per field. Issues with no path go under `_form`. */
export function fieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length === 0 ? "_form" : issue.path.map(String).join(".");
    errors[key] ??= issue.message;
  }
  return errors;
}
```
- [ ] Step 2: Create `ui/src/lib/schemas.ts` (adjust the import path to the file found in Task 1):
```ts
// The one place the UI imports the Phase 2 Zod schemas. Task 1 confirms the file and export names.
export { targetCreateSchema, targetUpdateSchema } from "../../../src/shared/targets";
```
- [ ] Step 3: Create `test/ui/lib/form.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { TargetSummary } from "../../../ui/src/api/types";
import { emptyFormValues, fieldErrors, targetToFormValues, toPayload } from "../../../ui/src/lib/form";

const target: TargetSummary = {
  id: "t1",
  name: "shop",
  projectTag: null,
  connection: { host: "db.example.com", port: 5432, dbName: "shop", user: "backup" },
  hasRestoreUrl: true,
  hasTunnelToken: true,
  tunnelHostname: "pg.example.com",
  scheduleCron: "0 3 * * *",
  timezone: "UTC",
  enabled: true,
  retention: { keepLast: 3, daily: 7, weekly: null, monthly: 6, maxAgeDays: null },
  jobDeadlineMinutes: 90,
  staleAfterHours: null,
  alertFailureThreshold: 5,
  alertChannelIds: ["c1"],
  lastStatus: null,
  lastBackupAt: null,
  nextRunAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  stats: { backupCount: 0, totalBackupBytes: 0 },
};

describe("toPayload", () => {
  it("builds a nested create body with numbers and omits blanks", () => {
    const values = { ...emptyFormValues(), name: " shop ", connectionUrl: "postgres://u:p@h:5432/db", "tunnel.hostname": "pg.example.com", "tunnel.tokenId": "id", "tunnel.tokenSecret": "secret" };
    expect(toPayload(values, "create", ["c1"])).toEqual({
      name: "shop",
      connectionUrl: "postgres://u:p@h:5432/db",
      tunnel: { hostname: "pg.example.com", tokenId: "id", tokenSecret: "secret" },
      scheduleCron: "0 2 * * *",
      timezone: "Asia/Bangkok",
      retention: { keepLast: 3, daily: 7, weekly: 4, monthly: 6 },
      jobDeadlineMinutes: 120,
      alertFailureThreshold: 3,
      enabled: false,
      alertChannelIds: ["c1"],
    });
  });

  it("never sends blank secrets on edit, so the stored values are kept", () => {
    const body = toPayload(targetToFormValues(target), "edit", ["c1"]);
    expect(body).not.toHaveProperty("connectionUrl");
    expect(body).not.toHaveProperty("restoreUrl");
    expect(body.tunnel).toEqual({ hostname: "pg.example.com" });
  });

  it("sends null for cleared optional fields on edit", () => {
    const body = toPayload(targetToFormValues(target), "edit", []);
    expect(body.projectTag).toBeNull();
    expect(body.staleAfterHours).toBeNull();
    expect(body.retention).toEqual({ keepLast: 3, daily: 7, weekly: null, monthly: 6, maxAgeDays: null });
  });

  it("keeps the failure threshold from the stored target on edit", () => {
    expect(toPayload(targetToFormValues(target), "edit", []).alertFailureThreshold).toBe(5);
  });

  it("keeps a non-numeric number as text so validation can report it", () => {
    const body = toPayload({ ...emptyFormValues(), jobDeadlineMinutes: "abc" }, "create", []);
    expect(body.jobDeadlineMinutes).toBe("abc");
  });
});

describe("targetToFormValues", () => {
  it("starts a new target disabled, so it can be tested before it is enabled", () => {
    expect(emptyFormValues().enabled).toBe("false");
  });

  it("leaves every secret blank", () => {
    const values = targetToFormValues(target);
    expect([values.connectionUrl, values.restoreUrl, values["tunnel.tokenId"], values["tunnel.tokenSecret"]]).toEqual(["", "", "", ""]);
  });
});

describe("fieldErrors", () => {
  it("keeps the first message per dotted path and files pathless issues under _form", () => {
    const errors = fieldErrors([
      { path: ["tunnel", "hostname"], message: "Required" },
      { path: ["tunnel", "hostname"], message: "Second" },
      { path: [], message: "Tunnel mode needs a hostname" },
    ]);
    expect(errors).toEqual({ "tunnel.hostname": "Required", _form: "Tunnel mode needs a hostname" });
  });
});
```
- [ ] Step 4: Verify - Run: `bunx vitest run test/ui/lib/form.test.ts && bun run typecheck` - Expected: 8 pass, 0 fail; typecheck exits 0 (this also checks that `schemas.ts` resolves the real Phase 2 export names)
- [ ] Step 5: Commit - `git add ui/src/lib/form.ts ui/src/lib/schemas.ts test/ui/lib/form.test.ts && git commit -m "feat(ui): add target form payload and validation helpers"`

---

### Task 8: Restore gating and retention preview rows

**Files:**
- Create: `ui/src/lib/restore.ts`, `ui/src/lib/preview.ts`
- Test: `test/ui/lib/restore.test.ts`, `test/ui/lib/preview.test.ts`

**Interfaces:**
- Consumes: `Backup`, `RetentionPreview` (Task 3).
- Produces:
  - `interface RestoreConfirmState { typedName: string; destinationName: string; sameDatabase: boolean; acknowledged: boolean }`
  - `canSubmitRestore(state: RestoreConfirmState): boolean`
  - `restoreRequest(destinationTargetId: string, typedName: string, sameDatabase: boolean): { destinationTargetId: string; confirmName: string; acknowledgeOverwrite?: true }`
  - `interface PreviewRow { id: string; backup: Backup | undefined; reasons: string[] }`
  - `deletionRows(preview: RetentionPreview, loaded: readonly Backup[]): PreviewRow[]`

**Steps:**
- [ ] Step 1: Create `ui/src/lib/restore.ts`:
```ts
export interface RestoreConfirmState {
  typedName: string;
  destinationName: string;
  sameDatabase: boolean;
  acknowledged: boolean;
}

/** The typed name must equal the destination target name. Restoring into the source also needs the acknowledgement. */
export function canSubmitRestore(state: RestoreConfirmState): boolean {
  return state.destinationName !== "" && state.typedName === state.destinationName && (!state.sameDatabase || state.acknowledged);
}

/** `acknowledgeOverwrite: true` is required by the API when the destination is the source database (400 otherwise). */
export function restoreRequest(destinationTargetId: string, typedName: string, sameDatabase: boolean): { destinationTargetId: string; confirmName: string; acknowledgeOverwrite?: true } {
  return sameDatabase ? { destinationTargetId, confirmName: typedName, acknowledgeOverwrite: true } : { destinationTargetId, confirmName: typedName };
}
```
- [ ] Step 2: Create `ui/src/lib/preview.ts`:
```ts
import type { Backup, RetentionPreview } from "../api/types";

export interface PreviewRow {
  id: string;
  backup: Backup | undefined;
  reasons: string[];
}

/** Rows for the "would delete" list; `backup` is undefined when the row is not on a loaded page of history. */
export function deletionRows(preview: RetentionPreview, loaded: readonly Backup[]): PreviewRow[] {
  return preview.delete.map((id) => ({ id, backup: loaded.find((b) => b.id === id), reasons: preview.reasons[id] ?? [] }));
}
```
- [ ] Step 3: Create `test/ui/lib/restore.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { canSubmitRestore, restoreRequest } from "../../../ui/src/lib/restore";

const ok = { typedName: "shop", destinationName: "shop", sameDatabase: false, acknowledged: false };

describe("canSubmitRestore", () => {
  it("needs the exact destination name", () => {
    expect(canSubmitRestore(ok)).toBe(true);
    expect(canSubmitRestore({ ...ok, typedName: "Shop" })).toBe(false);
    expect(canSubmitRestore({ ...ok, typedName: "shop " })).toBe(false);
    expect(canSubmitRestore({ ...ok, typedName: "" })).toBe(false);
  });
  it("needs a destination", () => {
    expect(canSubmitRestore({ ...ok, destinationName: "", typedName: "" })).toBe(false);
  });
  it("also needs the acknowledgement when restoring into the source", () => {
    expect(canSubmitRestore({ ...ok, sameDatabase: true })).toBe(false);
    expect(canSubmitRestore({ ...ok, sameDatabase: true, acknowledged: true })).toBe(true);
  });
});

describe("restoreRequest", () => {
  it("sends the destination and the typed name", () => {
    expect(restoreRequest("t2", "shop", false)).toEqual({ destinationTargetId: "t2", confirmName: "shop" });
  });
  it("adds acknowledgeOverwrite only when restoring into the source database", () => {
    expect(restoreRequest("t1", "shop", true)).toEqual({ destinationTargetId: "t1", confirmName: "shop", acknowledgeOverwrite: true });
  });
});
```
- [ ] Step 4: Create `test/ui/lib/preview.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Backup } from "../../../ui/src/api/types";
import { deletionRows } from "../../../ui/src/lib/preview";

const backup = { id: "b1" } as Backup;

describe("deletionRows", () => {
  it("joins ids to loaded backups and reasons", () => {
    const rows = deletionRows({ keep: ["b3"], delete: ["b1", "b2"], reasons: { b3: ["keep_last"] } }, [backup]);
    expect(rows).toEqual([
      { id: "b1", backup, reasons: [] },
      { id: "b2", backup: undefined, reasons: [] },
    ]);
  });
});
```
- [ ] Step 5: Verify - Run: `bunx vitest run test/ui/lib/restore.test.ts test/ui/lib/preview.test.ts && bun run typecheck` - Expected: 6 pass (5 restore, 1 preview), 0 fail; typecheck exits 0
- [ ] Step 6: Commit - `git add ui/src/lib/restore.ts ui/src/lib/preview.ts test/ui/lib/restore.test.ts test/ui/lib/preview.test.ts && git commit -m "feat(ui): add restore confirmation gating and retention preview rows"`

---

### Task 9: Alert channel form logic

**Files:**
- Create: `ui/src/lib/channel.ts`
- Test: `test/ui/lib/channel.test.ts`

**Interfaces:**
- Consumes: `AlertChannel`, `ChannelEvent`, `ChannelType` (Task 3).
- Produces:
  - `CHANNEL_EVENTS: { value: ChannelEvent; label: string }[]`
  - `interface ChannelForm { type: ChannelType; name: string; enabled: boolean; events: ChannelEvent[]; replaceCredential: boolean; token: string; to: string; webhookUrl: string }`
  - `emptyChannelForm(): ChannelForm`, `channelToForm(channel: AlertChannel): ChannelForm`
  - `channelPayload(form: ChannelForm, mode: "create" | "edit"): { error: string } | { body: Record<string, unknown> }`

**Gotcha:** Discord webhook URLs must start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/` (owner round 2, answer 23); the API enforces it too, the UI check only gives an early message. The credential is sent only on create or when the user ticks "Replace the stored credential". Phase 8's PATCH is assumed to keep the stored credential when `credential` is omitted (Task 1 step 3 item 10).

**Steps:**
- [ ] Step 1: Create `ui/src/lib/channel.ts`:
```ts
import type { AlertChannel, ChannelEvent, ChannelType } from "../api/types";

export const CHANNEL_EVENTS: { value: ChannelEvent; label: string }[] = [
  { value: "backup_failed", label: "Backup failed" },
  { value: "backup_consecutive_failures", label: "Consecutive failures" },
  { value: "backup_stale", label: "No recent successful backup" },
];

export interface ChannelForm {
  type: ChannelType;
  name: string;
  enabled: boolean;
  events: ChannelEvent[];
  replaceCredential: boolean;
  token: string;
  to: string;
  webhookUrl: string;
}

export function emptyChannelForm(): ChannelForm {
  return { type: "discord", name: "", enabled: true, events: ["backup_failed", "backup_consecutive_failures", "backup_stale"], replaceCredential: true, token: "", to: "", webhookUrl: "" };
}

export function channelToForm(channel: AlertChannel): ChannelForm {
  return { ...emptyChannelForm(), type: channel.type, name: channel.name, enabled: channel.enabled, events: channel.events, replaceCredential: false };
}

const DISCORD_WEBHOOK_PREFIXES = ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/"];

/** Credentials are only sent when the user typed new ones. Returns an error message or the request body. */
export function channelPayload(form: ChannelForm, mode: "create" | "edit"): { error: string } | { body: Record<string, unknown> } {
  if (form.name.trim() === "") return { error: "Name is required" };
  if (form.events.length === 0) return { error: "Pick at least one event" };
  const body: Record<string, unknown> = { name: form.name.trim(), enabled: form.enabled, events: form.events };
  if (mode === "create") body.type = form.type;
  if (mode === "create" || form.replaceCredential) {
    if (form.type === "line") {
      if (form.token.trim() === "" || form.to.trim() === "") return { error: "LINE needs a channel access token and a recipient id" };
      body.credential = { token: form.token.trim(), to: form.to.trim() };
    } else {
      if (!DISCORD_WEBHOOK_PREFIXES.some((prefix) => form.webhookUrl.trim().startsWith(prefix))) return { error: "Discord webhook URL must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/" };
      body.credential = { webhookUrl: form.webhookUrl.trim() };
    }
  }
  return { body };
}
```
- [ ] Step 2: Create `test/ui/lib/channel.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { channelPayload, channelToForm, emptyChannelForm } from "../../../ui/src/lib/channel";

describe("channelPayload", () => {
  it("builds a discord create body", () => {
    const form = { ...emptyChannelForm(), name: "ops", webhookUrl: "https://discord.com/api/webhooks/1/x" };
    expect(channelPayload(form, "create")).toEqual({
      body: { name: "ops", enabled: true, events: ["backup_failed", "backup_consecutive_failures", "backup_stale"], type: "discord", credential: { webhookUrl: "https://discord.com/api/webhooks/1/x" } },
    });
  });

  it("builds a line create body", () => {
    const form = { ...emptyChannelForm(), type: "line" as const, name: "line", token: "tok", to: "U123" };
    const built = channelPayload(form, "create");
    expect("body" in built && built.body.credential).toEqual({ token: "tok", to: "U123" });
  });

  it("rejects missing or malformed input", () => {
    expect(channelPayload({ ...emptyChannelForm(), name: " " }, "create")).toEqual({ error: "Name is required" });
    expect(channelPayload({ ...emptyChannelForm(), name: "a", events: [] }, "create")).toEqual({ error: "Pick at least one event" });
    expect(channelPayload({ ...emptyChannelForm(), type: "line", name: "a", token: "t" }, "create")).toEqual({ error: "LINE needs a channel access token and a recipient id" });
  });

  it("accepts only the two Discord webhook hosts", () => {
    const error = "Discord webhook URL must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/";
    const build = (webhookUrl: string) => channelPayload({ ...emptyChannelForm(), name: "a", webhookUrl }, "create");
    expect(build("https://discordapp.com/api/webhooks/1/x")).toHaveProperty("body");
    for (const bad of ["http://discord.com/api/webhooks/1/x", "https://discord.example.com/api/webhooks/1/x", "https://discord.com.evil.test/api/webhooks/1/x", "https://discord.com/api/other"]) {
      expect(build(bad)).toEqual({ error });
    }
  });

  it("omits the credential on edit unless it is replaced", () => {
    const form = channelToForm({ id: "c1", type: "discord", name: "ops", events: ["backup_failed"], enabled: false, hasCredential: true });
    const built = channelPayload(form, "edit");
    expect(built).toEqual({ body: { name: "ops", enabled: false, events: ["backup_failed"] } });
  });
});
```
- [ ] Step 3: Verify - Run: `bunx vitest run test/ui/lib/channel.test.ts && bun run typecheck` - Expected: 5 pass, 0 fail; typecheck exits 0
- [ ] Step 4: Commit - `git add ui/src/lib/channel.ts test/ui/lib/channel.test.ts && git commit -m "feat(ui): add alert channel form payload logic"`

---

### Task 10: App shell - hooks, shared components, styles, router

**Files:**
- Create: `ui/src/api/hooks.ts`, `ui/src/components/ui.tsx`, `ui/src/components/Layout.tsx`, `ui/src/styles.css`
- Modify: `ui/src/main.tsx` (replace the Task 2 placeholder entirely)

**Interfaces:**
- Consumes: `TargetHealth` (Task 4), `JobStatus` (Task 3).
- Produces:
  - `useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], nextPollMs?: (data: T) => number | null): LoadState<T>` where `LoadState<T> = { data: T | undefined; error: Error | undefined; loading: boolean; reload: () => void }`
  - Components in `ui/src/components/ui.tsx`: `ErrorNote({ error })`, `Loading({ loading, hasData })`, `HealthBadge({ health })`, `StatusBadge({ status })`, `SecretBadge({ isSet })`, `Dialog({ open, title, onClose, children })`, `Field({ label, error?, hint?, children })`
  - `Layout()` (top bar plus `<Outlet />`), CSS classes used by every page, and the router in `ui/src/main.tsx` with an empty `children` array that Tasks 11-17 fill.

**Gotcha:**
- `Dialog` uses the native `<dialog>` element (`showModal`), which gives focus trapping and Escape for free. Its children render only while `open`, so form state resets on every open.
- The `useLoad` effect depends on `deps` and an internal version counter; callers pass stable primitives (an id), never fresh objects.
- The mobile table layout is CSS only: tables with class `stack` turn into cards at 640 px and read cell labels from `data-label`.
- `eslint-disable` comment in `hooks.ts` is harmless if the repo has no ESLint; keep it.

**Steps:**
- [ ] Step 1: Create `ui/src/api/hooks.ts`:
```ts
import { useCallback, useEffect, useState } from "react";

export interface LoadState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/** Loads on mount and whenever `deps` change. `nextPollMs` returns a delay to poll again, or null to stop. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], nextPollMs?: (data: T) => number | null): LoadState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const next = await load();
        if (cancelled) return;
        setData(next);
        setError(undefined);
        const delay = nextPollMs?.(next) ?? null;
        if (delay !== null) timer = setTimeout(run, delay);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { data, error, loading, reload };
}
```
- [ ] Step 2: Create `ui/src/components/ui.tsx`:
```tsx
import { useEffect, useRef, type ReactNode } from "react";
import type { TargetHealth } from "../lib/status";
import type { JobStatus } from "../api/types";

export function ErrorNote({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return (
    <p className="note note-error" role="alert">
      {error.message}
    </p>
  );
}

export function Loading({ loading, hasData }: { loading: boolean; hasData: boolean }) {
  return loading && !hasData ? <p className="muted">Loading...</p> : null;
}

const HEALTH_LABEL: Record<TargetHealth, string> = { failing: "Failing", stale: "Stale", ok: "Healthy", never: "No backup yet", disabled: "Disabled" };
const HEALTH_TONE: Record<TargetHealth, string> = { failing: "red", stale: "red", ok: "green", never: "grey", disabled: "grey" };

export function HealthBadge({ health }: { health: TargetHealth }) {
  return <span className={`badge badge-${HEALTH_TONE[health]}`}>{HEALTH_LABEL[health]}</span>;
}

const STATUS_TONE: Record<JobStatus, string> = { queued: "grey", running: "blue", success: "green", failed: "red", timed_out: "red" };

export function StatusBadge({ status }: { status: JobStatus | null }) {
  if (!status) return <span className="muted">-</span>;
  return <span className={`badge badge-${STATUS_TONE[status]}`}>{status.replace("_", " ")}</span>;
}

export function SecretBadge({ isSet }: { isSet: boolean }) {
  return <span className={`badge ${isSet ? "badge-green" : "badge-grey"}`}>{isSet ? "set" : "not set"}</span>;
}

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      {open ? (
        <div className="dialog-body">
          <h2>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
```
- [ ] Step 3: Create `ui/src/components/Layout.tsx`:
```tsx
import { NavLink, Outlet } from "react-router";

export function Layout() {
  return (
    <>
      <header className="topbar">
        <NavLink to="/" className="brand">
          Cellar
        </NavLink>
        <nav aria-label="Main">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/targets">Targets</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
```
- [ ] Step 4: Create `ui/src/styles.css`:
```css
:root {
  --bg: #f6f7f9;
  --surface: #fff;
  --text: #1c2430;
  --muted: #5d6b7c;
  --border: #d9dfe7;
  --accent: #1f5fd1;
  --red: #b42318;
  --red-bg: #fdecea;
  --green: #11713b;
  --green-bg: #e3f5ea;
  --blue: #1d4ed8;
  --blue-bg: #e4ecfd;
  --grey-bg: #eceff3;
  --amber: #8a5a00;
  --amber-bg: #fff4d6;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--text);
  background: var(--bg);
}
* { box-sizing: border-box; }
body { margin: 0; font-size: 15px; line-height: 1.45; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; }
a { color: var(--accent); }
.mono, code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
.muted, .hint { color: var(--muted); }
.hint { font-size: 0.85rem; }
.block { display: block; font-size: 0.85rem; }
.num { text-align: right; }

.topbar { display: flex; align-items: center; gap: 1.5rem; padding: 0.75rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.topbar .brand { font-weight: 700; font-size: 1.1rem; text-decoration: none; color: var(--text); }
.topbar nav { display: flex; gap: 1rem; }
.topbar nav a { text-decoration: none; color: var(--muted); padding: 0.25rem 0; border-bottom: 2px solid transparent; }
.topbar nav a.active { color: var(--text); border-bottom-color: var(--accent); }
.page { max-width: 1100px; margin: 0 auto; padding: 1.25rem 1rem 4rem; }
.page-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; }
.page-head h2 { margin-top: 2rem; }

button, .button { font: inherit; padding: 0.4rem 0.85rem; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; text-decoration: none; display: inline-block; min-height: 2.25rem; }
button:hover:not(:disabled), .button:hover { background: var(--grey-bg); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.primary:hover:not(:disabled) { background: #194fae; }
button.danger { background: var(--red); border-color: var(--red); color: #fff; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin-top: 1rem; }

.badge { display: inline-block; padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
.badge-red { background: var(--red-bg); color: var(--red); }
.badge-green { background: var(--green-bg); color: var(--green); }
.badge-blue { background: var(--blue-bg); color: var(--blue); }
.badge-grey { background: var(--grey-bg); color: var(--muted); }
.tag { display: inline-block; margin-left: 0.5rem; padding: 0 0.45rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8rem; font-weight: 400; color: var(--muted); }

.note { padding: 0.6rem 0.85rem; border-radius: 6px; margin: 0.75rem 0; background: var(--grey-bg); }
.note-error { background: var(--red-bg); color: var(--red); }
.note-ok { background: var(--green-bg); color: var(--green); }
.note-ok-text { color: var(--green); }
.note-warn { background: var(--amber-bg); color: var(--amber); }

.summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.25rem; }
.summary > div { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1rem; }
.summary strong { display: block; font-size: 1.4rem; }
.summary span { color: var(--muted); font-size: 0.85rem; }
.summary .summary-red { border-color: var(--red); background: var(--red-bg); }

table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); background: #fafbfc; }
tr:last-child td { border-bottom: 0; }
th.num { text-align: right; }
tr.row-red td { background: var(--red-bg); }
.row-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
pre { margin: 0.5rem 0 0; white-space: pre-wrap; word-break: break-word; }

.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1.25rem; margin: 1rem 0; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }

.form { max-width: 640px; }
fieldset { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); margin: 0 0 1rem; padding: 0.75rem 1rem 1rem; min-width: 0; }
legend { padding: 0 0.4rem; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.75rem; }
.field-label { font-weight: 600; font-size: 0.9rem; }
.field-error { color: var(--red); font-size: 0.85rem; }
.secret-state { margin-bottom: 0.1rem; }
input:not([type="checkbox"]), select { font: inherit; padding: 0.45rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: #fff; width: 100%; min-height: 2.25rem; }
input[aria-invalid="true"] { border-color: var(--red); }
.check { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.6rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0 1rem; }
.test-connection { margin-top: 1rem; }

dialog { border: 1px solid var(--border); border-radius: 10px; padding: 0; width: min(560px, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); }
dialog::backdrop { background: rgb(15 23 42 / 0.45); }
.dialog-body { padding: 1rem 1.25rem 1.25rem; }
.dialog-body h2 { margin-top: 0; }

@media (max-width: 640px) {
  .page { padding: 1rem 0.75rem 3rem; }
  .summary { grid-template-columns: 1fr 1fr; }
  .summary > div:last-child { grid-column: 1 / -1; }
  table.stack, table.stack thead, table.stack tbody, table.stack tr, table.stack td { display: block; }
  table.stack thead { position: absolute; left: -9999px; }
  table.stack { background: transparent; border: 0; }
  table.stack tr { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem; padding: 0.25rem 0; }
  table.stack td { border: 0; padding: 0.3rem 0.85rem; display: block; text-align: right; overflow-wrap: anywhere; }
  table.stack td[data-label]::before { content: attr(data-label); float: left; margin-right: 0.75rem; color: var(--muted); font-size: 0.8rem; text-transform: uppercase; }
  table.stack td::after { content: ""; display: block; clear: both; }
  table.stack tr.row-red { background: var(--red-bg); }
  table.stack tr.row-red td { background: transparent; }
  .facts { grid-template-columns: 1fr; gap: 0; }
  .facts dd { margin-bottom: 0.6rem; }
  table.stack td.row-actions { display: flex; justify-content: flex-end; }
}
```
- [ ] Step 5: Replace `ui/src/main.tsx` with:
```tsx
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import "./styles.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(<RouterProvider router={router} />);
```
- [ ] Step 6: Verify - Run: `bun run typecheck && bun run build:ui && grep -c 'table.stack\|\.badge' dist/ui/assets/*.css` - Expected: typecheck exits 0; Vite prints `built in`; grep prints a count of 1 or more per CSS file (the stylesheet is in the bundle)
- [ ] Step 7: Commit - `git add ui && git commit -m "feat(ui): add app shell, shared components, hooks, and styles"`

---

### Task 11: Dashboard and targets list pages

**Files:**
- Create: `ui/src/pages/Dashboard.tsx`, `ui/src/pages/Targets.tsx`
- Modify: `ui/src/main.tsx` (anchor: `children: [],`)

**Interfaces:**
- Consumes: `listAll` (Task 6), `useLoad`, `ErrorNote`, `Loading`, `HealthBadge`, `StatusBadge` (Task 10), `classifyTarget`, `isRedHealth` (Task 4), `formatInTimeZone`, `formatRelative` (Task 3), `formatBytes`, `connectionLabel` (Task 5), `TargetSummary` (Task 3). Endpoint: `GET /api/targets` returning `{ items: TargetSummary[], nextCursor: string | null }`.
- Produces: `Dashboard()` at `/` (summary cards, red rows for failing or stale, last success in the target's zone, next run, R2 size, 30 s refresh) and `Targets()` at `/targets`.

**Steps:**
- [ ] Step 1: Create `ui/src/pages/Dashboard.tsx`:
```tsx
import { Link } from "react-router";
import { listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { TargetSummary } from "../api/types";
import { ErrorNote, HealthBadge, Loading, StatusBadge } from "../components/ui";
import { formatBytes } from "../lib/display";
import { classifyTarget, isRedHealth } from "../lib/status";
import { formatInTimeZone, formatRelative } from "../lib/time";

export function Dashboard() {
  const targets = useLoad(() => listAll<TargetSummary>("/api/targets"), [], () => 30_000);
  const now = new Date();
  const rows = (targets.data ?? []).map((target) => ({ target, health: classifyTarget(target, now) }));
  rows.sort((a, b) => Number(isRedHealth(b.health)) - Number(isRedHealth(a.health)) || a.target.name.localeCompare(b.target.name));
  const problems = rows.filter((r) => isRedHealth(r.health)).length;
  const totalBytes = rows.reduce((sum, r) => sum + r.target.stats.totalBackupBytes, 0);

  return (
    <>
      <h1>Dashboard</h1>
      <ErrorNote error={targets.error} />
      <Loading loading={targets.loading} hasData={targets.data !== undefined} />
      {targets.data ? (
        <>
          <section className="summary" aria-label="Summary">
            <div>
              <strong>{rows.length}</strong>
              <span>targets</span>
            </div>
            <div className={problems > 0 ? "summary-red" : ""}>
              <strong>{problems}</strong>
              <span>failing or stale</span>
            </div>
            <div>
              <strong>{formatBytes(totalBytes)}</strong>
              <span>in R2</span>
            </div>
          </section>
          {rows.length === 0 ? (
            <p className="muted">
              No targets yet. <Link to="/targets/new">Add the first one</Link>.
            </p>
          ) : (
            <table className="stack">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Health</th>
                  <th>Last status</th>
                  <th>Last success</th>
                  <th>Next run</th>
                  <th className="num">R2 size</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ target, health }) => (
                  <tr key={target.id} className={isRedHealth(health) ? "row-red" : ""}>
                    <td data-label="Target">
                      <Link to={`/targets/${target.id}`}>{target.name}</Link>
                      {target.projectTag ? <span className="tag">{target.projectTag}</span> : null}
                    </td>
                    <td data-label="Health">
                      <HealthBadge health={health} />
                    </td>
                    <td data-label="Last status">
                      <StatusBadge status={target.lastStatus} />
                    </td>
                    <td data-label="Last success">
                      {formatInTimeZone(target.lastBackupAt, target.timezone)}
                      <span className="muted block">{formatRelative(target.lastBackupAt, now)}</span>
                    </td>
                    <td data-label="Next run">{target.enabled ? formatInTimeZone(target.nextRunAt, target.timezone) : "-"}</td>
                    <td data-label="R2 size" className="num">
                      {formatBytes(target.stats.totalBackupBytes)}
                      <span className="muted block">{target.stats.backupCount} backups</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </>
  );
}
```
- [ ] Step 2: Create `ui/src/pages/Targets.tsx`:
```tsx
import { Link } from "react-router";
import { listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { TargetSummary } from "../api/types";
import { ErrorNote, Loading } from "../components/ui";
import { connectionLabel } from "../lib/display";

export function Targets() {
  const targets = useLoad(() => listAll<TargetSummary>("/api/targets"), []);
  return (
    <>
      <div className="page-head">
        <h1>Targets</h1>
        <Link className="button" to="/targets/new">
          New target
        </Link>
      </div>
      <ErrorNote error={targets.error} />
      <Loading loading={targets.loading} hasData={targets.data !== undefined} />
      {targets.data ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Name</th>
              <th>Database</th>
              <th>Schedule</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {targets.data.map((target) => (
              <tr key={target.id}>
                <td data-label="Name">
                  <Link to={`/targets/${target.id}`}>{target.name}</Link>
                  {target.projectTag ? <span className="tag">{target.projectTag}</span> : null}
                </td>
                <td data-label="Database" className="mono">
                  {connectionLabel(target.connection)}
                </td>
                <td data-label="Schedule" className="mono">
                  {target.scheduleCron} <span className="muted">{target.timezone}</span>
                </td>
                <td data-label="Enabled">{target.enabled ? "yes" : "no"}</td>
                <td>
                  <Link to={`/targets/${target.id}/edit`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
```
- [ ] Step 3: Edit `ui/src/main.tsx`: add `import { Dashboard } from "./pages/Dashboard";` and `import { Targets } from "./pages/Targets";` above the `./styles.css` import, and replace `children: [],` with:
  ```tsx
  children: [
    { path: "/", element: <Dashboard /> },
    { path: "/targets", element: <Targets /> },
  ],
  ```
- [ ] Step 4: Verify - Run: `bun run typecheck && bun run build:ui` - Expected: typecheck exits 0; Vite prints `built in` (the pages are checked in a real browser in End-to-end verification)
- [ ] Step 5: Commit - `git add ui && git commit -m "feat(ui): add dashboard and targets list pages"`

---

### Task 12: Target create and edit form with Test connection

**Files:**
- Create: `ui/src/components/TestConnection.tsx`, `ui/src/pages/TargetForm.tsx`
- Modify: `ui/src/main.tsx` (anchor: `{ path: "/targets", element: <Targets /> },`)

**Interfaces:**
- Consumes: `api`, `listAll` (Task 6), `pollUntil` (Task 6), `useLoad`, `ErrorNote`, `Field`, `Loading`, `SecretBadge` (Task 10), `emptyFormValues`, `fieldErrors`, `targetToFormValues`, `toPayload`, `FormValues` (Task 7), `targetCreateSchema`, `targetUpdateSchema` (Task 7), `isTerminalStatus` (Task 4), `ConnectionTest`, `AlertChannel`, `TargetSummary` (Task 3). Endpoints: `GET /api/targets/:id`, `GET /api/alert-channels`, `POST /api/targets`, `PATCH /api/targets/:id`, `POST /api/targets/:id/test` (202 `{ testId }`), `GET /api/targets/:id/test/:testId`.
- Produces: `TestConnection({ targetId })` (button, polls every 1.5 s up to 80 times, shows result or error), `TargetForm()` for `/targets/new` and `/targets/:id/edit` (inline validation after blur or submit, write-only secrets with set / not set badge, required tunnel fields, failure threshold, alert channel checkboxes). A new target is saved disabled and the form says so (owner round 2, answer 24).

**Gotcha:**
- Validation runs the real Phase 2 Zod schema on the built payload on every render, and errors show only for fields the user touched (or after a submit attempt). Pathless issues show under the form title.
- Server errors (409 duplicate name, 400 `validation_error`) show in a `role="alert"` note via the thrown `ApiError.message`.
- Test connection works on saved targets only (owner round 2, answer 24). Create saves the target with `enabled: false`; the detail page then offers Test connection and an Enable button. The edit page keeps the Enabled checkbox and Test connection.

**Steps:**
- [ ] Step 1: Create `ui/src/components/TestConnection.tsx`:
```tsx
import { useState } from "react";
import { api } from "../api/client";
import { pollUntil } from "../api/poll";
import type { ConnectionTest } from "../api/types";
import { isTerminalStatus } from "../lib/status";
import { ErrorNote } from "./ui";

export function TestConnection({ targetId }: { targetId: string }) {
  const [test, setTest] = useState<ConnectionTest | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(undefined);
    setTest(undefined);
    try {
      const { testId } = await api<{ testId: string }>("POST", `/api/targets/${targetId}/test`);
      await pollUntil(() => api<ConnectionTest>("GET", `/api/targets/${targetId}/test/${testId}`), (t) => isTerminalStatus(t.status), {
        intervalMs: 1500,
        maxAttempts: 80,
        onUpdate: setTest,
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="test-connection">
      <button type="button" onClick={run} disabled={busy}>
        {busy ? "Testing..." : "Test connection"}
      </button>
      <span className="hint">Tests the saved settings.</span>
      <ErrorNote error={error} />
      {test ? (
        <p className={`note ${test.status === "success" ? "note-ok" : test.status === "failed" || test.status === "timed_out" ? "note-error" : ""}`} role="status">
          {test.status === "success"
            ? `Connected. PostgreSQL ${test.result?.pgServerVersion ?? "unknown"}. ${test.result?.hasReadAllData ? "Role can read all data." : "Role lacks pg_read_all_data."}`
            : test.status === "failed" || test.status === "timed_out"
              ? `Test ${test.status.replace("_", " ")}: ${test.error?.message ?? "no details"}`
              : `Test ${test.status}...`}
        </p>
      ) : null}
    </div>
  );
}
```
- [ ] Step 2: Create `ui/src/pages/TargetForm.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { AlertChannel, TargetSummary } from "../api/types";
import { TestConnection } from "../components/TestConnection";
import { ErrorNote, Field, Loading, SecretBadge } from "../components/ui";
import { emptyFormValues, fieldErrors, targetToFormValues, toPayload, type FormValues } from "../lib/form";
import { targetCreateSchema, targetUpdateSchema } from "../lib/schemas";

export function TargetForm() {
  const { id } = useParams();
  const mode = id ? "edit" : "create";
  const target = useLoad(async () => (id ? api<TargetSummary>("GET", `/api/targets/${id}`) : undefined), [id]);
  const channels = useLoad(() => listAll<AlertChannel>("/api/alert-channels"), []);
  if (target.error) return <ErrorNote error={target.error} />;
  if (target.loading || channels.loading) return <Loading loading hasData={false} />;
  return <TargetFormBody mode={mode} target={target.data} channels={channels.data ?? []} />;
}

function TargetFormBody({ mode, target, channels }: { mode: "create" | "edit"; target: TargetSummary | undefined; channels: AlertChannel[] }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(() => (target ? targetToFormValues(target) : emptyFormValues()));
  const [channelIds, setChannelIds] = useState<string[]>(target?.alertChannelIds ?? []);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<Error | undefined>();

  const payload = toPayload(values, mode, channelIds);
  const parsed = (mode === "create" ? targetCreateSchema : targetUpdateSchema).safeParse(payload);
  const errors = parsed.success ? {} : fieldErrors(parsed.error.issues);
  const shown = (key: string) => (submitted || touched.has(key) ? errors[key] : undefined);

  const set = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));
  const input = (key: string, props: { type?: string; placeholder?: string; inputMode?: "numeric"; list?: string } = {}) => (
    <input
      list={props.list}
      value={values[key] ?? ""}
      type={props.type ?? "text"}
      inputMode={props.inputMode}
      placeholder={props.placeholder}
      autoComplete="off"
      aria-invalid={shown(key) ? true : undefined}
      onChange={(e) => set(key, e.target.value)}
      onBlur={() => setTouched((prev) => new Set(prev).add(key))}
    />
  );
  const secretInput = (key: string, isSet: boolean, label: string) => (
    <Field label={label} error={shown(key)} hint={mode === "edit" ? "Write-only. Leave blank to keep the stored value." : undefined}>
      <span className="secret-state">
        <SecretBadge isSet={isSet} />
      </span>
      {input(key, { type: "password" })}
    </Field>
  );
  const number = (key: string, label: string, hint?: string) => (
    <Field label={label} error={shown(key)} {...(hint ? { hint } : {})}>
      {input(key, { inputMode: "numeric" })}
    </Field>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!parsed.success) return;
    setSaving(true);
    setServerError(undefined);
    try {
      const saved = mode === "create" ? await api<TargetSummary>("POST", "/api/targets", payload) : await api<TargetSummary>("PATCH", `/api/targets/${target?.id}`, payload);
      navigate(`/targets/${saved.id}`);
    } catch (e) {
      setServerError(e instanceof Error ? e : new Error(String(e)));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="form">
      <h1>{mode === "create" ? "New target" : `Edit ${target?.name ?? ""}`}</h1>
      <ErrorNote error={serverError} />
      {errors._form && submitted ? <p className="note note-error">{errors._form}</p> : null}

      <fieldset>
        <legend>General</legend>
        <Field label="Name" error={shown("name")}>
          {input("name")}
        </Field>
        <Field label="Project tag" error={shown("projectTag")} hint="Optional. Shown on the dashboard and in alerts.">
          {input("projectTag")}
        </Field>
        {mode === "edit" ? (
          <label className="check">
            <input type="checkbox" checked={values.enabled === "true"} onChange={(e) => set("enabled", String(e.target.checked))} />
            Enabled (scheduled backups run)
          </label>
        ) : (
          <p className="note">
            A new target is saved disabled. After saving: 1. Test connection. 2. Enable the target. Nothing runs on a schedule until you enable it.
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>Connection</legend>
        {mode === "edit" && target ? (
          <p className="hint">
            Current: <span className="mono">{target.connection.user}@{target.connection.host}:{target.connection.port}/{target.connection.dbName}</span>
          </p>
        ) : null}
        {secretInput("connectionUrl", target !== undefined, "Connection URL (backup role)")}
        {secretInput("restoreUrl", target?.hasRestoreUrl ?? false, "Restore connection URL (optional)")}
        <Field label="Tunnel hostname" error={shown("tunnel.hostname")}>
          {input("tunnel.hostname", { placeholder: "db.example.com" })}
        </Field>
        {secretInput("tunnel.tokenId", target?.hasTunnelToken ?? false, "Service token client id")}
        {secretInput("tunnel.tokenSecret", target?.hasTunnelToken ?? false, "Service token client secret")}
        {mode === "edit" && target ? <TestConnection targetId={target.id} /> : <p className="hint">Test connection runs on the saved target. Save it first (it stays disabled), then test it on its page.</p>}
      </fieldset>

      <fieldset>
        <legend>Schedule</legend>
        <Field label="Cron (5 fields)" error={shown("scheduleCron")}>
          {input("scheduleCron")}
        </Field>
        <Field label="Time zone" error={shown("timezone")}>
          <>
            {input("timezone", { list: "timezones" })}
            <datalist id="timezones">
              {Intl.supportedValuesOf("timeZone").map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </>
        </Field>
      </fieldset>

      <fieldset>
        <legend>Retention</legend>
        <div className="grid">
          {number("retention.keepLast", "Keep last")}
          {number("retention.daily", "Daily")}
          {number("retention.weekly", "Weekly")}
          {number("retention.monthly", "Monthly")}
          {number("retention.maxAgeDays", "Max age (days)", "Blank = off")}
        </div>
      </fieldset>

      <fieldset>
        <legend>Advanced</legend>
        <div className="grid">
          {number("jobDeadlineMinutes", "Job deadline (min)")}
          {number("staleAfterHours", "Stale after (hours)", "Blank = schedule interval + 2 h")}
          {number("alertFailureThreshold", "Alert after N consecutive failures")}
        </div>
      </fieldset>

      <fieldset>
        <legend>Alert channels</legend>
        {channels.length === 0 ? (
          <p className="muted">
            No channels yet. Add one in <Link to="/settings">Settings</Link>. A target with no channel gets no alerts.
          </p>
        ) : (
          channels.map((channel) => (
            <label className="check" key={channel.id}>
              <input
                type="checkbox"
                checked={channelIds.includes(channel.id)}
                onChange={(e) => setChannelIds((prev) => (e.target.checked ? [...prev, channel.id] : prev.filter((x) => x !== channel.id)))}
              />
              {channel.name} <span className="muted">({channel.type})</span>
            </label>
          ))
        )}
      </fieldset>

      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving..." : mode === "create" ? "Create target" : "Save changes"}
        </button>
        <Link className="button" to={target ? `/targets/${target.id}` : "/targets"}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
```
- [ ] Step 3: Edit `ui/src/main.tsx`: add `import { TargetForm } from "./pages/TargetForm";` and add these two routes after the `/targets` route (the `new` route must stay before any `/targets/:id` route added later):
  ```tsx
  { path: "/targets/new", element: <TargetForm /> },
  { path: "/targets/:id/edit", element: <TargetForm /> },
  ```
- [ ] Step 4: Verify - Run: `bun run typecheck && bun run build:ui` - Expected: typecheck exits 0; Vite prints `built in`
- [ ] Step 5: Commit - `git add ui && git commit -m "feat(ui): add target create and edit form with test connection"`

---

### Task 13: Restore dialog

**Files:**
- Create: `ui/src/components/RestoreDialog.tsx`

**Interfaces:**
- Consumes: `api` (Task 6), `pollUntil` (Task 6), `Dialog`, `ErrorNote`, `Field` (Task 10), `canSubmitRestore`, `restoreRequest` (Task 8), `isTerminalStatus` (Task 4), `Backup`, `RestoreRun`, `TargetSummary` (Task 3). Endpoints: `POST /api/backups/:id/restore` with `{ destinationTargetId, confirmName, acknowledgeOverwrite? }` (202 `{ restoreId, sameDatabase }`), `GET /api/restores/:id`.
- Produces: `RestoreDialog({ backup, targets, onClose }: { backup: Backup | undefined; targets: TargetSummary[]; onClose: () => void })` - open when `backup` is set.

**Gotcha:**
- There is no default destination: the select starts empty. Targets without a restore URL are listed but disabled with "(no restore URL)" (the API also rejects them with 400).
- The destination database is the one inside the destination target's restore URL, which the API never reveals, so the dialog does not show a database name. It says so in the intro text.
- "Same database" is `destination.id === backup.targetId`, computed client-side. The API also returns `sameDatabase` but the warning must show before submit.
- The request body carries `acknowledgeOverwrite: true` only when the destination is the source database (the API answers 400 otherwise). It answers 409 when the destination has an active backup or restore; the dialog shows that message in its error note.
- The dialog never submits in this phase's verification (destructive; Phase 7 owns its local end-to-end).

**Steps:**
- [ ] Step 1: Create `ui/src/components/RestoreDialog.tsx`:
```tsx
import { useState } from "react";
import { api } from "../api/client";
import { pollUntil } from "../api/poll";
import type { Backup, RestoreRun, TargetSummary } from "../api/types";
import { canSubmitRestore, restoreRequest } from "../lib/restore";
import { isTerminalStatus } from "../lib/status";
import { Dialog, ErrorNote, Field } from "./ui";

export function RestoreDialog({ backup, targets, onClose }: { backup: Backup | undefined; targets: TargetSummary[]; onClose: () => void }) {
  return (
    <Dialog open={backup !== undefined} title="Restore backup" onClose={onClose}>
      {backup ? <RestoreForm backup={backup} targets={targets} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RestoreForm({ backup, targets, onClose }: { backup: Backup; targets: TargetSummary[]; onClose: () => void }) {
  const [destinationId, setDestinationId] = useState("");
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [run, setRun] = useState<RestoreRun | undefined>();

  const destination = targets.find((t) => t.id === destinationId);
  const sameDatabase = destination !== undefined && destination.id === backup.targetId;
  const ready = canSubmitRestore({ typedName, destinationName: destination?.name ?? "", sameDatabase, acknowledged });

  async function submit() {
    if (!destination) return;
    setBusy(true);
    setError(undefined);
    try {
      const { restoreId } = await api<{ restoreId: string }>("POST", `/api/backups/${backup.id}/restore`, restoreRequest(destination.id, typedName, sameDatabase));
      await pollUntil(() => api<RestoreRun>("GET", `/api/restores/${restoreId}`), (r) => isTerminalStatus(r.status), {
        intervalMs: 2000,
        maxAttempts: 900,
        onUpdate: setRun,
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p>
        Restores run <code>pg_restore</code> into the database stored as the destination target&apos;s restore URL. Nothing is created. Existing objects can be overwritten.
      </p>
      <Field label="Destination target">
        <select value={destinationId} disabled={busy} onChange={(e) => setDestinationId(e.target.value)}>
          <option value="">Select a destination</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.hasRestoreUrl}>
              {t.name}
              {t.hasRestoreUrl ? "" : " (no restore URL)"}
            </option>
          ))}
        </select>
      </Field>
      {sameDatabase ? (
        <div className="note note-error" role="alert">
          <strong>This restores into the source database.</strong> Current data in the database can be overwritten and lost.
          <label className="check">
            <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />I understand this overwrites the source database
          </label>
        </div>
      ) : null}
      {destination ? (
        <Field label={`Type "${destination.name}" to confirm`}>
          <input value={typedName} disabled={busy} autoComplete="off" onChange={(e) => setTypedName(e.target.value)} />
        </Field>
      ) : null}
      <ErrorNote error={error} />
      {run ? (
        <p className={`note ${run.status === "success" ? "note-ok" : isTerminalStatus(run.status) ? "note-error" : ""}`} role="status">
          Restore {run.status.replace("_", " ")}
          {run.errorMessage ? `: ${run.errorMessage}` : ""}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="danger" disabled={!ready || busy}>
          {busy ? "Restoring..." : "Restore"}
        </button>
        <button type="button" onClick={onClose}>
          {run && isTerminalStatus(run.status) ? "Close" : "Cancel"}
        </button>
      </div>
    </form>
  );
}
```
- [ ] Step 2: Verify - Run: `bun run typecheck && bun run build:ui` - Expected: typecheck exits 0; Vite prints `built in`
- [ ] Step 3: Commit - `git add ui/src/components/RestoreDialog.tsx && git commit -m "feat(ui): add restore dialog with typed-name and overwrite confirmation"`

---

### Task 14: Target detail page

**Files:**
- Create: `ui/src/pages/TargetDetail.tsx`
- Modify: `ui/src/main.tsx` (anchor: `{ path: "/targets/:id/edit", element: <TargetForm /> },`)

**Interfaces:**
- Consumes: `api`, `listAll`, `withQuery` (Task 6), `useLoad` (Task 10), `ErrorNote`, `HealthBadge`, `Loading`, `SecretBadge`, `StatusBadge` (Task 10), `RestoreDialog` (Task 13), `TestConnection` (Task 12), `connectionLabel`, `formatBytes`, `formatDuration` (Task 5), `deletionRows` (Task 8), `classifyTarget`, `isActiveStatus` (Task 4), `formatInTimeZone` (Task 3), `Backup`, `Page`, `RetentionPreview`, `TargetSummary` (Task 3). Endpoints: `GET /api/targets/:id`, `PATCH /api/targets/:id` (`{ enabled: true }`), `GET /api/targets/:id/backups?limit&cursor`, `POST /api/targets/:id/backup`, `POST /api/backups/:id/download-url`, `GET /api/targets/:id/retention-preview`.
- Produces: `TargetDetail()` at `/targets/:id`: facts (masked), Backup now, Edit link, Test connection, an "Enable target" callout while the target is disabled (the second step of the create flow: save disabled, test, enable), retention preview (on demand, "No changes were made."), backup history (25 per page, Load more, refreshes every 5 s while any row is queued or running), Download and Restore buttons on success rows, failed rows in red.

**Gotcha:**
- Download navigates with `window.location.assign(url)`. The presigned URL expires in at most 15 minutes, so it is fetched on click and never stored.
- Route order: `/targets/new` (Task 12) is registered before `/targets/:id`, so `new` is not read as an id.
- Backup now surfaces a 409 (already queued or running) as an error note. It does not disable the button, because the server owns that rule.

**Steps:**
- [ ] Step 1: Create `ui/src/pages/TargetDetail.tsx`:
```tsx
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, listAll, withQuery } from "../api/client";
import { useLoad } from "../api/hooks";
import type { Backup, Page, RetentionPreview, TargetSummary } from "../api/types";
import { RestoreDialog } from "../components/RestoreDialog";
import { TestConnection } from "../components/TestConnection";
import { ErrorNote, HealthBadge, Loading, SecretBadge, StatusBadge } from "../components/ui";
import { connectionLabel, formatBytes, formatDuration } from "../lib/display";
import { deletionRows } from "../lib/preview";
import { classifyTarget, isActiveStatus } from "../lib/status";
import { formatInTimeZone } from "../lib/time";

export function TargetDetail() {
  const { id = "" } = useParams();
  const target = useLoad(() => api<TargetSummary>("GET", `/api/targets/${id}`), [id]);
  if (target.error) return <ErrorNote error={target.error} />;
  if (!target.data) return <Loading loading hasData={false} />;
  return <TargetView target={target.data} onChanged={target.reload} />;
}

function TargetView({ target, onChanged }: { target: TargetSummary; onChanged: () => void }) {
  const tz = target.timezone;
  const first = useLoad(() => api<Page<Backup>>("GET", withQuery(`/api/targets/${target.id}/backups`, { limit: 25 })), [target.id], (page) =>
    page.items.some((b) => isActiveStatus(b.status)) ? 5000 : null,
  );
  const [more, setMore] = useState<Backup[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [loadError, setLoadError] = useState<Error | undefined>();
  const [actionError, setActionError] = useState<Error | undefined>();
  const [restoreFrom, setRestoreFrom] = useState<Backup | undefined>();
  const [preview, setPreview] = useState<RetentionPreview | undefined>();
  const allTargets = useLoad(() => listAll<TargetSummary>("/api/targets"), []);

  const backups = [...(first.data?.items ?? []), ...more];
  const nextCursor = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;
  const health = classifyTarget(target, new Date());
  const fail = (e: unknown) => setActionError(e instanceof Error ? e : new Error(String(e)));

  async function backupNow() {
    setActionError(undefined);
    try {
      await api("POST", `/api/targets/${target.id}/backup`);
      setMore([]);
      setCursor(undefined);
      first.reload();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api<Page<Backup>>("GET", withQuery(`/api/targets/${target.id}/backups`, { limit: 25, cursor: nextCursor }));
      setMore((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setLoadError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async function download(backup: Backup) {
    setActionError(undefined);
    try {
      const { url } = await api<{ url: string; expiresAt: string }>("POST", `/api/backups/${backup.id}/download-url`);
      window.location.assign(url);
    } catch (e) {
      fail(e);
    }
  }

  async function enable() {
    setActionError(undefined);
    try {
      await api("PATCH", `/api/targets/${target.id}`, { enabled: true });
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  async function showPreview() {
    setActionError(undefined);
    try {
      setPreview(await api<RetentionPreview>("GET", `/api/targets/${target.id}/retention-preview`));
    } catch (e) {
      fail(e);
    }
  }

  const rows = preview ? deletionRows(preview, backups) : [];
  return (
    <>
      <div className="page-head">
        <h1>
          {target.name} {target.projectTag ? <span className="tag">{target.projectTag}</span> : null}
        </h1>
        <div className="actions">
          <button type="button" className="primary" onClick={backupNow}>
            Backup now
          </button>
          <Link className="button" to={`/targets/${target.id}/edit`}>
            Edit
          </Link>
        </div>
      </div>
      <ErrorNote error={actionError} />
      {target.enabled ? null : (
        <div className="note">
          <p>This target is disabled. No scheduled backups run. Run Test connection below, then enable it.</p>
          <button type="button" className="primary" onClick={enable}>
            Enable target
          </button>
        </div>
      )}

      <dl className="facts">
        <dt>Health</dt>
        <dd>
          <HealthBadge health={health} />
        </dd>
        <dt>Database</dt>
        <dd className="mono">{connectionLabel(target.connection)}</dd>
        <dt>Tunnel</dt>
        <dd className="mono">{target.tunnelHostname}</dd>
        <dt>Schedule</dt>
        <dd className="mono">
          {target.scheduleCron} <span className="muted">{tz}</span>
        </dd>
        <dt>Next run</dt>
        <dd>{target.enabled ? formatInTimeZone(target.nextRunAt, tz) : "disabled"}</dd>
        <dt>Last success</dt>
        <dd>{formatInTimeZone(target.lastBackupAt, tz)}</dd>
        <dt>Restore URL</dt>
        <dd>
          <SecretBadge isSet={target.hasRestoreUrl} />
        </dd>
        <dt>Tunnel token</dt>
        <dd>
          <SecretBadge isSet={target.hasTunnelToken} />
        </dd>
      </dl>
      <TestConnection targetId={target.id} />

      <h2>Retention</h2>
      <p>
        <button type="button" onClick={showPreview}>
          Preview what would be deleted
        </button>
      </p>
      {preview ? (
        <>
          <p>
            Keeps {preview.keep.length}, would delete {preview.delete.length}. No changes were made.
          </p>
          {rows.length > 0 ? (
            <table className="stack">
              <thead>
                <tr>
                  <th>Backup</th>
                  <th>Started</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Backup" className="mono">
                      {row.id.slice(0, 8)}
                    </td>
                    <td data-label="Started">{row.backup ? formatInTimeZone(row.backup.startedAt ?? row.backup.queuedAt, tz) : "not on a loaded page"}</td>
                    <td data-label="Reasons">{row.reasons.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}

      <h2>Backups</h2>
      <ErrorNote error={first.error ?? loadError} />
      <Loading loading={first.loading} hasData={first.data !== undefined} />
      {first.data && backups.length === 0 ? <p className="muted">No backups yet.</p> : null}
      {backups.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Trigger</th>
              <th className="num">Size</th>
              <th>Duration</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr key={backup.id} className={backup.status === "failed" || backup.status === "timed_out" ? "row-red" : ""}>
                <td data-label="Started">{formatInTimeZone(backup.startedAt ?? backup.queuedAt, tz)}</td>
                <td data-label="Status">
                  <StatusBadge status={backup.status} />
                </td>
                <td data-label="Trigger">{backup.trigger}</td>
                <td data-label="Size" className="num">
                  {formatBytes(backup.sizeBytes)}
                </td>
                <td data-label="Duration">{formatDuration(backup.durationMs)}</td>
                <td data-label="Error">{backup.errorMessage ?? "-"}</td>
                <td className="row-actions">
                  {backup.status === "success" ? (
                    <>
                      <button type="button" onClick={() => download(backup)}>
                        Download
                      </button>
                      <button type="button" onClick={() => setRestoreFrom(backup)}>
                        Restore
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {nextCursor ? (
        <p>
          <button type="button" onClick={loadMore}>
            Load more
          </button>
        </p>
      ) : null}

      <RestoreDialog backup={restoreFrom} targets={allTargets.data ?? []} onClose={() => setRestoreFrom(undefined)} />
    </>
  );
}
```
- [ ] Step 2: Edit `ui/src/main.tsx`: add `import { TargetDetail } from "./pages/TargetDetail";` and add after the `edit` route: `{ path: "/targets/:id", element: <TargetDetail /> },`
- [ ] Step 3: Verify - Run: `bun run typecheck && bun run build:ui` - Expected: typecheck exits 0; Vite prints `built in`
- [ ] Step 4: Commit - `git add ui && git commit -m "feat(ui): add target detail page with history, download, restore, and retention preview"`

---

### Task 15: Settings page with global settings

**Files:**
- Create: `ui/src/components/GlobalSettings.tsx`, `ui/src/pages/Settings.tsx`
- Modify: `ui/src/main.tsx` (anchor: `{ path: "/targets/:id", element: <TargetDetail /> },`)

**Interfaces:**
- Consumes: `api` (Task 6), `useLoad`, `ErrorNote`, `Field` (Task 10), `Settings` (Task 3). Endpoints: `GET /api/settings`, `PUT /api/settings` with `{ max_concurrent_jobs: number, retention_dry_run: boolean }`.
- Produces: `GlobalSettings()` (concurrency input, dry-run toggle with a warning when dry run is off, Save) and `Settings()` at `/settings` (initially only `GlobalSettings`; Tasks 16 and 17 add the other two sections).

**Steps:**
- [ ] Step 1: Create `ui/src/components/GlobalSettings.tsx`:
```tsx
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useLoad } from "../api/hooks";
import type { Settings } from "../api/types";
import { ErrorNote, Field } from "./ui";

export function GlobalSettings() {
  const settings = useLoad(() => api<Settings>("GET", "/api/settings"), []);
  const [concurrency, setConcurrency] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    if (settings.data) {
      setConcurrency(String(settings.data.max_concurrent_jobs));
      setDryRun(settings.data.retention_dry_run);
    }
  }, [settings.data]);

  const parsed = Number(concurrency);
  const valid = Number.isInteger(parsed) && parsed >= 1;

  async function save() {
    setError(undefined);
    setSaved(false);
    try {
      await api<Settings>("PUT", "/api/settings", { max_concurrent_jobs: parsed, retention_dry_run: dryRun });
      setSaved(true);
      settings.reload();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <section aria-labelledby="global-heading">
      <h2 id="global-heading">Global</h2>
      <ErrorNote error={settings.error ?? error} />
      <Field label="Max concurrent jobs" error={concurrency !== "" && !valid ? "Enter a whole number, 1 or more" : undefined}>
        <input value={concurrency} inputMode="numeric" onChange={(e) => setConcurrency(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        Retention dry run (log what would be deleted, delete nothing)
      </label>
      {!dryRun ? <p className="note note-warn">Retention will delete expired backups from R2. The newest successful backup of each target is always kept.</p> : null}
      <div className="actions">
        <button type="button" className="primary" disabled={!valid || !settings.data} onClick={save}>
          Save
        </button>
        {saved ? <span className="note-ok-text">Saved</span> : null}
      </div>
    </section>
  );
}
```
- [ ] Step 2: Create `ui/src/pages/Settings.tsx` (only the global section for now):
  ```tsx
  import { GlobalSettings } from "../components/GlobalSettings";

  export function Settings() {
    return (
      <>
        <h1>Settings</h1>
        <GlobalSettings />
      </>
    );
  }
  ```
- [ ] Step 3: Edit `ui/src/main.tsx`: add `import { Settings } from "./pages/Settings";` and add after the `/targets/:id` route: `{ path: "/settings", element: <Settings /> },`
- [ ] Step 4: Verify - Run: `bun run typecheck && bun run build:ui` - Expected: typecheck exits 0; Vite prints `built in`
- [ ] Step 5: Commit - `git add ui && git commit -m "feat(ui): add settings page with concurrency and retention dry-run"`

---

### Task 16: Alert channels section

**Files:**
- Create: `ui/src/components/ChannelsSection.tsx`
- Modify: `ui/src/pages/Settings.tsx` (anchor: `<GlobalSettings />`)

**Interfaces:**
- Consumes: `api`, `listAll` (Task 6), `useLoad`, `Dialog`, `ErrorNote`, `Field`, `SecretBadge` (Task 10), `CHANNEL_EVENTS`, `channelPayload`, `channelToForm`, `emptyChannelForm`, `ChannelForm` (Task 9), `AlertChannel` (Task 3). Endpoints: `GET/POST /api/alert-channels`, `PATCH/DELETE /api/alert-channels/:id`, `POST /api/alert-channels/:id/test` returning `{ ok: boolean, error?: string }`.
- Produces: `ChannelsSection()`: list with name, type, credential set / not set, enabled; Add, Edit, Delete (browser `confirm`), Test (inline result text); credentials are write-only (edit shows a "Replace the stored credential" checkbox before any credential input appears; credential inputs are `type="password"`).

**Steps:**
- [ ] Step 1: Create `ui/src/components/ChannelsSection.tsx`:
```tsx
import { useState } from "react";
import { api, listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { AlertChannel } from "../api/types";
import { CHANNEL_EVENTS, channelPayload, channelToForm, emptyChannelForm, type ChannelForm } from "../lib/channel";
import { Dialog, ErrorNote, Field, SecretBadge } from "./ui";

export function ChannelsSection() {
  const channels = useLoad(() => listAll<AlertChannel>("/api/alert-channels"), []);
  const [editing, setEditing] = useState<{ id: string | null; form: ChannelForm } | undefined>();
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error | undefined>();
  const fail = (e: unknown) => setError(e instanceof Error ? e : new Error(String(e)));

  async function test(channel: AlertChannel) {
    setTestResult((prev) => ({ ...prev, [channel.id]: "Sending..." }));
    try {
      const result = await api<{ ok: boolean; error?: string }>("POST", `/api/alert-channels/${channel.id}/test`);
      setTestResult((prev) => ({ ...prev, [channel.id]: result.ok ? "Sent" : `Failed: ${result.error ?? "no details"}` }));
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [channel.id]: `Failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  }

  async function remove(channel: AlertChannel) {
    if (!window.confirm(`Delete alert channel "${channel.name}"?`)) return;
    try {
      await api("DELETE", `/api/alert-channels/${channel.id}`);
      channels.reload();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <section aria-labelledby="channels-heading">
      <div className="page-head">
        <h2 id="channels-heading">Alert channels</h2>
        <button type="button" onClick={() => setEditing({ id: null, form: emptyChannelForm() })}>
          Add channel
        </button>
      </div>
      <ErrorNote error={channels.error ?? error} />
      {channels.data?.length === 0 ? <p className="muted">No channels. Targets with no linked channel get no alerts.</p> : null}
      {channels.data && channels.data.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Credential</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {channels.data.map((channel) => (
              <tr key={channel.id}>
                <td data-label="Name">{channel.name}</td>
                <td data-label="Type">{channel.type}</td>
                <td data-label="Credential">
                  <SecretBadge isSet={channel.hasCredential} />
                </td>
                <td data-label="Enabled">{channel.enabled ? "yes" : "no"}</td>
                <td className="row-actions">
                  <button type="button" onClick={() => test(channel)}>
                    Test
                  </button>
                  <button type="button" onClick={() => setEditing({ id: channel.id, form: channelToForm(channel) })}>
                    Edit
                  </button>
                  <button type="button" onClick={() => remove(channel)}>
                    Delete
                  </button>
                  {testResult[channel.id] ? <span className="hint" role="status">{testResult[channel.id]}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <Dialog open={editing !== undefined} title={editing?.id ? "Edit channel" : "Add channel"} onClose={() => setEditing(undefined)}>
        {editing ? (
          <ChannelFormView
            initial={editing.form}
            id={editing.id}
            onClose={() => setEditing(undefined)}
            onSaved={() => {
              setEditing(undefined);
              channels.reload();
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}

function ChannelFormView({ initial, id, onClose, onSaved }: { initial: ChannelForm; id: string | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<Error | undefined>();
  const mode = id ? "edit" : "create";
  const patch = (change: Partial<ChannelForm>) => setForm((prev) => ({ ...prev, ...change }));

  async function save() {
    const built = channelPayload(form, mode);
    if ("error" in built) return setError(new Error(built.error));
    try {
      await (id ? api("PATCH", `/api/alert-channels/${id}`, built.body) : api("POST", "/api/alert-channels", built.body));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ErrorNote error={error} />
      <Field label="Type">
        <select value={form.type} disabled={mode === "edit"} onChange={(e) => patch({ type: e.target.value === "line" ? "line" : "discord" })}>
          <option value="discord">Discord webhook</option>
          <option value="line">LINE push</option>
        </select>
      </Field>
      <Field label="Name">
        <input value={form.name} onChange={(e) => patch({ name: e.target.value })} />
      </Field>
      {mode === "edit" ? (
        <label className="check">
          <input type="checkbox" checked={form.replaceCredential} onChange={(e) => patch({ replaceCredential: e.target.checked })} />
          Replace the stored credential (write-only)
        </label>
      ) : null}
      {form.replaceCredential && form.type === "line" ? (
        <>
          <Field label="Channel access token">
            <input type="password" autoComplete="off" value={form.token} onChange={(e) => patch({ token: e.target.value })} />
          </Field>
          <Field label="Recipient id (to)">
            <input autoComplete="off" value={form.to} onChange={(e) => patch({ to: e.target.value })} />
          </Field>
        </>
      ) : null}
      {form.replaceCredential && form.type === "discord" ? (
        <Field label="Webhook URL">
          <input type="password" autoComplete="off" value={form.webhookUrl} onChange={(e) => patch({ webhookUrl: e.target.value })} />
        </Field>
      ) : null}
      <fieldset>
        <legend>Events</legend>
        {CHANNEL_EVENTS.map((event) => (
          <label className="check" key={event.value}>
            <input
              type="checkbox"
              checked={form.events.includes(event.value)}
              onChange={(e) => patch({ events: e.target.checked ? [...form.events, event.value] : form.events.filter((x) => x !== event.value) })}
            />
            {event.label}
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Enabled
      </label>
      <div className="actions">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```
- [ ] Step 2: Edit `ui/src/pages/Settings.tsx`: add `import { ChannelsSection } from "../components/ChannelsSection";` and add `<ChannelsSection />` after `<GlobalSettings />`.
- [ ] Step 3: Verify - Run: `bun run typecheck && bun run build:ui` - Expected: typecheck exits 0; Vite prints `built in`
- [ ] Step 4: Commit - `git add ui && git commit -m "feat(ui): add alert channels management with test"`

---

### Task 17: Audit log viewer

**Files:**
- Create: `ui/src/components/AuditLog.tsx`
- Modify: `ui/src/pages/Settings.tsx` (anchor: `<ChannelsSection />`)

**Interfaces:**
- Consumes: `api`, `listAll`, `withQuery` (Task 6), `useLoad` (Task 10), `ErrorNote`, `Field` (Task 10), `formatInTimeZone`, `timeZoneForAudit` (Task 3), `AuditEntry`, `Page`, `TargetSummary` (Task 3). Endpoints: `GET /api/audit-logs?entityType&limit&cursor`, `GET /api/targets`.
- Produces: `AuditLog()`: entity-type filter (free text, blank = all), table (When, Actor, Action, Entity, Details in a collapsed `<details>`), Load more. Times use `timeZoneForAudit`.

**Gotcha:** Changing the filter clears the extra pages and re-fetches from the first page. `details` is already redacted by the API (`writeAudit` passes it through `redactSecrets`, register X10); the UI shows it as plain text and never parses it.

**Steps:**
- [ ] Step 1: Create `ui/src/components/AuditLog.tsx`:
```tsx
import { useState } from "react";
import { api, listAll, withQuery } from "../api/client";
import { useLoad } from "../api/hooks";
import type { AuditEntry, Page, TargetSummary } from "../api/types";
import { formatInTimeZone, timeZoneForAudit } from "../lib/time";
import { ErrorNote, Field } from "./ui";

export function AuditLog() {
  const [entityType, setEntityType] = useState("");
  const first = useLoad(() => api<Page<AuditEntry>>("GET", withQuery("/api/audit-logs", { limit: 50, entityType })), [entityType]);
  const targets = useLoad(() => listAll<TargetSummary>("/api/targets"), []);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [error, setError] = useState<Error | undefined>();

  const entries = [...(first.data?.items ?? []), ...more];
  const nextCursor = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api<Page<AuditEntry>>("GET", withQuery("/api/audit-logs", { limit: 50, entityType, cursor: nextCursor }));
      setMore((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <section aria-labelledby="audit-heading">
      <h2 id="audit-heading">Audit log</h2>
      <Field label="Entity type" hint="Blank = all. Example: target, backup, restore.">
        <input
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value.trim());
            setMore([]);
            setCursor(undefined);
          }}
        />
      </Field>
      <ErrorNote error={first.error ?? error} />
      {first.data && entries.length === 0 ? <p className="muted">No entries.</p> : null}
      {entries.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td data-label="When">{formatInTimeZone(entry.at, timeZoneForAudit(entry.entityType, entry.entityId, targets.data ?? []))}</td>
                <td data-label="Actor">{entry.actor}</td>
                <td data-label="Action" className="mono">
                  {entry.action}
                </td>
                <td data-label="Entity" className="mono">
                  {entry.entityType}
                  {entry.entityId ? ` ${entry.entityId.slice(0, 8)}` : ""}
                </td>
                <td data-label="Details">{entry.details ? <details><summary>Show</summary><pre>{entry.details}</pre></details> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {nextCursor ? (
        <p>
          <button type="button" onClick={loadMore}>
            Load more
          </button>
        </p>
      ) : null}
    </section>
  );
}
```
- [ ] Step 2: Edit `ui/src/pages/Settings.tsx`: add `import { AuditLog } from "../components/AuditLog";` and add `<AuditLog />` after `<ChannelsSection />`. The final file is:
```tsx
import { AuditLog } from "../components/AuditLog";
import { ChannelsSection } from "../components/ChannelsSection";
import { GlobalSettings } from "../components/GlobalSettings";

export function Settings() {
  return (
    <>
      <h1>Settings</h1>
      <GlobalSettings />
      <ChannelsSection />
      <AuditLog />
    </>
  );
}
```
- [ ] Step 3: Verify - Run: `bun run test && bun run typecheck && bun run build:ui` - Expected: all tests pass (the new `test/ui/` files add 64 tests: time 11, status 11, display 13, client 6, poll 4, form 8, restore 5, preview 1, channel 5; total = recorded baseline + 64); typecheck exits 0; Vite prints `built in`
- [ ] Step 4: Commit - `git add ui && git commit -m "feat(ui): add audit log viewer"`

---

### Task 18: Update docs/PLAN.md and phase summary

**Files:**
- Modify: `docs/PLAN.md` (anchors: `## 2. Repo structure`, `ui/                          Vite + React SPA`, `## 11. Phases (unchanged)`)

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/PLAN.md` that matches the code.

**Steps:**
- [ ] Step 1: In `docs/PLAN.md` section 2 (repo structure), change the `ui/` line and add the new folders. Replace the line starting `  ui/ ` with:
  ```
    ui/                          Vite + React SPA: index.html, vite.config.ts, tsconfig.json, src/{api,lib,components,pages} (built into dist/ui, served as Static Assets)
    scripts/  dev.ts             starts wrangler dev (8787) and the Vite dev server (5173, proxies /api and /internal)
  ```
  and change the `test/` line's note to say it also contains `test/ui/` for the UI's pure modules.
- [ ] Step 2: In section 2 "Notes", add: `- Dev: bun run dev serves the UI at http://localhost:5173 and the API through the Vite proxy; bun run dev:api and bun run dev:ui run them separately; bun run build:ui builds dist/ui; wrangler.jsonc has an assets block with run_worker_first for /api/* and /internal/*.`
- [ ] Step 3: In the status line at the top, change the sentence about phases to say Phase 9 is built. In section 11, change the heading `## 11. Phases (unchanged)` to `## 11. Phases` and mark item 9 `(done)`.
- [ ] Step 4: Verify - Run: `grep -c 'run_worker_first' docs/PLAN.md && grep -c 'bun run dev' docs/PLAN.md` - Expected: each prints 1 or more
- [ ] Step 5: Commit - `git add docs/PLAN.md && git commit -m "docs: update PLAN.md for the React UI"`
- [ ] Step 6: Run the full gate and write the phase summary (AGENTS.md format) as the last message:
  - `bun run test && bun run typecheck` - Expected: both exit 0.
  - Summary sections: `✅ Completed` (pages, dev flow, assets), `🧪 Tests and results` (counts, the browser walkthrough result with screenshot paths in `/tmp/cellar-e2e/shots`), `⚠️ Open issues and decisions needed` (the open ASK above with its outcome, every Deviation recorded, and any End-to-end item left awaiting a human). Also list the root edits this phase made: `package.json`, `bun.lock`, `wrangler.jsonc` (assets block), and `scripts/dev.ts`. This phase adds no shared code under `src/shared/`.

---

## Failure handling summary

- **Task 1 finds a missing endpoint or field** - Detect: a MISSING line, or a field absent from a response (not merely renamed). Respond: STOP, report the endpoint or field, the phase that should have built it, and what the page needs it for. Do not add API code and do not work around it in the UI.
- **A renamed field or schema export** - Detect: Task 1 step 3 or a typecheck error in Task 7 or Task 12. Respond: change only `ui/src/api/types.ts`, `ui/src/lib/form.ts`, `ui/src/lib/channel.ts`, `ui/src/lib/restore.ts`, or `ui/src/lib/schemas.ts`; update the matching tests; record a `> Deviation:` line.
- **`wrangler dev` fails to start in `bun run dev`** - Detect: the dev script exits within seconds with a wrangler error. Respond: read the error. A missing Docker daemon or image build failure comes from Phase 5's containers block: STOP and report, do not edit that block. A missing `dist/ui` means the script's `mkdirSync` line was lost.
- **A browser check shows a layout defect** - Respond: fix it in `ui/src/styles.css` or the page, rebuild, re-run the same check. Do not tick a Verify on a judgement call.

## End-to-end verification

Run after Task 17 (the Task 18 docs edit does not change behavior). All browser checks drive a real Chromium through `playwright-core` from `/tmp/cellar-e2e` (outside the repo). The script and the seed script below were written for this plan and were NOT run against a real backend. A mocked-API version of the same pages (all five routes, 375 px and 1440 px) ran in scratch with zero page errors and zero horizontal overflow.

- [ ] Step 1: Start the stack in the background from the repo root: `bun run dev` (log to `/tmp/cellar-e2e/dev.log`). Wait until both `curl -sf http://localhost:5173/api/health` and `curl -sf http://localhost:8787/api/health` succeed - Expected: both print the health JSON.
- [ ] Step 2: Create `/tmp/cellar-e2e/seed.ts` and run it from the repo root with `bun /tmp/cellar-e2e/seed.ts`. It creates three targets through the API (fake `example.com` values) and seeds local D1 only (`--local`) with three states and four backups. It prints `<OK> <FAILING> <STALE>`. Keep those ids.
```ts
const API = "http://localhost:8787";
const q = (id: string) => `'${id}'`;
const ago = (modifier: string) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','${modifier}')`;

async function create(name: string, timezone: string): Promise<string> {
  const response = await fetch(`${API}/api/targets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name,
      connectionUrl: "postgres://backup:e2e-pw-secret@db.example.com:5432/app",
      restoreUrl: "postgres://restore:e2e-pw-secret@db.example.com:5432/app",
      tunnel: { hostname: "pg.example.com", tokenId: "e2e-token-id", tokenSecret: "e2e-token-secret" },
      scheduleCron: "0 2 * * *",
      timezone,
      jobDeadlineMinutes: 120,
      enabled: true,
      alertChannelIds: [],
    }),
  });
  if (response.status !== 201) throw new Error(`${name}: HTTP ${response.status} ${await response.text()}`);
  return ((await response.json()) as { id: string }).id;
}

const ok = await create("e2e-ok", "Asia/Bangkok");
const failing = await create("e2e-failing", "Asia/Bangkok");
const stale = await create("e2e-stale", "UTC");

const sql = `
UPDATE targets SET last_status='success', last_backup_at=${ago("-3 hours")} WHERE id=${q(ok)};
UPDATE targets SET last_status='failed', last_backup_at=${ago("-30 hours")} WHERE id=${q(failing)};
UPDATE targets SET last_status='success', last_backup_at=${ago("-3 days")} WHERE id=${q(stale)};
INSERT INTO backups (id, target_id, status, "trigger", r2_key, size_bytes, sha256, duration_ms, error_message, queued_at, started_at, finished_at) VALUES
 ('e2e-b1', ${q(ok)}, 'success', 'schedule', 'backups/${ok}/e2e-1.dump', 500000000, 'e2e', 90000, NULL, ${ago("-3 hours")}, ${ago("-3 hours")}, ${ago("-3 hours")}),
 ('e2e-b2', ${q(ok)}, 'failed', 'schedule', 'backups/${ok}/e2e-2.dump', NULL, NULL, 12000, 'dump failed (seeded)', ${ago("-27 hours")}, ${ago("-27 hours")}, ${ago("-27 hours")}),
 ('e2e-b3', ${q(ok)}, 'success', 'manual', 'backups/${ok}/e2e-3.dump', 700000000, 'e2e', 120000, NULL, ${ago("-51 hours")}, ${ago("-51 hours")}, ${ago("-51 hours")}),
 ('e2e-b4', ${q(stale)}, 'success', 'schedule', 'backups/${stale}/e2e-4.dump', 300000000, 'e2e', 60000, NULL, ${ago("-3 days")}, ${ago("-3 days")}, ${ago("-3 days")});
`;
await Bun.write("/tmp/cellar-e2e/seed.sql", sql);
await Bun.$`bunx wrangler d1 execute cellar --local --file /tmp/cellar-e2e/seed.sql`;
console.log(`${ok} ${failing} ${stale}`);
```
  Expected: the last line is three UUIDs separated by spaces; `curl -s localhost:8787/api/targets` lists `e2e-ok`, `e2e-failing`, `e2e-stale` and contains none of `e2e-pw-secret`, `e2e-token-secret`.
- [ ] Step 3: Create `/tmp/cellar-e2e/e2e.mjs` and run `cd /tmp/cellar-e2e && node e2e.mjs <OK> <FAILING> <STALE>`. It checks, at 1440 px and at 375 px, every route for horizontal overflow, secret text, and script errors; the dashboard red rows, zones, and R2 size; download, the restore dialog gating (disabled until the destination is chosen and the typed name matches, the same-database warning and acknowledgement), retention preview, Backup now, Test connection; then once on desktop the create form's inline validation, create (saved disabled, then Enable), edit keeps secrets, the settings toggle, a channel create, test, and delete, and the audit rows. It saves full-page screenshots to `/tmp/cellar-e2e/shots/`.
```js
import { chromium } from "playwright-core";
import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const BASE = "http://localhost:5173";
const SECRETS = ["e2e-pw-secret", "e2e-token-secret", "e2e-webhook-secret"];
const [okId, failId, staleId] = process.argv.slice(2);
if (!okId || !failId || !staleId) throw new Error("usage: node e2e.mjs <okId> <failingId> <staleId>");

const chromeRoot = `${homedir()}/Library/Caches/ms-playwright`;
const dir = readdirSync(chromeRoot).filter((d) => d.startsWith("chromium-")).sort().pop();
const arch = `${chromeRoot}/${dir}/${readdirSync(`${chromeRoot}/${dir}`).find((d) => d.startsWith("chrome-"))}`;
const app = readdirSync(arch).find((f) => f.endsWith(".app"));
const browser = await chromium.launch({ executablePath: `${arch}/${app}/Contents/MacOS/${app.replace(".app", "")}` });
mkdirSync("shots", { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failures++;
};

for (const [width, height] of [[1440, 900], [375, 800]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = (name) => `${name}@${width}`;

  // Every route: no horizontal overflow, no secret text, no script errors.
  for (const [path, name] of [["/", "dashboard"], ["/targets", "targets"], ["/targets/new", "new"], [`/targets/${okId}`, "detail"], [`/targets/${okId}/edit`, "edit"], ["/settings", "settings"]]) {
    await page.goto(`${BASE}${path}`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const html = await page.content();
    check(tag(`${name}: no horizontal overflow`), overflow <= 0, `overflow=${overflow}px`);
    check(tag(`${name}: no secrets in the page`), SECRETS.every((s) => !html.includes(s)));
    await page.screenshot({ path: `shots/${name}-${width}.png`, fullPage: true });
  }

  // Dashboard: failing and stale rows are red, healthy is not, sizes shown, zones applied.
  await page.goto(BASE);
  await page.waitForSelector("tbody tr, table.stack tr");
  const rows = await page.$$eval("tr.row-red", (els) => els.map((e) => e.textContent ?? ""));
  check(tag("dashboard: failing and stale targets are red"), rows.some((t) => t.includes("e2e-failing")) && rows.some((t) => t.includes("e2e-stale")), JSON.stringify(rows));
  check(tag("dashboard: healthy target is not red"), !rows.some((t) => t.includes("e2e-ok")));
  const text = await page.innerText("main");
  check(tag("dashboard: Bangkok target shows GMT+7"), text.includes("GMT+7"));
  check(tag("dashboard: total R2 size shown"), /GiB|MiB/.test(text));

  // Target detail: history, download, restore gate, retention preview.
  await page.goto(`${BASE}/targets/${okId}`);
  await page.waitForSelector("text=Backups");
  const download = page.waitForResponse((r) => r.url().includes("/download-url") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Download" }).first().click({ noWaitAfter: true });
  check(tag("detail: download-url request succeeds"), (await download).status() === 200);
  await page.goto(`${BASE}/targets/${okId}`);
  await page.getByRole("button", { name: "Restore" }).first().click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: "Restore", exact: true });
  check(tag("restore: disabled before choosing a destination"), await submit.isDisabled());
  await dialog.getByLabel("Destination target").selectOption({ label: "e2e-failing" });
  await dialog.getByLabel(/Type "e2e-failing"/).fill("e2e-fail");
  check(tag("restore: disabled while the typed name is partial"), await submit.isDisabled());
  await dialog.getByLabel(/Type "e2e-failing"/).fill("e2e-failing");
  check(tag("restore: enabled when the typed name matches"), await submit.isEnabled());
  await dialog.getByLabel("Destination target").selectOption({ label: "e2e-ok" });
  await dialog.getByLabel(/Type "e2e-ok"/).fill("e2e-ok");
  check(tag("restore: same database shows the overwrite warning"), await dialog.getByText("This restores into the source database.").isVisible());
  check(tag("restore: same database stays disabled until acknowledged"), await submit.isDisabled());
  await dialog.getByLabel("I understand this overwrites the source database").check();
  check(tag("restore: same database enabled after acknowledgement"), await submit.isEnabled());
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Preview what would be deleted" }).click();
  check(tag("detail: retention preview says no changes were made"), await page.getByText("No changes were made.").isVisible());

  // Backup now: 202 queued or 409 already active, both surface in the UI without a script error.
  const backup = page.waitForResponse((r) => r.url().endsWith(`/targets/${okId}/backup`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Backup now" }).click();
  check(tag("detail: Backup now answers 202 or 409"), [202, 409].includes((await backup).status()));

  // Test connection: the request is made and a status line appears.
  const test = page.waitForResponse((r) => r.url().endsWith(`/targets/${okId}/test`) && r.request().method() === "POST");
  await page.getByRole("button", { name: "Test connection" }).click();
  check(tag("detail: Test connection answers 202"), (await test).status() === 202);
  await page.getByRole("status").filter({ hasText: /Test|Connected/ }).first().waitFor({ timeout: 10000 });
  check(tag("detail: test status line appears"), true);

  check(tag("no script errors"), errors.length === 0, errors.join(" | "));
  await page.close();
}

// Form flow (once, desktop): inline validation, create, edit keeps secrets.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/targets/new`);
await page.getByLabel("Name").fill("e2e-new");
await page.getByLabel("Connection URL (backup role)").fill("nope");
await page.getByLabel("Connection URL (backup role)").blur();
check("form: bad URL shows an inline error", (await page.locator(".field-error").count()) > 0);
await page.getByLabel("Cron (5 fields)").fill("61 * * * *");
await page.getByLabel("Cron (5 fields)").blur();
check("form: bad cron shows an inline error", (await page.locator(".field-error").count()) > 1);
await page.getByLabel("Connection URL (backup role)").fill("postgres://backup:e2e-pw-secret@db.example.com:5432/app");
await page.getByLabel("Cron (5 fields)").fill("0 3 * * *");
await page.getByLabel("Tunnel hostname").fill("pg.example.com");
await page.getByLabel("Service token client id").fill("e2e-token-id");
await page.getByLabel("Service token client secret").fill("e2e-token-secret");
check("form: no Enabled checkbox on create, flow note shown", (await page.getByLabel(/^Enabled/).count()) === 0 && (await page.getByText("A new target is saved disabled").isVisible()));
check("form: failure threshold defaults to 3", (await page.getByLabel("Alert after N consecutive failures").inputValue()) === "3");
await page.getByRole("button", { name: "Create target" }).click();
await page.waitForURL(/\/targets\/[0-9a-f-]{36}$/);
const newId = page.url().split("/").pop();
check("create: new target is saved disabled with an Enable callout", (await (await page.request.get(`${BASE}/api/targets/${newId}`)).json()).enabled === false && (await page.getByRole("button", { name: "Enable target" }).isVisible()));
await page.getByRole("button", { name: "Enable target" }).click();
await page.getByRole("button", { name: "Enable target" }).waitFor({ state: "detached" });
check("create: Enable target enables it", (await (await page.request.get(`${BASE}/api/targets/${newId}`)).json()).enabled === true);
const apiBody = await (await page.request.get(`${BASE}/api/targets/${newId}`)).text();
check("create: API response has no secret", SECRETS.every((s) => !apiBody.includes(s)));
await page.goto(`${BASE}/targets/${newId}/edit`);
check("edit: secret inputs are blank", (await page.getByLabel("Connection URL (backup role)").inputValue()) === "");
check("edit: secrets are labelled set", (await page.locator(".badge-green", { hasText: "set" }).count()) >= 2);
await page.getByLabel("Name").fill("e2e-new-renamed");
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForURL(/\/targets\/[0-9a-f-]{36}$/);
await page.getByRole("heading", { name: /e2e-new-renamed/ }).waitFor();
check("edit: rename saved", true);

// Settings: dry-run toggle persists, channel create/test/delete, secrets never shown, audit rows.
await page.goto(`${BASE}/settings`);
const before = (await (await page.request.get(`${BASE}/api/settings`)).json()).retention_dry_run;
await page.getByLabel(/Retention dry run/).setChecked(!before);
await page.getByRole("button", { name: "Save", exact: true }).first().click();
await page.getByText("Saved").waitFor();
check("settings: dry-run toggle persisted", (await (await page.request.get(`${BASE}/api/settings`)).json()).retention_dry_run === !before);
await page.getByLabel(/Retention dry run/).setChecked(before);
await page.getByRole("button", { name: "Save", exact: true }).first().click();
await page.getByText("Saved").waitFor();
await page.getByRole("button", { name: "Add channel" }).click();
await page.getByRole("dialog").getByLabel("Name").fill("e2e-channel");
await page.getByRole("dialog").getByLabel("Webhook URL").fill("https://discord.com/api/webhooks/1/e2e-webhook-secret");
await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
await page.getByRole("cell", { name: "e2e-channel" }).waitFor();
check("settings: channel shows credential as set", (await page.locator("tr", { hasText: "e2e-channel" }).locator(".badge-green").innerText()) === "set");
await page.locator("tr", { hasText: "e2e-channel" }).getByRole("button", { name: "Test" }).click();
await page.locator("tr", { hasText: "e2e-channel" }).getByRole("status").waitFor({ timeout: 15000 });
check("settings: channel test shows a result (the fake webhook id is expected to fail)", true);
check("settings: webhook secret not in page", !(await page.content()).includes("e2e-webhook-secret"));
page.once("dialog", (d) => d.accept());
await page.locator("tr", { hasText: "e2e-channel" }).getByRole("button", { name: "Delete" }).click();
await page.getByRole("cell", { name: "e2e-channel" }).waitFor({ state: "detached" });
check("settings: audit log lists target.create", (await page.getByText("target.create").count()) > 0);
await page.close();

await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```
  Expected: the output ends with `ALL PASS` and exit code 0, with no `FAIL` line.
- [ ] Step 4: Manual: `grep -ci 'error' /tmp/cellar-e2e/dev.log` and read any hit around the walkthrough - Expected: no unhandled exception from the Worker caused by the UI's requests (a 409 from Backup now is expected and is not an exception).
- [ ] Step 5: Run: `bun run build:ui && ls dist/ui/index.html && bun run test && bun run typecheck` - Expected: `dist/ui/index.html` listed; tests pass (baseline + 64); typecheck exits 0.
- [ ] Step 6: Stop `bun run dev` and confirm `pgrep -fl 'vite|wrangler'` prints nothing for this repo.
- [ ] 👤 Human: open `/tmp/cellar-e2e/shots/dashboard-375.png`, `detail-375.png`, `new-375.png`, `settings-375.png` and the four `*-1440.png` equivalents. Expected: nothing looks off to you (alignment, spacing, truncation, contrast, red highlighting readable, no clipped buttons). Fix anything clearly off, per `AGENTS.md`, and re-run Step 3. - Proxy: Step 3 asserts no horizontal overflow, red rows, gating, and masked secrets at both widths, and `bun run test` covers the logic behind each; the human check confirms only appearance.

## Self-review record

Counts stated above: 18 tasks; 64 new tests across 9 files (time 11, status 11, display 13, client 6, poll 4, form 8, restore 5, preview 1, channel 5); 20 required endpoints in the gap script.
Scratch evidence: Tasks 3-9 code and all nine test files ran in `/tmp/phase-9-scratch` (64 pass, root `tsc --noEmit` clean, `tsc -p ui --noEmit` clean, `vite build ui` built); Tasks 10-17 page code typechecked and rendered in Chromium against a mocked API (round 2 edits: `types.ts`, `form.ts`, `restore.ts`, `channel.ts`, their tests, and `TargetForm.tsx`, `Targets.tsx`, `TargetDetail.tsx`, `RestoreDialog.tsx` were re-run in scratch after the edit - 64 tests pass, both `tsc` runs clean, `vite build ui` built; the Chromium walkthrough was NOT re-run for them, and the new Enable target callout and the e2e.mjs changes have never run); Task 2's Vite config, `assets` block, and `scripts/dev.ts` ran against a stub Worker. Not run: anything against the real Phase 1-8 code, the Task 1 script against the real app, `seed.ts`, `e2e.mjs`.
