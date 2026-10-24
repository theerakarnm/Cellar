# Phase 8: Alerts - LINE, Discord, staleness Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-8-alerts-line-discord-staleness.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Preflight` checks (Phase gate first) BEFORE Task 1 and report anything down.
> This plan was written before Phases 2 to 7 exist in the tree.
> Files and exports from those phases are cited from their plans and the decisions register, and are marked "(planned, not yet in tree)".
> The new modules and their tests (Tasks 1, 2, 4 to 9) are reference code that was type-checked and run in a scratch project against stand-ins for the earlier phases (see "Scratch validation").
> The wiring tasks (3, 10, 11) were NOT run anywhere.
> When a tool rejects the reference code, the tool wins: correct minimally and record a `> Deviation:` line.
> If a gate file or export differs from what this plan says, STOP and report. The earlier phase moved.

**Goal:** Send LINE and Discord alerts when a backup fails or times out, when a target reaches N consecutive failures, and when a target goes stale, each exactly once per episode where required, without ever failing the backup flow.
**Architecture:** Pure message and sender modules in `src/worker/alerts/`. One hook, `notifyBackupFinished(env, backupId)`, is called wherever a backup row reaches a terminal status. It keeps the failure episode state on `targets` with atomic `UPDATE ... RETURNING` claims. A per-minute `checkStaleness(env, now)` runs in the cron. Channel CRUD and a test-send route sit under `/api`. The per-target threshold lives in Phase 2's target create/update (owner round 2, answer 22).
**Tech Stack:** Bun 1.3, TypeScript, Hono, Drizzle ORM (D1), Zod (added in Phase 2), Vitest, WebCrypto. No new dependency.
**Spec:** `docs/plans/prds/phase-8.md` (owner's text), `docs/plans/2026-10-24-phases-2-10-decisions.md` section "Owner answers, round 2" (binding, overrides the rest), section "Phase 8 (alerts)", and X1 to X18, `docs/PLAN.md` sections 3, 4, 6, `AGENTS.md`.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD` at planning time). The tree then held only the Phase 1 plan, not its code. The executor records the real HEAD at Phase gate time and notes it as a `> Deviation:` line that says the base moved (it will have, since Phases 1 to 7 land first).
**Confidence:** 6/10. Rubric: start 10, minus 2 because every anchor lives in files from Phases 1 to 7 that do not exist yet (register X18), minus 2 because Task 2 widens an inferred Drizzle row type (`typeof targets.$inferSelect`, three new columns) and its hand-built consumers cannot be listed before those phases exist (the task gives the exact grep to find them). No other deductions: no Human check lacks a proxy, and every Preflight command that can run today (`bun --version`, `git status`, `lsof`, the discord.com reachability check) was run. Below 7, so execution is single-track sequential (it is anyway). Residual risks: the exact shape of Phase 5's callback, sweeper, and consumer code (Task 10), Phase 2's `parseBody`/`parseQuery`/`ApiError` signatures, and no real LINE or Discord delivery was run.
**NOT building:**
- Alerts for `retention_failed` and `restore_finished`. The events are accepted on a channel (the column allows them), but Phases 6 and 7 emit them.
- Retries, a retry queue, or a dead-letter store for failed deliveries. One attempt, one redacted log line.
- Request timeouts on LINE and Discord calls.
- Alert history table or UI. Phase 9 owns the UI.
- Linking channels to targets. Phase 2's target API owns `target_alert_channels`. This phase only reads it.
- A threshold endpoint or any change to Phase 2's target create/update Zod schema or routes. `alert_failure_threshold` is a Phase 1 column and Phase 2 edits it (round 2, answer 22). This phase only reads it.
- Rich LINE Flex messages, Discord embeds, mentions, or per-channel message templates. Plain text only.
- Per-channel rate-limit handling (HTTP 429 is logged as a failure).
- `retention_dry_run`, restore, download, or anything else from other phases.
- `GET /api/me` (not in any phase before 9; Phase 2 register says not built).
- Remote commands: no `wrangler deploy`, no `db:migrate:remote`, no secrets, no Cloudflare resource creation.

## ASK - owner confirmation needed before execution

None open.

**Closed by owner (round 2):**
- Per-target `alert_failure_threshold` (default 3) and `stale_after_hours` are edited in Phase 2's target create/update (answer 22). There is no alert-settings endpoint, so this phase has no threshold route (the old ASK-1 and its Task 10 are gone).
- Discord webhook URLs must start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`. Everything else is rejected (answer 23, the old ASK-2). The `ptb.` and `canary.` hosts are no longer accepted.
- Direct connection mode is removed. This phase never read a connection mode, so nothing else changed for it. Seed rows in tests now include the NOT NULL tunnel columns.

## Decisions that differ from the PRD / docs/PLAN.md

1. **Cron cadence.** The PRD says "checked in the cron ... not every 5 minutes". The cron is `* * * * *` (register X13), so staleness is checked every minute, with a one-time claim per episode.
2. **Credentials are JSON, encrypted as one string.** `line` is `{ "token", "to" }`, `discord` is `{ "webhookUrl" }` (register). `credential_enc` stores `encrypt(JSON.stringify(credential), ENCRYPTION_KEY)`. Responses show `hasCredential: true` only.
3. **Channel-to-target link is many to many.** `docs/PLAN.md` and the Phase 1 schema already have `alert_channels` without `target_id`. This phase reads `target_alert_channels` (register X3). A target with no linked channel gets no alerts; `docs/alerts.md` (Task 12) says so.
4. **New `targets` columns** (additive migration, Task 2): `consecutive_failures` integer NOT NULL default 0, `failure_alerted_at` text, `stale_alerted_at` text. `alert_failure_threshold` (integer NOT NULL DEFAULT 3) already exists from Phase 1 and is edited by Phase 2's target API (round 2, answers 5 and 22).
5. **Two alerts on the Nth failure.** `backup_failed` fires on every failure (register). Reaching the threshold also fires `backup_consecutive_failures` once until a success resets the counter. On the Nth failure a channel subscribed to both gets two messages.
6. **Staleness reference time** is `targets.last_backup_at` (last success, set by Phase 5), else `targets.created_at` for a target that never succeeded. Stale means strictly older than the limit. Disabled and soft-deleted targets are never checked. The episode is marked (`stale_alerted_at`) even when no channel is linked, so linking a channel later does not trigger an old alert. A failing target can be both failed-alerted and stale-alerted; that is intended (PRD: "no success within X hours").
7. **Derived stale limit** is `approxIntervalMs(schedule_cron, timezone, now) + 2 h` (register; daily = 26 h). `stale_after_hours` overrides it.
8. **Events.** Allowed event names are the five in `docs/PLAN.md` (`ALERT_EVENTS`). A new channel defaults to the three this phase emits.
9. **Channel delete is a hard delete** of the channel and its `target_alert_channels` rows (one `db.batch`). The table has no `deleted_at`, and the register lists `alert_channel.delete` as an audit action. Targets are unaffected.
10. **Test-send route** `POST /api/alert-channels/:id/test` returns `200 { ok: true }` or `200 { ok: false, error }` (the error is a fixed redacted string such as `LINE API returned HTTP 401`). Unknown id is 404. No audit row (the register has no action for it).
11. **File layout** differs from `docs/PLAN.md` section 2: `alerts/` holds `message.ts`, `types.ts`, `line.ts`, `discord.ts`, `dispatch.ts`, `notify.ts`, `staleness.ts`; the route file is `routes/alert-channels.ts` (not `routes/alerts.ts`); shared Zod schemas live in `src/shared/alerts.ts`. Task 13 updates PLAN.md.
12. **Where alerts run.** The HTTP callback uses `afterResponse` (`ctx.waitUntil` when a context exists, awaited otherwise, because Hono throws on `c.executionCtx` when a test calls `app.request` without one). The cron, sweeper, and queue consumer `await` the hook; it never throws.
13. **`APP_BASE_URL`** is a `vars` entry in `wrangler.jsonc` with a placeholder value, and a line in `.dev.vars.example`. It is not a secret.

## Global Constraints

- TypeScript everywhere; Bun is the package manager; `bun run test` runs Vitest; `bun run typecheck` is `tsc --noEmit` (strict, `noUncheckedIndexedAccess`).
- Worker code in `src/worker/`, tests in `test/worker/`, shared code in `src/shared/`, tests in `test/shared/` (register X1).
- Worker is Hono on Cloudflare Workers with `AppEnv = { Bindings: Env; Variables: { actorEmail: string } }`; D1 + Drizzle ORM; migrations live in `/migrations`; IDs are UUIDv7; times are UTC ISO-8601 text; columns are `snake_case`.
- Zod validates every API input. Errors: `{ "error": { "code", "message", "details"? } }` through `ApiError` (register X6). Lists use `?limit` (default 50, max 200) and `?cursor` and return `{ items, nextCursor }` (X7).
- Alert credentials are encrypted at rest with AES-256-GCM via `encrypt`/`decrypt` and the `ENCRYPTION_KEY` secret. Never return them in plaintext after save. Never log them.
- Redact connection strings and passwords from logs, errors, API responses, and alerts. Error text in an alert goes through `redactSecrets` and a hard length cap. Log lines contain channel id, type, event, and a fixed error string only. Never the token, webhook URL, or exception message of a send.
- Alert sending must never throw into the backup callback, sweeper, consumer, or cron. Alert failures are logged, not propagated.
- A backup's last success is NEVER deleted by this phase. This phase deletes nothing except an alert channel row and its link rows on explicit `DELETE`.
- Audit rows go through `writeAudit(db, entry)`; `details` never contains credentials (X10). Action names: `alert_channel.create`, `alert_channel.update`, `alert_channel.delete`, `target.update`.
- Additive migrations only: `bun run db:generate -- --name <what>`; never edit an applied migration; never rely on a hard-coded migration number; run `ls migrations` at task start (X3).
- Never hardcode secrets. Document every var in `.dev.vars.example`.
- Do not guess Cloudflare, LINE, or Discord APIs. Write [uncertain] when unsure.
- Stop and ask before: any real Cloudflare resource, `wrangler deploy`, any remote command, any unlisted dependency, any data-deleting operation beyond the channel delete above.
- If the same step fails 3 times, stop and report what you tried.
- No em dash in any file you write. Use a plain dash. Do not add the agent as co-author in commit messages.
- End the phase with `bun run test` and `bun run typecheck` passing, then the summary in the last section.

## Patterns to Mirror

All patterns come from earlier plans, because the code does not exist yet (planned, not yet in tree).

### Naming and Drizzle tables
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:652-679 (Task 4, Step 1, src/worker/db/schema.ts) -->
```ts
export const alertChannels = sqliteTable(
  "alert_channels",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["line", "discord"] }).notNull(),
    name: text("name").notNull(),
    credentialEnc: text("credential_enc").notNull(),
    events: text("events").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_alert_channels_enabled_type").on(t.enabled, t.type)],
);

export const targetAlertChannels = sqliteTable(
  "target_alert_channels",
  {
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    channelId: text("channel_id")
      .notNull()
      .references(() => alertChannels.id),
  },
  (t) => [primaryKey({ columns: [t.targetId, t.channelId] }), index("idx_target_alert_channels_channel").on(t.channelId)],
);
```
Files are `kebab-case.ts`. Tables are plural `snake_case` SQL names with `camelCase` TS properties. Multi-word member names in this phase: `backup_consecutive_failures`, `alert_failure_threshold`, `failureAlertedAt`.

### Error handling and redaction
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:443-445 (Task 3, Step 1, src/worker/lib/redact.ts) -->
```ts
export function redactError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
```
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:766 (Task 5, access middleware logging style) -->
```ts
console.warn(`access: rejected (${reason})`);
```
Logging style for this phase: one `console.warn(JSON.stringify({ msg, ...ids }))` line with ids and fixed strings only.
Route errors: `throw new ApiError(404, "not_found", "...")` (register X6; planned, not yet in tree).

### Tests
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md:81 (Patterns to Mirror, Tests) and docs/plans/2026-10-24-phases-2-10-decisions.md X4 -->
Vitest in Node, files at `test/worker/<mirrors src/worker path>.test.ts`, Hono apps tested with `app.request("http://localhost/...", init, env)`, D1/R2/Queue from `createTestEnv()` in `test/helpers/env.ts` (planned, Phase 2). `fetch` is mocked with `vi.spyOn(globalThis, "fetch")`.

## Preflight

### Phase gate - run first

- [ ] Gate 1: `bun run test && bun run typecheck` - Expected: both exit 0 (the repo at Phase 8 start is green; Phases 1 to 7 each ended green).
- [ ] Gate 2: every file below exists (`test -f`):
  `src/worker/env.ts`, `src/worker/app.ts`, `src/worker/index.ts`, `src/worker/middleware/access.ts`, `src/worker/middleware/error.ts`, `src/worker/lib/crypto.ts`, `src/worker/lib/redact.ts`, `src/worker/lib/uuidv7.ts`, `src/worker/lib/validate.ts`, `src/worker/lib/audit.ts`, `src/worker/db/schema.ts`, `src/worker/db/client.ts`, `src/shared/tz.ts`, `src/shared/cron.ts`, `test/helpers/env.ts`.
- [ ] Gate 3: the exports this plan imports exist. Run:
  `rg -n "export (async )?function (encrypt|decrypt|redactSecrets|redactError|uuidv7|writeAudit|getDb|parseBody|parseQuery|getZonedParts|approxIntervalMs|createTestEnv)|export class ApiError|export (const|function) (app|access)" src test`
  Expected: at least one hit for each of the 15 names (12 functions, `ApiError`, `app`, `access`). Record the file each lives in. If `ApiError`, `parseBody`, or `parseQuery` live somewhere other than `src/worker/middleware/error.ts` / `src/worker/lib/validate.ts`, change the import paths in Task 9 and note a `> Deviation:`. If a signature differs from: `parseBody(c, schema): Promise<z.infer<schema>>`, `parseQuery(c, schema): z.infer<schema>`, `ApiError(status, code, message, details?)`, `writeAudit(db, { actor, action, entityType, entityId?, details?, ip? }): Promise<void>`, `getZonedParts(date, tz)` (fields `year month day hour minute second weekday`), `approxIntervalMs(expr, tz, after): number`, STOP.
- [ ] Gate 4: Phase 5 wiring facts. Run:
  `rg -l "internal/jobs/callback" src/worker` and `rg -n "scheduled" src/worker/index.ts` and `rg -n "lastBackupAt" src/worker`
  Expected: at least one file for each. The third proves Phase 5 sets `targets.last_backup_at` on a successful backup; staleness depends on it. If it is absent, STOP and report (do not add it here).
- [ ] Gate 5: no earlier phase already created this phase's files. Run: `ls src/worker/alerts src/shared/alerts.ts src/worker/routes/alert-channels.ts 2>&1` - Expected: "No such file" for all three. If any exists, STOP.

### DURABLE - true until the repo itself changes

- **No new dependency is needed.** Round 2 approved only `wrangler`, `drizzle-kit`, `typescript`, `@cloudflare/workers-types` (Phase 1), `@types/bun`, RustFS, `@types/react`, and `@types/react-dom`; this phase uses none of the later ones beyond what is installed. Evidence: the code in this plan imports only `hono`, `zod`, `drizzle-orm`, `vitest`, and local modules, all present after Phase 2. No "Dependencies that need your approval" table is needed.
- **LINE push request.** `POST https://api.line.me/v2/bot/message/push`, header `Authorization: Bearer <token>`, JSON body `{ "to": "<user/group/room id>", "messages": [{ "type": "text", "text": "..." }] }`, text limit 5000 UTF-16 code units. Evidence: `~/.agents/skills/line-messaging/SKILL.md` and `references/messages.md` ("text max 5000 chars counted in UTF-16 code units"), built from LINE's docs fetched 2026-10-08; endpoint seen in `scripts/line.py:1054`. Not re-fetched at planning time. Consequence: Task 5 uses exactly this. [uncertain until the end-to-end Human check]
- **Discord webhook request.** `POST <webhook url>` with JSON `{ "content": "...", "allowed_mentions": { "parse": [] } }`; `content` is up to 2000 characters; the default response is `204 No Content` (a message body only with `wait=true`). Evidence: `https://docs.discord.com/developers/resources/webhook`, fetched 2026-10-24 ("the message contents (up to 2000 characters)", "Returns a message or 204 No Content depending on the wait query parameter", `allowed_mentions` field). Consequence: success is `response.ok`; Task 5 caps content at 2000.
- **Hono throws on `c.executionCtx` when no context was given.** Evidence: scratch test "returns the task itself when Hono has no context" passed (`/tmp/phase-8-scratch/test/worker/alerts/notify.test.ts`, hono 4.13.13). Consequence: `afterResponse` in Task 7.
- **The generated additive migration is three `ALTER TABLE targets ADD ...` statements** that SQLite accepts, including `NOT NULL DEFAULT`. Evidence: `drizzle-kit generate --name alert_state` in the scratch project against the Phase 1 schema produced exactly three statements; they applied to an in-memory SQLite database via the migration harness.

### PERISHABLE - recapture before Task 1

- **Git state.** Check: `git status --short && git rev-parse --short HEAD && git branch --show-current` - Expected: clean tree. Create the branch: `git switch -c phase-8-alerts`. Needed by: every commit.
- **Dependencies installed in THIS checkout.** Check: `test -d node_modules && bun run typecheck` exits 0. If `node_modules` is missing run `bun install --frozen-lockfile` first.
- **Baseline red count.** Check: `bun run test 2>&1 | tail -8` and `bun run typecheck`. Record the exact counts here before Task 1 (planning-time value: not recorded, the repo had no code). The expectation is typecheck 0 errors and 0 failing tests. If not green at HEAD, name the pre-existing failures by file; every later "no new errors" Verify is measured against that list. Do not widen it mid-run.
- **Migration lineage.** Check: `ls migrations` - record the highest `NNNN_*.sql`. Task 2 generates the next one; do not hard-code a number.
- **Hand-built consumers of the `targets` row type** (feeds Task 2). Check: `rg -n "targets\.\$inferSelect|typeof targets|TargetRow" src test`. Record every hit; Task 2 fixes any that construct the row by hand.
- **Hand-built `Env` objects** (feeds Task 3). Check: `rg -n "ENCRYPTION_KEY:" src test`. Record every hit.
- **Free port for the end-to-end dev server.** Check: `lsof -i :8798` - Expected: no output (planning run: free). If used, pick another port and use it in every end-to-end command.
- **Bun version.** Check: `bun --version` - Expected `1.3.x` (planning run: 1.3.5).
- **Secrets for the end-to-end section.** None real. The run uses a throwaway, gitignored `.dev.vars` with fake values. Check: `test -f .dev.vars && echo present || echo absent`. If present, do not overwrite it; use `--env-file` or a temp copy, and restore afterwards.
- **Network to discord.com** for the end-to-end Manual items (a fake webhook returns 401 or 404, which is the expected outcome). Check: `curl -s -o /dev/null -w "%{http_code}" https://discord.com/api/webhooks/0/x -X POST -H "content-type: application/json" -d '{"content":"x"}'` - Expected: `401` or `404`. If it cannot connect, the log line in the end-to-end section says "network error" instead; both are accepted.

## Scratch validation

All of the code and test files in Tasks 1, 2 (seed helper and test), 4, 5, 6, 7, 8, and 9 below were copied from `/tmp/phase-8-scratch`, a throwaway project (bun 1.3.5, vitest 5.0.5, hono 4.13.13, zod 4.6.7, drizzle-orm 0.45.4, drizzle-kit 0.31.11, typescript 7.0.2).
It used the round 2 Phase 1 `schema.ts` (no `connection_mode`, tunnel columns NOT NULL, partial unique `uq_targets_name`, `alert_failure_threshold` on `targets`; hand-copied from the current Phase 1 plan), `crypto.ts`, and `redact.ts` copied from the Phase 1 plan, and in-house stand-ins for the Phase 2 modules (`ApiError`/`onError`, `parseBody`, `parseQuery`, `writeAudit`, `uuidv7`, `getZonedParts`, `approxIntervalMs`, `createTestEnv`).
The stand-in `createTestEnv` used an in-memory SQLite behind a minimal D1 shim, not `getPlatformProxy`.
Result: after the round 2 edits the migrations were regenerated and everything was re-run (`bunx --bun vitest run`): 60 tests in 8 files passed. `tsc --noEmit` is clean for the plan's files (its only errors are in the scratch stand-in `test/helpers/env.ts`, which uses `bun:sqlite`).
Re-run after round 2: Task 1 (schemas and tests, now without `alertSettingsSchema` and with the two-host allowlist), Task 2 (migration regenerated, now three statements; seed helper now sets the tunnel columns), and every other snippet (unchanged code, re-run against the new schema). Task 10's route and test were deleted from the scratch project.
Negative control: removing the atomic claim in `notifyBackupFinished` made the "exactly once per episode" test fail; removing both the candidate filter and the claim in `checkStaleness` made its "once per stale episode" test fail.
NOT run anywhere: the Task 2 migration against `wrangler`'s real local D1, real `getPlatformProxy`, `ctx.waitUntil` behavior in a real Worker, any real LINE or Discord call, and everything in Tasks 3, 10, 11, 12, 13.

## Execution

**Tracks:** one track, sequential. Tasks 4 and 5 and 8 do not depend on each other, but all tracks here are below the parallel cost floor (fewer than 3 tasks or 5 files that are truly independent), and the register says all phase plans are single-track.
**Merge order:** not applicable (single track).
**Shared files** (each is owned by one task, or edited by consecutive tasks in order): `src/worker/db/schema.ts` and `migrations/` - Task 2. `src/worker/env.ts`, `test/helpers/env.ts`, `.dev.vars.example`, `wrangler.jsonc` - Task 3. `src/worker/app.ts` - Task 9. Phase 5 files (callback, sweeper, consumer) - Task 10. `src/worker/index.ts` - Task 11. `docs/PLAN.md` - Task 13. `package.json` and `bun.lock` - untouched.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch: `git switch -c phase-8-alerts`.
**treehouse:** not needed for a single track.

---
### Task 1: Shared alert schemas

**Files:**
- Create: `src/shared/alerts.ts`
- Test: `test/shared/alerts.test.ts`

**Interfaces:**
- Consumes: `zod` (installed in Phase 2).
- Produces: `src/shared/alerts.ts` exports: `ALERT_EVENTS` (readonly tuple of 5 names), `type AlertEvent`, `DEFAULT_CHANNEL_EVENTS: AlertEvent[]`, `isDiscordWebhookUrl(value: string): boolean`, `lineCredentialSchema`, `discordCredentialSchema`, `type LineCredential`, `type DiscordCredential`, `createChannelSchema` (discriminated union on `type`), `updateChannelSchema`. Later tasks (5, 6, 9) import these.

**Gotcha:** Only the two Discord hosts from owner answer 23 are allowed, so `canary.discord.com` and `ptb.discord.com` are rejected, as is any path outside `/api/webhooks/` or `/api/vN/webhooks/` (the test covers it). `z.strictObject` rejects unknown keys on purpose, so a client cannot smuggle `type` into a PATCH. `credential` in `updateChannelSchema` is `z.unknown()` because it can only be checked against the stored channel type inside the route (Task 9).

**Steps:**
- [ ] Step 1: Create `src/shared/alerts.ts` (run in scratch):
```ts
import { z } from "zod";

export const ALERT_EVENTS = [
  "backup_failed",
  "backup_stale",
  "backup_consecutive_failures",
  "retention_failed",
  "restore_finished",
] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];

/** Events that Phase 8 emits. A new channel subscribes to these unless the request says otherwise. */
export const DEFAULT_CHANNEL_EVENTS: AlertEvent[] = ["backup_failed", "backup_stale", "backup_consecutive_failures"];

const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com"]);
const DISCORD_PATH = /^\/api(\/v\d+)?\/webhooks\//;

export function isDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && DISCORD_HOSTS.has(url.hostname) && DISCORD_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export const lineCredentialSchema = z.strictObject({
  token: z.string().trim().min(1).max(512),
  to: z.string().trim().min(1).max(64),
});
export const discordCredentialSchema = z.strictObject({
  webhookUrl: z.string().trim().max(512).refine(isDiscordWebhookUrl, "must start with https://discord.com/api/webhooks/ or https://discordapp.com/api/webhooks/"),
});
export type LineCredential = z.infer<typeof lineCredentialSchema>;
export type DiscordCredential = z.infer<typeof discordCredentialSchema>;

const nameSchema = z.string().trim().min(1).max(100);
const eventsSchema = z
  .array(z.enum(ALERT_EVENTS))
  .min(1)
  .refine((events) => new Set(events).size === events.length, "events must be unique");

export const createChannelSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("line"),
    name: nameSchema,
    events: eventsSchema.default(DEFAULT_CHANNEL_EVENTS),
    enabled: z.boolean().default(true),
    credential: lineCredentialSchema,
  }),
  z.strictObject({
    type: z.literal("discord"),
    name: nameSchema,
    events: eventsSchema.default(DEFAULT_CHANNEL_EVENTS),
    enabled: z.boolean().default(true),
    credential: discordCredentialSchema,
  }),
]);

/** `credential` is checked against the stored channel type inside the route. */
export const updateChannelSchema = z.strictObject({
  name: nameSchema.optional(),
  events: eventsSchema.optional(),
  enabled: z.boolean().optional(),
  credential: z.unknown().optional(),
});
```
- [ ] Step 2: Create `test/shared/alerts.test.ts` (run in scratch, 7 tests):
```ts
import { describe, expect, it } from "vitest";
import {
  createChannelSchema,
  DEFAULT_CHANNEL_EVENTS,
  isDiscordWebhookUrl,
  updateChannelSchema,
} from "../../src/shared/alerts";

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL";

describe("isDiscordWebhookUrl", () => {
  it("accepts discord webhook URLs", () => {
    expect(isDiscordWebhookUrl(WEBHOOK)).toBe(true);
    expect(isDiscordWebhookUrl("https://discordapp.com/api/v10/webhooks/1/tok")).toBe(true);
  });

  it("rejects other hosts, schemes, and paths", () => {
    for (const url of [
      "http://discord.com/api/webhooks/1/tok",
      "https://evil.example.com/api/webhooks/1/tok",
      "https://discord.com.evil.example.com/api/webhooks/1/tok",
      "https://canary.discord.com/api/webhooks/1/tok",
      "https://discord.com/channels/1/2",
      "not a url",
    ]) {
      expect(isDiscordWebhookUrl(url)).toBe(false);
    }
  });
});

describe("createChannelSchema", () => {
  it("parses a LINE channel and fills defaults", () => {
    const parsed = createChannelSchema.parse({ type: "line", name: "Ops", credential: { token: "tok", to: "U123" } });
    expect(parsed.events).toEqual(DEFAULT_CHANNEL_EVENTS);
    expect(parsed.enabled).toBe(true);
  });

  it("parses a Discord channel", () => {
    const parsed = createChannelSchema.parse({ type: "discord", name: "Ops", credential: { webhookUrl: WEBHOOK } });
    expect(parsed.type).toBe("discord");
  });

  it("rejects a credential shaped for the other type", () => {
    expect(createChannelSchema.safeParse({ type: "line", name: "Ops", credential: { webhookUrl: WEBHOOK } }).success).toBe(false);
    expect(createChannelSchema.safeParse({ type: "discord", name: "Ops", credential: { token: "t", to: "U" } }).success).toBe(false);
  });

  it("rejects unknown events, empty events, and duplicate events", () => {
    const base = { type: "line", name: "Ops", credential: { token: "t", to: "U" } };
    expect(createChannelSchema.safeParse({ ...base, events: ["nope"] }).success).toBe(false);
    expect(createChannelSchema.safeParse({ ...base, events: [] }).success).toBe(false);
    expect(createChannelSchema.safeParse({ ...base, events: ["backup_failed", "backup_failed"] }).success).toBe(false);
  });
});

describe("updateChannelSchema", () => {
  it("accepts a partial update and rejects unknown keys", () => {
    expect(updateChannelSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(updateChannelSchema.safeParse({ type: "discord" }).success).toBe(false);
  });
});
```
- [ ] Step 3: Verify - Run: `bun run test test/shared/alerts.test.ts` - Expected: 7 pass, 0 fail
- [ ] Step 4: Verify - Run: `bun run typecheck` - Expected: no new errors versus the recorded baseline (0 if the baseline is green)
- [ ] Step 5: Commit - `git add src/shared/alerts.ts test/shared/alerts.test.ts && git commit -m "feat(alerts): shared channel and settings schemas"`

---

### Task 2: Alert state columns and additive migration

**Files:**
- Modify: `src/worker/db/schema.ts` (anchor: `staleAfterHours: integer("stale_after_hours")`, in the `targets` table)
- Create (generated): `migrations/NNNN_alert_state.sql`, `migrations/meta/NNNN_snapshot.json`; Modify (generated): `migrations/meta/_journal.json`
- Test: `test/worker/db/alert-state.test.ts`
- Create: `test/helpers/alerts-seed.ts` (shared seed helper for Tasks 6 to 9 and 11; kept here so Task 2's test and later tests use one copy)
- Modify only if the typecheck in Step 6 reports errors: hand-built `targets` row fixtures found by the Preflight grep (`rg -n "targets\.\$inferSelect|typeof targets|TargetRow" src test`)

**Interfaces:**
- Consumes: `targets` table in `src/worker/db/schema.ts` (Phase 1 plan Task 4); `createTestEnv` (Phase 2); `bun run db:generate` (Phase 1 script).
- Produces: Three new columns on `targets` (Drizzle properties): `consecutiveFailures: number` (NOT NULL, default 0), `failureAlertedAt: string | null`, `staleAlertedAt: string | null`. Test helper `test/helpers/alerts-seed.ts`: `WEBHOOK: string`, `seedTarget(env: Env, id: string, over?: Record<string, unknown>): Promise<void>` (columns by snake_case SQL name; target name defaults to `target-<id>`; fills the NOT NULL tunnel columns), `seedChannel(env: Env, id: string, targetId: string | null, over?: { type?: "line" | "discord"; events?: string[]; enabled?: boolean; credential?: unknown }): Promise<void>`, `seedBackup(env: Env, id: string, targetId: string, status: string, over?: Record<string, unknown>): Promise<void>`, `targetRow(env: Env, id: string): Promise<{ consecutive_failures: number; failure_alerted_at: string | null; stale_alerted_at: string | null } | null>`.

**Gotcha:** `alert_failure_threshold` is NOT added here. Phase 1 already has it (NOT NULL DEFAULT 3). `drizzle-kit generate` emits three files: the `.sql`, the snapshot, and an appended `_journal.json` entry. Stage all of `migrations`. SQLite allows `ADD COLUMN ... NOT NULL DEFAULT`, so no table rebuild is needed.

**Rollback:** Local D1 only. Before the commit: delete the three generated files and revert `schema.ts`. After the commit: `git revert <commit>`; to reset local D1 state run `rm -rf .wrangler/state/v3/d1 && bun run db:migrate:local`. Never run `db:migrate:remote` in this phase. Never edit this migration once it has been applied anywhere real.

**Steps:**
- [ ] Step 1: Record the migration lineage: `ls migrations` (note the highest number). Do not hard-code a number anywhere below.
- [ ] Step 2: Edit `src/worker/db/schema.ts`. Old string (unique, in `targets`):
```ts
    staleAfterHours: integer("stale_after_hours"),
```
New string:
```ts
    staleAfterHours: integer("stale_after_hours"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    failureAlertedAt: text("failure_alerted_at"),
    staleAlertedAt: text("stale_alerted_at"),
```
- [ ] Step 3: Generate the migration (local, no remote): `bun run db:generate -- --name alert_state`. Open the new `.sql` file. Expected content (the scratch run produced exactly this against the round 2 Phase 1 schema):
```sql
ALTER TABLE `targets` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `targets` ADD `failure_alerted_at` text;--> statement-breakpoint
ALTER TABLE `targets` ADD `stale_alerted_at` text;
```
If the file contains anything else (for example statements from an unrelated pending schema change), STOP and report.
- [ ] Step 4: Create `test/helpers/alerts-seed.ts`. It writes with raw SQL so it does not depend on Phase 2 insert helpers or on later schema changes (run in scratch):
```ts
import { encrypt } from "../../src/worker/lib/crypto";
import type { Env } from "../../src/worker/env";

export const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL";
const NOW = "2026-10-24T00:00:00.000Z";

export async function seedTarget(env: Env, id: string, over: Record<string, unknown> = {}) {
  const row = { id, name: `target-${id}`, db_name: "shop", connection_url_enc: "enc", tunnel_hostname: "db.example.com", tunnel_token_id_enc: "enc", tunnel_token_secret_enc: "enc", created_at: NOW, updated_at: NOW, ...over };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO targets (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
}

export async function seedChannel(
  env: Env,
  id: string,
  targetId: string | null,
  over: { type?: "line" | "discord"; events?: string[]; enabled?: boolean; credential?: unknown } = {},
) {
  const type = over.type ?? "discord";
  const credential = over.credential ?? (type === "discord" ? { webhookUrl: WEBHOOK } : { token: "line-token-xyz", to: "U1234567890" });
  const enc = await encrypt(JSON.stringify(credential), env.ENCRYPTION_KEY);
  await env.DB.prepare(
    "INSERT INTO alert_channels (id,type,name,credential_enc,events,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(id, type, `chan-${id}`, enc, JSON.stringify(over.events ?? ["backup_failed", "backup_stale", "backup_consecutive_failures"]), (over.enabled ?? true) ? 1 : 0, NOW, NOW).run();
  if (targetId) await env.DB.prepare("INSERT INTO target_alert_channels (target_id, channel_id) VALUES (?,?)").bind(targetId, id).run();
}

export async function seedBackup(env: Env, id: string, targetId: string, status: string, over: Record<string, unknown> = {}) {
  const row = { id, target_id: targetId, status, trigger: "schedule", queued_at: NOW, finished_at: "2026-10-24T07:05:00.000Z", ...over };
  const cols = Object.keys(row);
  await env.DB.prepare(`INSERT INTO backups (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).bind(...Object.values(row)).run();
}

export async function targetRow(env: Env, id: string) {
  return env.DB.prepare("SELECT consecutive_failures, failure_alerted_at, stale_alerted_at FROM targets WHERE id = ?").bind(id).first<{
    consecutive_failures: number;
    failure_alerted_at: string | null;
    stale_alerted_at: string | null;
  }>();
}
```
- [ ] Step 5: Create `test/worker/db/alert-state.test.ts` (run in scratch, 1 test):
```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../../src/worker/env";
import { createTestEnv } from "../../helpers/env";
import { seedTarget } from "../../helpers/alerts-seed";

let env: Env;
let dispose: () => Promise<void>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
});
afterEach(async () => {
  await dispose();
});

describe("alert state columns on targets", () => {
  it("default to threshold 3 (from Phase 1), zero failures, and no episode markers", async () => {
    await seedTarget(env, "t1");
    const row = await env.DB.prepare(
      "SELECT alert_failure_threshold AS threshold, consecutive_failures AS failures, failure_alerted_at AS fa, stale_alerted_at AS sa FROM targets WHERE id = 't1'",
    ).first();
    expect(row).toEqual({ threshold: 3, failures: 0, fa: null, sa: null });
  });
});
```
- [ ] Step 6: Verify - Run: `bun run test test/worker/db/alert-state.test.ts && bun run typecheck` - Expected: 1 pass; typecheck 0 new errors. If typecheck now fails in a file that builds a `targets` row by hand (the Preflight grep hits), add the three properties to that fixture (`consecutiveFailures: 0, failureAlertedAt: null, staleAlertedAt: null`) and list the file in the commit message body.
- [ ] Step 7: Verify - Run: `bun run db:migrate:local && bunx wrangler d1 execute cellar --local --command "SELECT consecutive_failures, stale_alerted_at FROM targets LIMIT 1"` - Expected: the command exits 0 (zero rows is fine; it proves the columns exist in local D1)
- [ ] Step 8: Commit - `git add src/worker/db/schema.ts migrations test/helpers/alerts-seed.ts test/worker/db/alert-state.test.ts && git commit -m "feat(alerts): add alert episode columns to targets"`

---

### Task 3: APP_BASE_URL in Env, test env, vars, and example file

**Files:**
- Modify: `src/worker/env.ts` (anchor: `DEV_BYPASS?: string;`)
- Modify: `test/helpers/env.ts` (anchor: the object that builds the fake `Env`, key `ENCRYPTION_KEY`)
- Modify: `.dev.vars.example` (append)
- Modify: `wrangler.jsonc` (anchor: the `vars` object; create it after `compatibility_date` if Phase 5 did not)
- Modify only if typecheck reports errors: any hand-built `Env` found by `rg -n "ENCRYPTION_KEY:" src test`

**Interfaces:**
- Consumes: `Env` interface (Phase 1), `createTestEnv(overrides?: Partial<Env>)` (Phase 2).
- Produces: `Env.APP_BASE_URL: string` (required). `createTestEnv()` sets it to `https://cellar.test`. Alert links are `${APP_BASE_URL}/targets/${id}`.

**Gotcha:** `vars` values in `wrangler.jsonc` are overridden by `.dev.vars` in local dev. This task exceeds the usual file count on purpose: making `APP_BASE_URL` required in `Env` breaks `createTestEnv` until it is updated, and each commit must build.

**Steps:**
- [ ] Step 1: In `src/worker/env.ts`, old string `  DEV_BYPASS?: string;` -> new string:
```ts
  APP_BASE_URL: string;
  DEV_BYPASS?: string;
```
- [ ] Step 2: In `test/helpers/env.ts`, add `APP_BASE_URL: "https://cellar.test",` next to the fake `ENCRYPTION_KEY` entry, before the `...overrides` spread so tests can still override it.
- [ ] Step 3: Append to `.dev.vars.example`:
```dotenv
# Public base URL of the deployed UI. Alert messages link to ${APP_BASE_URL}/targets/<id>. Not a secret.
APP_BASE_URL=http://localhost:8787
```
- [ ] Step 4: In `wrangler.jsonc`, add (or extend) the `vars` object with a placeholder. The real value is set by the owner at deploy time:
```jsonc
  "vars": {
    "APP_BASE_URL": "https://cellar.example.com"
  },
```
If a `vars` object already exists (Phase 5 adds R2 vars), add only the `APP_BASE_URL` key inside it.
- [ ] Step 5: Verify - Run: `bun run typecheck && bun run test` - Expected: typecheck 0 new errors; all tests pass. If a hand-built `Env` fails typecheck, add `APP_BASE_URL: "https://cellar.test"` to it.
- [ ] Step 6: Commit - `git add src/worker/env.ts test/helpers/env.ts .dev.vars.example wrangler.jsonc && git commit -m "feat(alerts): add APP_BASE_URL var"`

---

### Task 4: Alert message builder

**Files:**
- Create: `src/worker/alerts/message.ts`
- Test: `test/worker/alerts/message.test.ts`

**Interfaces:**
- Consumes: `getZonedParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }` from `src/shared/tz.ts` (Phase 2); `redactSecrets(input: string): string` from `src/worker/lib/redact.ts`.
- Produces: `src/worker/alerts/message.ts` exports: `ERROR_SUMMARY_MAX = 300`; `interface AlertTarget { id: string; name: string; projectTag: string | null; timezone: string }`; `type AlertDetail` (union on `event`: `backup_failed` with `status: "failed" | "timed_out"`, `errorCode`, `errorMessage`; `backup_consecutive_failures` with `count`, `errorCode`, `errorMessage`; `backup_stale` with `staleAfterHours: number`, `lastSuccessAt: Date | null`); `truncate(text: string, max: number): string`; `formatLocalTime(date: Date, tz: string): string` (`YYYY-MM-DD HH:mm <tz>`); `summarizeError(code: string | null, message: string | null): string`; `targetLink(appBaseUrl: string, targetId: string): string`; `buildAlertMessage(target: AlertTarget, detail: AlertDetail, at: Date, appBaseUrl: string): string`; `buildTestMessage(channelName: string, at: Date): string`.

**Gotcha:** The scratch run used a stand-in `getZonedParts` with the same signature. If the real one (Phase 2) formats DST edge cases differently, the two `formatLocalTime` expectations (Asia/Bangkok and UTC) still hold because neither zone has DST. `redactSecrets` only masks URL passwords and `password=` pairs. The stored `error_message` is already redacted at the source (Phases 4 and 5); this is a second pass, not the only one.

**Steps:**
- [ ] Step 1: Create `src/worker/alerts/message.ts` (run in scratch):
```ts
import { getZonedParts } from "../../shared/tz";
import { redactSecrets } from "../lib/redact";

export const ERROR_SUMMARY_MAX = 300;

export interface AlertTarget {
  id: string;
  name: string;
  projectTag: string | null;
  timezone: string;
}

export type AlertDetail =
  | { event: "backup_failed"; status: "failed" | "timed_out"; errorCode: string | null; errorMessage: string | null }
  | { event: "backup_consecutive_failures"; count: number; errorCode: string | null; errorMessage: string | null }
  | { event: "backup_stale"; staleAfterHours: number; lastSuccessAt: Date | null };

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 3));
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}...`;
}

export function formatLocalTime(date: Date, tz: string): string {
  const p = getZonedParts(date, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)} ${tz}`;
}

export function summarizeError(code: string | null, message: string | null): string {
  const body = redactSecrets(message ?? "").replace(/\s+/g, " ").trim();
  const text = [code, body].filter((part) => part).join(": ");
  return truncate(text || "no details", ERROR_SUMMARY_MAX);
}

export function targetLink(appBaseUrl: string, targetId: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/targets/${targetId}`;
}

function title(detail: AlertDetail): string {
  switch (detail.event) {
    case "backup_failed":
      return detail.status === "timed_out" ? "Backup timed out" : "Backup failed";
    case "backup_consecutive_failures":
      return `${detail.count} consecutive backup failures`;
    case "backup_stale":
      return `No successful backup in ${detail.staleAfterHours} h`;
  }
}

export function buildAlertMessage(target: AlertTarget, detail: AlertDetail, at: Date, appBaseUrl: string): string {
  const lines = [`[Cellar] ${title(detail)}`, `Target: ${target.name}`];
  if (target.projectTag) lines.push(`Project: ${target.projectTag}`);
  lines.push(`Time: ${formatLocalTime(at, target.timezone)}`);
  if (detail.event === "backup_stale") {
    lines.push(
      `Last success: ${detail.lastSuccessAt ? formatLocalTime(detail.lastSuccessAt, target.timezone) : "never"}`,
    );
  } else {
    lines.push(`Error: ${summarizeError(detail.errorCode, detail.errorMessage)}`);
  }
  lines.push(targetLink(appBaseUrl, target.id));
  return lines.join("\n");
}

export function buildTestMessage(channelName: string, at: Date): string {
  return `[Cellar] Test message\nChannel: ${channelName}\nTime: ${at.toISOString()}`;
}
```
- [ ] Step 2: Create `test/worker/alerts/message.test.ts` (run in scratch, 11 tests; uses real-looking secrets `Sup3rS3cretPw` and `hunter2-hunter2`):
```ts
import { describe, expect, it } from "vitest";
import { buildAlertMessage, formatLocalTime, summarizeError, targetLink, truncate } from "../../../src/worker/alerts/message";

const target = { id: "0192f000-0000-7000-8000-000000000001", name: "shop-prod", projectTag: "shop", timezone: "Asia/Bangkok" };
const at = new Date("2026-10-24T07:05:00Z");
const BASE = "https://cellar.example.com/";

// Real-looking secrets. None of these may ever reach a message.
const SECRET_URL = "postgres://app:Sup3rS3cretPw@db.internal:5432/shop?sslmode=require";
const SECRET_PAIR = "password=hunter2-hunter2";

describe("formatLocalTime", () => {
  it("formats in the target timezone", () => {
    expect(formatLocalTime(at, "Asia/Bangkok")).toBe("2026-10-24 14:05 Asia/Bangkok");
    expect(formatLocalTime(at, "UTC")).toBe("2026-10-24 07:05 UTC");
  });
});

describe("truncate", () => {
  it("keeps short text and caps long text with an ellipsis", () => {
    expect(truncate("abc", 10)).toBe("abc");
    expect(truncate("abcdefghij", 8)).toBe("abcde...");
    expect(truncate("abcdefghij", 8).length).toBe(8);
  });

  it("does not leave half of a surrogate pair", () => {
    const out = truncate("ab\u{1F600}\u{1F600}\u{1F600}", 5);
    expect(out).toBe("ab...");
  });
});

describe("summarizeError", () => {
  it("redacts, collapses whitespace, and prefixes the code", () => {
    const out = summarizeError("DUMP_FAILED", `pg_dump: connection failed\n  to ${SECRET_URL} ${SECRET_PAIR}`);
    expect(out.startsWith("DUMP_FAILED: pg_dump: connection failed to postgres://app:***@db.internal")).toBe(true);
    expect(out).not.toContain("Sup3rS3cretPw");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("\n");
  });

  it("caps the length at 300", () => {
    expect(summarizeError("X", "e".repeat(5000)).length).toBe(300);
  });

  it("handles a missing code and message", () => {
    expect(summarizeError(null, null)).toBe("no details");
  });
});

describe("buildAlertMessage", () => {
  it("builds the failed message", () => {
    const text = buildAlertMessage(
      target,
      { event: "backup_failed", status: "failed", errorCode: "TUNNEL_FAILED", errorMessage: "tunnel did not come up" },
      at,
      BASE,
    );
    expect(text).toBe(
      [
        "[Cellar] Backup failed",
        "Target: shop-prod",
        "Project: shop",
        "Time: 2026-10-24 14:05 Asia/Bangkok",
        "Error: TUNNEL_FAILED: tunnel did not come up",
        "https://cellar.example.com/targets/0192f000-0000-7000-8000-000000000001",
      ].join("\n"),
    );
  });

  it("titles timed_out, consecutive failures, and stale", () => {
    const failed = { errorCode: null, errorMessage: null };
    expect(buildAlertMessage(target, { event: "backup_failed", status: "timed_out", ...failed }, at, BASE)).toContain("Backup timed out");
    expect(buildAlertMessage(target, { event: "backup_consecutive_failures", count: 3, ...failed }, at, BASE)).toContain(
      "3 consecutive backup failures",
    );
    const stale = buildAlertMessage(target, { event: "backup_stale", staleAfterHours: 26, lastSuccessAt: null }, at, BASE);
    expect(stale).toContain("No successful backup in 26 h");
    expect(stale).toContain("Last success: never");
  });

  it("omits the project line when there is no tag", () => {
    const text = buildAlertMessage({ ...target, projectTag: null }, { event: "backup_stale", staleAfterHours: 26, lastSuccessAt: at }, at, BASE);
    expect(text).not.toContain("Project:");
    expect(text).toContain("Last success: 2026-10-24 14:05 Asia/Bangkok");
  });

  it("never contains connection URLs or passwords", () => {
    const text = buildAlertMessage(
      target,
      { event: "backup_failed", status: "failed", errorCode: "DUMP_FAILED", errorMessage: `could not connect: ${SECRET_URL} ${SECRET_PAIR}` },
      at,
      BASE,
    );
    expect(text).not.toContain("Sup3rS3cretPw");
    expect(text).not.toContain("hunter2");
    expect(text).toContain("postgres://app:***@db.internal");
  });
});

describe("targetLink", () => {
  it("joins without a double slash", () => {
    expect(targetLink("https://cellar.example.com///", "abc")).toBe("https://cellar.example.com/targets/abc");
  });
});
```
- [ ] Step 3: Verify - Run: `bun run test test/worker/alerts/message.test.ts` - Expected: 11 pass, 0 fail
- [ ] Step 4: Verify - Run: `bun run typecheck` - Expected: no new errors
- [ ] Step 5: Commit - `git add src/worker/alerts/message.ts test/worker/alerts/message.test.ts && git commit -m "feat(alerts): message builder with redacted error summary"`

---

### Task 5: LINE and Discord senders

**Files:**
- Create: `src/worker/alerts/types.ts`, `src/worker/alerts/line.ts`, `src/worker/alerts/discord.ts`
- Test: `test/worker/alerts/senders.test.ts`

**Interfaces:**
- Consumes: `LineCredential`, `DiscordCredential` from `src/shared/alerts.ts` (Task 1); `truncate` from `src/worker/alerts/message.ts` (Task 4).
- Produces: `type DeliveryResult = { ok: true } | { ok: false; error: string }` in `types.ts`; `sendLine(credential: LineCredential, text: string): Promise<DeliveryResult>`; `sendDiscord(credential: DiscordCredential, text: string): Promise<DeliveryResult>`. Both never throw and never include the token or webhook URL in `error`.

**Gotcha:** `allowed_mentions: { parse: [] }` stops `@everyone` or role pings if an error message ever contains one. The senders catch every exception and return a fixed string, because a thrown `fetch` error message may contain the request URL (the Discord webhook URL is a secret).

**Steps:**
- [ ] Step 1: Create `src/worker/alerts/types.ts`:
```ts
export type DeliveryResult = { ok: true } | { ok: false; error: string };
```
- [ ] Step 2: Create `src/worker/alerts/line.ts` (run in scratch):
```ts
import type { LineCredential } from "../../shared/alerts";
import { truncate } from "./message";
import type { DeliveryResult } from "./types";

const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_TEXT_MAX = 5000;

export async function sendLine(credential: LineCredential, text: string): Promise<DeliveryResult> {
  try {
    const response = await fetch(LINE_PUSH_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" },
      body: JSON.stringify({ to: credential.to, messages: [{ type: "text", text: truncate(text, LINE_TEXT_MAX) }] }),
    });
    return response.ok ? { ok: true } : { ok: false, error: `LINE API returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "LINE request failed (network error)" };
  }
}
```
- [ ] Step 3: Create `src/worker/alerts/discord.ts` (run in scratch):
```ts
import type { DiscordCredential } from "../../shared/alerts";
import { truncate } from "./message";
import type { DeliveryResult } from "./types";

const DISCORD_CONTENT_MAX = 2000;

export async function sendDiscord(credential: DiscordCredential, text: string): Promise<DeliveryResult> {
  try {
    const response = await fetch(credential.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: truncate(text, DISCORD_CONTENT_MAX),
        allowed_mentions: { parse: [] },
      }),
    });
    return response.ok ? { ok: true } : { ok: false, error: `Discord webhook returned HTTP ${response.status}` };
  } catch {
    return { ok: false, error: "Discord request failed (network error)" };
  }
}
```
- [ ] Step 4: Create `test/worker/alerts/senders.test.ts` (run in scratch, 6 tests; asserts the exact LINE and Discord request shapes):
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendDiscord } from "../../../src/worker/alerts/discord";
import { sendLine } from "../../../src/worker/alerts/line";

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL";

afterEach(() => vi.restoreAllMocks());

function mockFetch(response: Response | Error) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
}

describe("sendLine", () => {
  it("posts the LINE push payload", async () => {
    const spy = mockFetch(new Response("{}", { status: 200 }));
    const result = await sendLine({ token: "line-token-xyz", to: "U1234567890" }, "hello");
    expect(result).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer line-token-xyz", "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ to: "U1234567890", messages: [{ type: "text", text: "hello" }] });
  });

  it("caps the text at 5000 UTF-16 units", async () => {
    const spy = mockFetch(new Response("{}", { status: 200 }));
    await sendLine({ token: "t", to: "U1" }, "x".repeat(9000));
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.messages[0].text.length).toBe(5000);
  });

  it("returns an error without the token on HTTP failure and on network failure", async () => {
    mockFetch(new Response(JSON.stringify({ message: "Authentication failed" }), { status: 401 }));
    const http = await sendLine({ token: "line-token-xyz", to: "U1" }, "hi");
    expect(http).toEqual({ ok: false, error: "LINE API returned HTTP 401" });
    vi.restoreAllMocks();
    mockFetch(new Error("connect failed to api.line.me with line-token-xyz"));
    const net = await sendLine({ token: "line-token-xyz", to: "U1" }, "hi");
    expect(net).toEqual({ ok: false, error: "LINE request failed (network error)" });
  });
});

describe("sendDiscord", () => {
  it("posts the webhook payload and suppresses mentions", async () => {
    const spy = mockFetch(new Response(null, { status: 204 }));
    const result = await sendDiscord({ webhookUrl: WEBHOOK }, "hello");
    expect(result).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ content: "hello", allowed_mentions: { parse: [] } });
  });

  it("caps the content at 2000", async () => {
    const spy = mockFetch(new Response(null, { status: 204 }));
    await sendDiscord({ webhookUrl: WEBHOOK }, "x".repeat(9000));
    const body = JSON.parse((spy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.content.length).toBe(2000);
  });

  it("returns an error without the webhook URL on HTTP failure and on network failure", async () => {
    mockFetch(new Response(JSON.stringify({ message: "Unknown Webhook" }), { status: 404 }));
    const http = await sendDiscord({ webhookUrl: WEBHOOK }, "hi");
    expect(http).toEqual({ ok: false, error: "Discord webhook returned HTTP 404" });
    vi.restoreAllMocks();
    mockFetch(new Error(`failed ${WEBHOOK}`));
    const net = await sendDiscord({ webhookUrl: WEBHOOK }, "hi");
    expect(net).toEqual({ ok: false, error: "Discord request failed (network error)" });
    expect(JSON.stringify(net)).not.toContain("abcDEF");
  });
});
```
- [ ] Step 5: Verify - Run: `bun run test test/worker/alerts/senders.test.ts` - Expected: 6 pass, 0 fail
- [ ] Step 6: Verify - Run: `bun run typecheck` - Expected: no new errors
- [ ] Step 7: Commit - `git add src/worker/alerts/types.ts src/worker/alerts/line.ts src/worker/alerts/discord.ts test/worker/alerts/senders.test.ts && git commit -m "feat(alerts): LINE push and Discord webhook senders"`

---

### Task 6: Channel selection and delivery

**Files:**
- Create: `src/worker/alerts/dispatch.ts`
- Test: `test/worker/alerts/dispatch.test.ts`

**Interfaces:**
- Consumes: `decrypt(payload: string, keyBase64: string): Promise<string>` (Phase 1); `getDb(env: Env)` (Phase 2); `alertChannels`, `targetAlertChannels` tables (Phase 1 schema); `lineCredentialSchema`, `discordCredentialSchema`, `ALERT_EVENTS`, `AlertEvent` (Task 1); `sendLine`, `sendDiscord`, `DeliveryResult` (Task 5); seed helpers (Task 2).
- Produces: `sendToChannel(env: Env, channel: { type: "line" | "discord"; credentialEnc: string }, text: string): Promise<DeliveryResult>` (decrypts, validates, sends; used by Task 9 too); `deliverAlert(env: Env, targetId: string, event: AlertEvent, text: string): Promise<void>` (sends to every enabled channel linked to the target whose `events` JSON includes `event`; never throws).

**Gotcha:** Channels are filtered by event in JS after the query, because `events` is a JSON text column. A malformed `events` value skips that channel instead of failing the batch. The test seeds D1 through `createTestEnv`, which needs the Task 2 migration to be applied by the harness (it applies every file in `migrations/`).

**Steps:**
- [ ] Step 1: Create `src/worker/alerts/dispatch.ts` (run in scratch):
```ts
import { and, eq } from "drizzle-orm";
import {
  type AlertEvent,
  ALERT_EVENTS,
  discordCredentialSchema,
  lineCredentialSchema,
} from "../../shared/alerts";
import { getDb } from "../db/client";
import { alertChannels, targetAlertChannels } from "../db/schema";
import type { Env } from "../env";
import { decrypt } from "../lib/crypto";
import { sendDiscord } from "./discord";
import { sendLine } from "./line";
import type { DeliveryResult } from "./types";

interface StoredChannel {
  id: string;
  type: "line" | "discord";
  credentialEnc: string;
}

export async function sendToChannel(env: Env, channel: Pick<StoredChannel, "type" | "credentialEnc">, text: string): Promise<DeliveryResult> {
  let credential: unknown;
  try {
    credential = JSON.parse(await decrypt(channel.credentialEnc, env.ENCRYPTION_KEY));
  } catch {
    return { ok: false, error: "stored credential could not be decrypted" };
  }
  if (channel.type === "line") {
    const parsed = lineCredentialSchema.safeParse(credential);
    return parsed.success ? sendLine(parsed.data, text) : { ok: false, error: "stored credential is invalid" };
  }
  const parsed = discordCredentialSchema.safeParse(credential);
  return parsed.success ? sendDiscord(parsed.data, text) : { ok: false, error: "stored credential is invalid" };
}

function subscribes(eventsJson: string, event: AlertEvent): boolean {
  try {
    const events: unknown = JSON.parse(eventsJson);
    return Array.isArray(events) && events.some((e) => e === event && ALERT_EVENTS.includes(e));
  } catch {
    return false;
  }
}

async function channelsFor(env: Env, targetId: string, event: AlertEvent): Promise<StoredChannel[]> {
  const rows = await getDb(env)
    .select({
      id: alertChannels.id,
      type: alertChannels.type,
      credentialEnc: alertChannels.credentialEnc,
      events: alertChannels.events,
    })
    .from(targetAlertChannels)
    .innerJoin(alertChannels, eq(targetAlertChannels.channelId, alertChannels.id))
    .where(and(eq(targetAlertChannels.targetId, targetId), eq(alertChannels.enabled, true)));
  return rows.filter((row) => subscribes(row.events, event));
}

/** Sends `text` to every enabled channel linked to the target that subscribes to `event`. Never throws. */
export async function deliverAlert(env: Env, targetId: string, event: AlertEvent, text: string): Promise<void> {
  try {
    const channels = await channelsFor(env, targetId, event);
    await Promise.all(
      channels.map(async (channel) => {
        const result = await sendToChannel(env, channel, text);
        if (!result.ok) {
          console.warn(JSON.stringify({ msg: "alert delivery failed", channelId: channel.id, type: channel.type, event, error: result.error }));
        }
      }),
    );
  } catch {
    console.warn(JSON.stringify({ msg: "alert delivery crashed", targetId, event }));
  }
}
```
- [ ] Step 2: Create `test/worker/alerts/dispatch.test.ts` (run in scratch, 5 tests):
```ts
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { deliverAlert, sendToChannel } from "../../../src/worker/alerts/dispatch";
import type { Env } from "../../../src/worker/env";
import { encrypt } from "../../../src/worker/lib/crypto";
import { createTestEnv } from "../../helpers/env";
import { seedChannel, seedTarget, WEBHOOK } from "../../helpers/alerts-seed";

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
  await seedTarget(env, "t1");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

describe("deliverAlert", () => {
  it("uses only enabled, linked channels that subscribe to the event", async () => {
    await seedChannel(env, "ok", "t1");
    await seedChannel(env, "off", "t1", { enabled: false });
    await seedChannel(env, "other-event", "t1", { events: ["backup_stale"] });
    await seedChannel(env, "unlinked", null);
    await seedTarget(env, "t2");
    await seedChannel(env, "other-target", "t2");
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends to LINE and Discord channels in the same call", async () => {
    await seedChannel(env, "d", "t1");
    await seedChannel(env, "l", "t1", { type: "line" });
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy.mock.calls.map((c: Parameters<typeof fetch>) => String(c[0])).sort()).toEqual(["https://api.line.me/v2/bot/message/push", WEBHOOK]);
  });

  it("skips a channel whose events JSON is malformed", async () => {
    await seedChannel(env, "bad", "t1");
    await env.DB.prepare("UPDATE alert_channels SET events = 'not json' WHERE id = 'bad'").run();
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("one failing channel does not stop the others, and the log has no credential", async () => {
    await seedChannel(env, "d", "t1");
    await seedChannel(env, "l", "t1", { type: "line", credential: { token: "line-token-xyz", to: "U1234567890" } });
    fetchSpy.mockImplementation(async (url) => (String(url).includes("line.me") ? new Response("{}", { status: 401 }) : new Response(null, { status: 204 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliverAlert(env, "t1", "backup_failed", "hello");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("alert delivery failed");
    expect(logged).toContain("LINE API returned HTTP 401");
    expect(logged).not.toContain("line-token-xyz");
  });
});

describe("sendToChannel", () => {
  it("reports an undecryptable or invalid stored credential without sending", async () => {
    const garbage = await sendToChannel(env, { type: "line", credentialEnc: "v1:AAAA:BBBB" }, "hi");
    expect(garbage).toEqual({ ok: false, error: "stored credential could not be decrypted" });
    const wrongShape = await encrypt(JSON.stringify({ webhookUrl: "https://evil.example.com/x" }), env.ENCRYPTION_KEY);
    const invalid = await sendToChannel(env, { type: "discord", credentialEnc: wrongShape }, "hi");
    expect(invalid).toEqual({ ok: false, error: "stored credential is invalid" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```
- [ ] Step 3: Verify - Run: `bun run test test/worker/alerts/dispatch.test.ts` - Expected: 5 pass, 0 fail
- [ ] Step 4: Verify - Run: `bun run typecheck` - Expected: no new errors
- [ ] Step 5: Commit - `git add src/worker/alerts/dispatch.ts test/worker/alerts/dispatch.test.ts && git commit -m "feat(alerts): deliver alerts to linked, enabled, subscribed channels"`

---

### Task 7: Backup outcome hook and failure episodes

**Files:**
- Create: `src/worker/alerts/notify.ts`
- Test: `test/worker/alerts/notify.test.ts`

**Interfaces:**
- Consumes: `getDb`, `backups`, `targets` (with Task 2 columns), `deliverAlert` (Task 6), `buildAlertMessage`, `AlertTarget` (Task 4), `redactError` (Phase 1), `Env.APP_BASE_URL` (Task 3), seed helpers (Task 2).
- Produces: `notifyBackupFinished(env: Env, backupId: string): Promise<void>` - call once per backup, right after its row reaches a terminal status. Never throws. `afterResponse(c: { readonly executionCtx: Pick<ExecutionContext, "waitUntil"> }, task: Promise<void>): Promise<void>` - Task 10 uses both.
Contract for callers (Task 10): call `notifyBackupFinished` only when the conditional status UPDATE changed exactly one row, so a replayed callback cannot increment the counter twice.

**Gotcha:** The claim `UPDATE ... WHERE failure_alerted_at IS NULL ... RETURNING` is what makes the consecutive alert fire once; do not replace it with a read-then-write. `afterResponse` exists because Hono's `c.executionCtx` getter throws when `app.request` is called without a context, which every route test does.

**Steps:**
- [ ] Step 1: Create `src/worker/alerts/notify.ts` (run in scratch). Episode rules, all enforced in SQL so two overlapping callbacks cannot double-fire:
  - success: `consecutive_failures = 0`, `failure_alerted_at = NULL`, `stale_alerted_at = NULL`.
  - failed or timed_out: `consecutive_failures + 1` with `RETURNING`; send `backup_failed` every time; if the new count reaches `alert_failure_threshold`, claim `failure_alerted_at` with `WHERE failure_alerted_at IS NULL RETURNING id` and send `backup_consecutive_failures` only if the claim returned a row.
  - any other status (queued, running) and unknown ids do nothing.
```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { backups, targets } from "../db/schema";
import type { Env } from "../env";
import { redactError } from "../lib/redact";
import { deliverAlert } from "./dispatch";
import { type AlertTarget, buildAlertMessage } from "./message";

/**
 * Call once per backup, right after its row reaches a terminal status (success, failed, timed_out).
 * Updates the failure episode state on the target and sends alerts. Never throws.
 */
export async function notifyBackupFinished(env: Env, backupId: string): Promise<void> {
  try {
    await handleBackupFinished(env, backupId);
  } catch (error) {
    console.warn(JSON.stringify({ msg: "alert processing failed", backupId, error: redactError(error) }));
  }
}

/**
 * Runs `task` after the response when an execution context exists. Hono throws on `c.executionCtx`
 * when the app was called without one (as route tests do), so the task is returned to be awaited then.
 */
export function afterResponse(c: { readonly executionCtx: Pick<ExecutionContext, "waitUntil"> }, task: Promise<void>): Promise<void> {
  try {
    c.executionCtx.waitUntil(task);
    return Promise.resolve();
  } catch {
    return task;
  }
}

async function handleBackupFinished(env: Env, backupId: string): Promise<void> {
  const db = getDb(env);
  const row = await db
    .select({
      status: backups.status,
      errorCode: backups.errorCode,
      errorMessage: backups.errorMessage,
      finishedAt: backups.finishedAt,
      targetId: targets.id,
      name: targets.name,
      projectTag: targets.projectTag,
      timezone: targets.timezone,
    })
    .from(backups)
    .innerJoin(targets, eq(backups.targetId, targets.id))
    .where(eq(backups.id, backupId))
    .get();
  if (!row) return;

  if (row.status === "success") {
    await db
      .update(targets)
      .set({ consecutiveFailures: 0, failureAlertedAt: null, staleAlertedAt: null })
      .where(eq(targets.id, row.targetId));
    return;
  }
  if (row.status !== "failed" && row.status !== "timed_out") return;

  const target: AlertTarget = { id: row.targetId, name: row.name, projectTag: row.projectTag, timezone: row.timezone };
  const at = row.finishedAt ? new Date(row.finishedAt) : new Date();
  const [counter] = await db
    .update(targets)
    .set({ consecutiveFailures: sql`${targets.consecutiveFailures} + 1` })
    .where(eq(targets.id, row.targetId))
    .returning({ count: targets.consecutiveFailures, threshold: targets.alertFailureThreshold });
  if (!counter) return;

  const error = { errorCode: row.errorCode, errorMessage: row.errorMessage };
  await deliverAlert(
    env,
    target.id,
    "backup_failed",
    buildAlertMessage(target, { event: "backup_failed", status: row.status, ...error }, at, env.APP_BASE_URL),
  );

  if (counter.count < counter.threshold) return;
  const claimed = await db
    .update(targets)
    .set({ failureAlertedAt: at.toISOString() })
    .where(and(eq(targets.id, target.id), isNull(targets.failureAlertedAt)))
    .returning({ id: targets.id });
  if (claimed.length === 0) return;
  await deliverAlert(
    env,
    target.id,
    "backup_consecutive_failures",
    buildAlertMessage(target, { event: "backup_consecutive_failures", count: counter.count, ...error }, at, env.APP_BASE_URL),
  );
}
```
- [ ] Step 2: Create `test/worker/alerts/notify.test.ts` (run in scratch, 12 tests; includes the exactly-once-per-episode test, the real-looking-secret test, and the never-throws tests):
```ts
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { afterResponse, notifyBackupFinished } from "../../../src/worker/alerts/notify";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedChannel, seedTarget, targetRow } from "../../helpers/alerts-seed";
import type { Env } from "../../../src/worker/env";

const SECRET_URL = "postgres://app:Sup3rS3cretPw@db.internal:5432/shop";
let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;
let n = 0;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
  await seedTarget(env, "t1", { name: "shop-prod", project_tag: "shop" });
  await seedChannel(env, "c1", "t1");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

async function finish(status: string, over: Record<string, unknown> = {}) {
  const id = `b${++n}`;
  await seedBackup(env, id, "t1", status, over);
  await notifyBackupFinished(env, id);
}

function sentTexts(): string[] {
  return fetchSpy.mock.calls.map((call: Parameters<typeof fetch>) => JSON.parse((call[1] as RequestInit).body as string).content as string);
}

describe("notifyBackupFinished", () => {
  it("sends backup_failed on every failure and the consecutive alert exactly once per episode", async () => {
    for (let i = 0; i < 5; i++) await finish("failed", { error_code: "DUMP_FAILED", error_message: "boom" });
    const texts = sentTexts();
    expect(texts.filter((t) => t.includes("Backup failed"))).toHaveLength(5);
    expect(texts.filter((t) => t.includes("consecutive backup failures"))).toHaveLength(1);
    expect(texts.find((t) => t.includes("consecutive"))).toContain("3 consecutive backup failures");
    expect((await targetRow(env, "t1"))?.consecutive_failures).toBe(5);
  });

  it("counts timed_out as a failure and titles it", async () => {
    await finish("timed_out");
    expect(sentTexts()[0]).toContain("Backup timed out");
  });

  it("resets on success and fires a new episode afterwards", async () => {
    for (let i = 0; i < 3; i++) await finish("failed");
    await finish("success");
    expect(await targetRow(env, "t1")).toEqual({ consecutive_failures: 0, failure_alerted_at: null, stale_alerted_at: null });
    fetchSpy.mockClear();
    for (let i = 0; i < 3; i++) await finish("failed");
    expect(sentTexts().filter((t) => t.includes("consecutive backup failures"))).toHaveLength(1);
  });

  it("honours a per-target threshold", async () => {
    await env.DB.prepare("UPDATE targets SET alert_failure_threshold = 1 WHERE id = 't1'").run();
    await finish("failed");
    expect(sentTexts().filter((t) => t.includes("1 consecutive backup failures"))).toHaveLength(1);
  });

  it("success also clears a stale episode", async () => {
    await env.DB.prepare("UPDATE targets SET stale_alerted_at = '2026-10-23T00:00:00.000Z' WHERE id = 't1'").run();
    await finish("success");
    expect((await targetRow(env, "t1"))?.stale_alerted_at).toBeNull();
  });

  it("does nothing for non-terminal rows and unknown ids", async () => {
    await finish("running");
    await notifyBackupFinished(env, "missing");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await targetRow(env, "t1"))?.consecutive_failures).toBe(0);
  });

  it("sends nothing when the target has no linked channel", async () => {
    await seedTarget(env, "t2");
    await seedBackup(env, "bx", "t2", "failed");
    await notifyBackupFinished(env, "bx");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await targetRow(env, "t2"))?.consecutive_failures).toBe(1);
  });

  it("never puts connection URLs or passwords in the delivered message", async () => {
    await finish("failed", { error_code: "DUMP_FAILED", error_message: `could not connect ${SECRET_URL} password=hunter2-hunter2` });
    const text = sentTexts()[0] ?? "";
    expect(text).toContain("postgres://app:***@db.internal");
    expect(text).not.toContain("Sup3rS3cretPw");
    expect(text).not.toContain("hunter2");
  });

  it("never throws when delivery fails, and still updates state", async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error(`down ${"https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL"}`);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(finish("failed")).resolves.toBeUndefined();
    expect((await targetRow(env, "t1"))?.consecutive_failures).toBe(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("abcDEF");
  });

  it("never throws when the database is broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { ...env, DB: {} as D1Database };
    await expect(notifyBackupFinished(broken, "b1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("afterResponse", () => {
  it("hands the task to waitUntil when a context exists", async () => {
    const waitUntil = vi.fn();
    const task = Promise.resolve();
    await afterResponse({ executionCtx: { waitUntil } }, task);
    expect(waitUntil).toHaveBeenCalledWith(task);
  });

  it("returns the task itself when Hono has no context", async () => {
    const { Hono } = await import("hono");
    const app = new Hono<{ Bindings: Env }>();
    let ran = false;
    app.get("/", async (c) => {
      await afterResponse(c, (async () => { ran = true; })());
      return c.text("ok");
    });
    const res = await app.request("http://localhost/", {}, env);
    expect(res.status).toBe(200);
    expect(ran).toBe(true);
  });
});
```
- [ ] Step 3: Verify - Run: `bun run test test/worker/alerts/notify.test.ts` - Expected: 12 pass, 0 fail
- [ ] Step 4: Verify - Run: `bun run typecheck` - Expected: no new errors
- [ ] Step 5: Commit - `git add src/worker/alerts/notify.ts test/worker/alerts/notify.test.ts && git commit -m "feat(alerts): failure episodes and backup outcome hook"`

---

### Task 8: Staleness check

**Files:**
- Create: `src/worker/alerts/staleness.ts`
- Test: `test/worker/alerts/staleness.test.ts`

**Interfaces:**
- Consumes: `approxIntervalMs(expr: string, tz: string, after: Date): number` from `src/shared/cron.ts` (Phase 2); `deliverAlert` (Task 6); `buildAlertMessage` (Task 4); `targets` with `lastBackupAt`, `staleAfterHours`, `staleAlertedAt` (Phase 1 + Task 2); `notifyBackupFinished` (Task 7, used in one test).
- Produces: `staleAfterMs(target: { staleAfterHours: number | null; scheduleCron: string; timezone: string }, now: Date): number`; `checkStaleness(env: Env, now?: Date): Promise<void>` (Task 11 calls it from the cron; never throws).

**Gotcha:** The scratch run used a stand-in `approxIntervalMs` that returns 86400000 for any cron except `* * * * *`. The tests assert `26 h` for `0 2 * * *`; with the real Phase 2 function the daily interval is also 24 h, so the expectation holds. If the real function returns a different gap for that cron, STOP and report.

**Steps:**
- [ ] Step 1: Create `src/worker/alerts/staleness.ts` (run in scratch). One SELECT of enabled, not-deleted targets with `stale_alerted_at IS NULL`; the limit is computed in code per target; the episode is claimed atomically before sending:
```ts
import { and, eq, isNull } from "drizzle-orm";
import { approxIntervalMs } from "../../shared/cron";
import { getDb } from "../db/client";
import { targets } from "../db/schema";
import type { Env } from "../env";
import { redactError } from "../lib/redact";
import { deliverAlert } from "./dispatch";
import { buildAlertMessage } from "./message";

const HOUR_MS = 3_600_000;
const DERIVED_GRACE_MS = 2 * HOUR_MS;

/** Explicit `stale_after_hours`, else the schedule's expected interval plus 2 h (daily = 26 h). */
export function staleAfterMs(
  target: { staleAfterHours: number | null; scheduleCron: string; timezone: string },
  now: Date,
): number {
  if (target.staleAfterHours !== null) return target.staleAfterHours * HOUR_MS;
  return approxIntervalMs(target.scheduleCron, target.timezone, now) + DERIVED_GRACE_MS;
}

/**
 * Alerts once per stale episode: the claim on `stale_alerted_at` is atomic, and a later success
 * (see notifyBackupFinished) clears it. Runs in the per-minute cron; one SELECT when nothing is stale. Never throws.
 */
export async function checkStaleness(env: Env, now: Date = new Date()): Promise<void> {
  try {
    const db = getDb(env);
    const candidates = await db
      .select({
        id: targets.id,
        name: targets.name,
        projectTag: targets.projectTag,
        timezone: targets.timezone,
        scheduleCron: targets.scheduleCron,
        staleAfterHours: targets.staleAfterHours,
        lastBackupAt: targets.lastBackupAt,
        createdAt: targets.createdAt,
      })
      .from(targets)
      .where(and(eq(targets.enabled, true), isNull(targets.deletedAt), isNull(targets.staleAlertedAt)));

    for (const target of candidates) {
      try {
        const reference = new Date(target.lastBackupAt ?? target.createdAt);
        const limitMs = staleAfterMs(target, now);
        if (now.getTime() - reference.getTime() <= limitMs) continue;
        const claimed = await db
          .update(targets)
          .set({ staleAlertedAt: now.toISOString() })
          .where(and(eq(targets.id, target.id), isNull(targets.staleAlertedAt)))
          .returning({ id: targets.id });
        if (claimed.length === 0) continue;
        const text = buildAlertMessage(
          target,
          {
            event: "backup_stale",
            staleAfterHours: Math.round(limitMs / HOUR_MS),
            lastSuccessAt: target.lastBackupAt ? reference : null,
          },
          now,
          env.APP_BASE_URL,
        );
        await deliverAlert(env, target.id, "backup_stale", text);
      } catch (error) {
        console.warn(JSON.stringify({ msg: "staleness check failed for target", targetId: target.id, error: redactError(error) }));
      }
    }
  } catch (error) {
    console.warn(JSON.stringify({ msg: "staleness check failed", error: redactError(error) }));
  }
}
```
- [ ] Step 2: Create `test/worker/alerts/staleness.test.ts` (run in scratch, 9 tests; the time is pinned with an explicit `now`, nothing reads the wall clock):
```ts
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { checkStaleness, staleAfterMs } from "../../../src/worker/alerts/staleness";
import { notifyBackupFinished } from "../../../src/worker/alerts/notify";
import type { Env } from "../../../src/worker/env";
import { createTestEnv } from "../../helpers/env";
import { seedBackup, seedChannel, seedTarget, targetRow } from "../../helpers/alerts-seed";

const HOUR = 3_600_000;
const NOW = new Date("2026-10-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

const texts = () => fetchSpy.mock.calls.map((c: Parameters<typeof fetch>) => JSON.parse((c[1] as RequestInit).body as string).content as string);

describe("staleAfterMs", () => {
  const base = { staleAfterHours: null, scheduleCron: "0 2 * * *", timezone: "Asia/Bangkok" };
  it("uses the explicit hours when set", () => {
    expect(staleAfterMs({ ...base, staleAfterHours: 5 }, NOW)).toBe(5 * HOUR);
  });
  it("derives interval plus 2 h from the schedule (daily = 26 h)", () => {
    expect(staleAfterMs(base, NOW)).toBe(26 * HOUR);
  });
});

describe("checkStaleness", () => {
  beforeEach(async () => {
    await seedTarget(env, "t1", { name: "shop-prod", last_backup_at: hoursAgo(30), created_at: hoursAgo(500) });
    await seedChannel(env, "c1", "t1");
  });

  it("alerts once per stale episode across many ticks", async () => {
    for (let i = 0; i < 5; i++) await checkStaleness(env, new Date(NOW.getTime() + i * 60_000));
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toContain("No successful backup in 26 h");
    expect((await targetRow(env, "t1"))?.stale_alerted_at).toBe(NOW.toISOString());
  });

  it("alerts again only after a success clears the episode", async () => {
    await checkStaleness(env, NOW);
    await seedBackup(env, "ok1", "t1", "success");
    await notifyBackupFinished(env, "ok1");
    await env.DB.prepare("UPDATE targets SET last_backup_at = ? WHERE id = 't1'").bind(hoursAgo(1)).run();
    await checkStaleness(env, NOW);
    expect(texts()).toHaveLength(1);
    const later = new Date(NOW.getTime() + 30 * HOUR);
    await checkStaleness(env, later);
    expect(texts()).toHaveLength(2);
  });

  it("does not alert inside the window, at the exact limit, or for disabled and deleted targets", async () => {
    await seedTarget(env, "fresh", { last_backup_at: hoursAgo(25) });
    await seedTarget(env, "edge", { last_backup_at: hoursAgo(26) });
    await seedTarget(env, "off", { last_backup_at: hoursAgo(99), enabled: 0 });
    await seedTarget(env, "gone", { last_backup_at: hoursAgo(99), deleted_at: hoursAgo(1) });
    for (const id of ["fresh", "edge", "off", "gone"]) await seedChannel(env, `c-${id}`, id);
    await checkStaleness(env, NOW);
    expect(texts()).toHaveLength(1);
  });

  it("measures a never-succeeded target from its creation time", async () => {
    await seedTarget(env, "new", { created_at: hoursAgo(27) });
    await seedChannel(env, "c-new", "new");
    await seedTarget(env, "newer", { created_at: hoursAgo(2) });
    await seedChannel(env, "c-newer", "newer");
    await checkStaleness(env, NOW);
    const sent = texts().filter((t: string) => t.includes("target-new"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Last success: never");
  });

  it("honours a per-target stale_after_hours", async () => {
    await seedTarget(env, "short", { last_backup_at: hoursAgo(3), stale_after_hours: 2 });
    await seedChannel(env, "c-short", "short");
    await checkStaleness(env, NOW);
    expect(texts().some((t: string) => t.includes("target-short") && t.includes("No successful backup in 2 h"))).toBe(true);
  });

  it("marks the episode even when the target has no linked channel", async () => {
    await seedTarget(env, "lonely", { last_backup_at: hoursAgo(99) });
    await checkStaleness(env, NOW);
    expect((await targetRow(env, "lonely"))?.stale_alerted_at).toBe(NOW.toISOString());
  });

  it("never throws when the database is broken", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(checkStaleness({ ...env, DB: {} as D1Database }, NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
```
- [ ] Step 3: Verify - Run: `bun run test test/worker/alerts/staleness.test.ts` - Expected: 9 pass, 0 fail
- [ ] Step 4: Verify - Run: `bun run typecheck` - Expected: no new errors
- [ ] Step 5: Commit - `git add src/worker/alerts/staleness.ts test/worker/alerts/staleness.test.ts && git commit -m "feat(alerts): once-per-episode staleness check"`

---

### Task 9: Alert channel routes

**Files:**
- Create: `src/worker/routes/alert-channels.ts`
- Modify: `src/worker/app.ts` (anchor: `app.use("/api/*", access())`; add the mount after the existing `app.route(...)` lines)
- Test: `test/worker/routes/alert-channels.test.ts`

**Interfaces:**
- Consumes: `AppEnv` (Phase 1), `ApiError` (Phase 2), `parseBody`, `parseQuery` (Phase 2), `writeAudit` (Phase 2), `uuidv7` (Phase 2), `encrypt` (Phase 1), `getDb` (Phase 2), `createChannelSchema`, `updateChannelSchema`, `lineCredentialSchema`, `discordCredentialSchema` (Task 1), `sendToChannel` (Task 6), `buildTestMessage` (Task 4).
- Produces: `alertChannelRoutes: Hono<AppEnv>` mounted at `/api/alert-channels`:
- `GET /` -> `200 { items: Channel[], nextCursor: string | null }`, `?limit` (default 50, max 200), `?cursor` (base64url of the last id), ordered by id ascending (UUIDv7 = creation order).
- `POST /` -> `201 Channel`. Body per `createChannelSchema`.
- `PATCH /:id` -> `200 Channel`. Body per `updateChannelSchema`; `credential` replaces the whole stored credential and is validated against the stored type; the type cannot change; omitted credential keeps the stored one.
- `DELETE /:id` -> `204`. Removes the channel and its `target_alert_channels` rows in one `db.batch`.
- `POST /:id/test` -> `200 { ok: true }` or `200 { ok: false, error: string }`; `404` for an unknown id.
`Channel = { id, type, name, events: string[], enabled, hasCredential: true, createdAt, updatedAt }`. Errors use the register's `{ error: { code, message, details? } }` shape; 404 is `not_found`, validation is `validation_error`.

**Gotcha:** Zod issue messages contain key names, never input values, so they are safe to return in `details`. The scratch app mounted routes under a stand-in `access` that sets `actorEmail`; the real app mounts them after the real `access()`, which is the behavior under test via `DEV_BYPASS`.

**Steps:**
- [ ] Step 1: Create `src/worker/routes/alert-channels.ts` (run in scratch). Pagination is a local 8-line cursor helper. Before keeping it, run `rg -n "nextCursor|decodeCursor|encodeCursor" src/worker/lib`; if Phase 2 exported a shared pagination helper, use it instead and record a `> Deviation:`.
```ts
import { asc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  createChannelSchema,
  discordCredentialSchema,
  lineCredentialSchema,
  updateChannelSchema,
} from "../../shared/alerts";
import { sendToChannel } from "../alerts/dispatch";
import { buildTestMessage } from "../alerts/message";
import { getDb } from "../db/client";
import { alertChannels, targetAlertChannels } from "../db/schema";
import { writeAudit } from "../lib/audit";
import { encrypt } from "../lib/crypto";
import { uuidv7 } from "../lib/uuidv7";
import { parseBody, parseQuery } from "../lib/validate";
import type { AppEnv } from "../middleware/access";
import { ApiError } from "../middleware/error";

type ChannelRow = typeof alertChannels.$inferSelect;

function toResponse(row: ChannelRow) {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    events: JSON.parse(row.events) as string[],
    enabled: row.enabled,
    hasCredential: true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const encodeCursor = (id: string) => btoa(id).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decodeCursor(cursor: string): string {
  try {
    return atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    throw new ApiError(400, "validation_error", "Invalid cursor");
  }
}

const notFound = () => new ApiError(404, "not_found", "Alert channel not found");
const clientIp = (c: { req: { header(name: string): string | undefined } }) => c.req.header("cf-connecting-ip") ?? null;

export const alertChannelRoutes = new Hono<AppEnv>();

alertChannelRoutes.get("/", async (c) => {
  const { limit, cursor } = parseQuery(c, listQuery);
  const rows = await getDb(c.env)
    .select()
    .from(alertChannels)
    .where(cursor ? gt(alertChannels.id, decodeCursor(cursor)) : undefined)
    .orderBy(asc(alertChannels.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return c.json({
    items: page.map(toResponse),
    nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
  });
});

alertChannelRoutes.post("/", async (c) => {
  const body = await parseBody(c, createChannelSchema);
  const now = new Date().toISOString();
  const [row] = await getDb(c.env)
    .insert(alertChannels)
    .values({
      id: uuidv7(),
      type: body.type,
      name: body.name,
      credentialEnc: await encrypt(JSON.stringify(body.credential), c.env.ENCRYPTION_KEY),
      events: JSON.stringify(body.events),
      enabled: body.enabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new ApiError(500, "internal_error", "Insert returned no row");
  await writeAudit(getDb(c.env), {
    actor: c.get("actorEmail"),
    action: "alert_channel.create",
    entityType: "alert_channel",
    entityId: row.id,
    details: { type: row.type, name: row.name, events: body.events, enabled: row.enabled },
    ip: clientIp(c),
  });
  return c.json(toResponse(row), 201);
});

alertChannelRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c, updateChannelSchema);
  const db = getDb(c.env);
  const existing = await db.select().from(alertChannels).where(eq(alertChannels.id, id)).get();
  if (!existing) throw notFound();

  let credentialEnc: string | undefined;
  if (body.credential !== undefined) {
    const schema = existing.type === "line" ? lineCredentialSchema : discordCredentialSchema;
    const parsed = schema.safeParse(body.credential);
    if (!parsed.success) {
      throw new ApiError(
        400,
        "validation_error",
        `credential does not match a ${existing.type} channel`,
        parsed.error.issues.map((issue) => ({ path: ["credential", ...issue.path].join("."), message: issue.message })),
      );
    }
    credentialEnc = await encrypt(JSON.stringify(parsed.data), c.env.ENCRYPTION_KEY);
  }

  const [row] = await db
    .update(alertChannels)
    .set({
      updatedAt: new Date().toISOString(),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.events !== undefined && { events: JSON.stringify(body.events) }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(credentialEnc !== undefined && { credentialEnc }),
    })
    .where(eq(alertChannels.id, id))
    .returning();
  if (!row) throw notFound();
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "alert_channel.update",
    entityType: "alert_channel",
    entityId: id,
    details: { name: row.name, events: body.events, enabled: row.enabled, credentialChanged: credentialEnc !== undefined },
    ip: clientIp(c),
  });
  return c.json(toResponse(row));
});

alertChannelRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const existing = await db.select().from(alertChannels).where(eq(alertChannels.id, id)).get();
  if (!existing) throw notFound();
  await db.batch([
    db.delete(targetAlertChannels).where(eq(targetAlertChannels.channelId, id)),
    db.delete(alertChannels).where(eq(alertChannels.id, id)),
  ]);
  await writeAudit(db, {
    actor: c.get("actorEmail"),
    action: "alert_channel.delete",
    entityType: "alert_channel",
    entityId: id,
    details: { type: existing.type, name: existing.name },
    ip: clientIp(c),
  });
  return c.body(null, 204);
});

alertChannelRoutes.post("/:id/test", async (c) => {
  const row = await getDb(c.env).select().from(alertChannels).where(eq(alertChannels.id, c.req.param("id"))).get();
  if (!row) throw notFound();
  const result = await sendToChannel(c.env, row, buildTestMessage(row.name, new Date()));
  return c.json(result);
});
```
- [ ] Step 2: Mount it in `src/worker/app.ts`. Add the import `import { alertChannelRoutes } from "./routes/alert-channels";` with the other imports and, after the existing `app.route(...)` lines (and after `app.use("/api/*", access())`):
```ts
app.route("/api/alert-channels", alertChannelRoutes);
```
- [ ] Step 3: Create `test/worker/routes/alert-channels.test.ts` (run in scratch against a stand-in `app`, 9 tests; asserts the full response text never contains the token, the LINE `to` id, or the webhook token, and that the stored ciphertext and audit row do not either). In the repo, the actor on `DEV_BYPASS` is `dev@localhost`, as written:
```ts
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { app } from "../../../src/worker/app";
import type { Env } from "../../../src/worker/env";
import { createTestEnv } from "../../helpers/env";
import { seedChannel, seedTarget, WEBHOOK } from "../../helpers/alerts-seed";

const LINE_TOKEN = "line-token-REALLOOKING-0123456789abcdef";
const SECRETS = [LINE_TOKEN, "U1234567890abcdef", "abcDEF_ghi-JKL"];

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

const call = (method: string, path: string, body?: unknown) =>
  app.request(
    `http://localhost${path}`,
    { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );

const lineBody = { type: "line", name: "Ops LINE", credential: { token: LINE_TOKEN, to: "U1234567890abcdef" } };
const discordBody = { type: "discord", name: "Ops Discord", credential: { webhookUrl: WEBHOOK } };

describe("POST /api/alert-channels", () => {
  it("creates a channel, masks the credential, stores it encrypted, and audits it", async () => {
    const res = await call("POST", "/api/alert-channels", lineBody);
    expect(res.status).toBe(201);
    const text = await res.text();
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    const json = JSON.parse(text);
    expect(json).toMatchObject({ type: "line", name: "Ops LINE", enabled: true, hasCredential: true });
    expect(json.events).toEqual(["backup_failed", "backup_stale", "backup_consecutive_failures"]);

    const stored = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(json.id).first<{ credential_enc: string }>();
    expect(stored?.credential_enc.startsWith("v1:")).toBe(true);
    for (const secret of SECRETS) expect(stored?.credential_enc).not.toContain(secret);

    const audit = await env.DB.prepare("SELECT actor, action, details FROM audit_logs WHERE entity_id = ?").bind(json.id).first<{ actor: string; action: string; details: string }>();
    expect(audit?.action).toBe("alert_channel.create");
    expect(audit?.actor).toBe("dev@localhost");
    for (const secret of SECRETS) expect(audit?.details).not.toContain(secret);
  });

  it("rejects a bad Discord host, a mismatched credential, and unknown events with 400", async () => {
    for (const body of [
      { ...discordBody, credential: { webhookUrl: "https://evil.example.com/api/webhooks/1/tok" } },
      { ...lineBody, credential: { webhookUrl: WEBHOOK } },
      { ...lineBody, events: ["nope"] },
    ]) {
      const res = await call("POST", "/api/alert-channels", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("validation_error");
    }
  });
});

describe("GET /api/alert-channels", () => {
  it("lists with pagination and never returns credentials", async () => {
    for (const name of ["a", "b", "c"]) await call("POST", "/api/alert-channels", { ...discordBody, name });
    const first = await call("GET", "/api/alert-channels?limit=2");
    const firstText = await first.text();
    expect(firstText).not.toContain("abcDEF");
    const page1 = JSON.parse(firstText) as { items: { name: string }[]; nextCursor: string | null };
    expect(page1.items.map((i) => i.name)).toEqual(["a", "b"]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = (await (await call("GET", `/api/alert-channels?limit=2&cursor=${page1.nextCursor}`)).json()) as { items: { name: string }[]; nextCursor: string | null };
    expect(page2.items.map((i) => i.name)).toEqual(["c"]);
    expect(page2.nextCursor).toBeNull();
  });
});

describe("PATCH /api/alert-channels/:id", () => {
  it("updates fields, keeps the credential when omitted, and replaces it when sent", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const before = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();

    const res = await call("PATCH", `/api/alert-channels/${created.id}`, { enabled: false, events: ["backup_failed"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, events: ["backup_failed"] });
    const same = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();
    expect(same?.credential_enc).toBe(before?.credential_enc);

    const newUrl = "https://discord.com/api/webhooks/987654321098765432/NEWtoken_123";
    await call("PATCH", `/api/alert-channels/${created.id}`, { credential: { webhookUrl: newUrl } });
    const after = await env.DB.prepare("SELECT credential_enc FROM alert_channels WHERE id = ?").bind(created.id).first<{ credential_enc: string }>();
    expect(after?.credential_enc).not.toBe(before?.credential_enc);
  });

  it("rejects a credential of the wrong shape for the stored type and an unknown id", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const bad = await call("PATCH", `/api/alert-channels/${created.id}`, { credential: { token: "t", to: "U" } });
    expect(bad.status).toBe(400);
    expect((await call("PATCH", "/api/alert-channels/missing", { enabled: true })).status).toBe(404);
  });
});

describe("DELETE /api/alert-channels/:id", () => {
  it("removes the channel and its target links", async () => {
    await seedTarget(env, "t1");
    await seedChannel(env, "c1", "t1");
    expect((await call("DELETE", "/api/alert-channels/c1")).status).toBe(204);
    const channels = await env.DB.prepare("SELECT count(*) AS n FROM alert_channels").first<{ n: number }>();
    const links = await env.DB.prepare("SELECT count(*) AS n FROM target_alert_channels").first<{ n: number }>();
    expect([channels?.n, links?.n]).toEqual([0, 0]);
    expect((await call("DELETE", "/api/alert-channels/c1")).status).toBe(404);
  });
});

describe("POST /api/alert-channels/:id/test", () => {
  it("sends a test message and reports ok", async () => {
    const created = (await (await call("POST", "/api/alert-channels", discordBody)).json()) as { id: string };
    const res = await call("POST", `/api/alert-channels/${created.id}/test`);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string).content).toContain("[Cellar] Test message");
  });

  it("reports a failed delivery without leaking the credential", async () => {
    const created = (await (await call("POST", "/api/alert-channels", lineBody)).json()) as { id: string };
    fetchSpy.mockImplementation(async () => new Response("{}", { status: 401 }));
    const res = await call("POST", `/api/alert-channels/${created.id}/test`);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "LINE API returned HTTP 401" });
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  });

  it("returns 404 for an unknown channel", async () => {
    expect((await call("POST", "/api/alert-channels/missing/test")).status).toBe(404);
  });
});
```
- [ ] Step 4: Verify - Run: `bun run test test/worker/routes/alert-channels.test.ts` - Expected: 9 pass, 0 fail
- [ ] Step 5: Verify - Run: `bun run typecheck && bun run test` - Expected: typecheck 0 new errors; full suite passes
- [ ] Step 6: Commit - `git add src/worker/routes/alert-channels.ts src/worker/app.ts test/worker/routes/alert-channels.test.ts && git commit -m "feat(alerts): alert channel CRUD and test-send routes"`

---

### Task 10: Wire the hook into every terminal backup transition

**Files:**
- Modify: the Phase 5 files that move a `backups` row to `success`, `failed`, or `timed_out`. Expected per `docs/PLAN.md` section 2 (planned): `src/worker/jobs/callback.ts`, `src/worker/jobs/sweeper.ts`, `src/worker/jobs/consumer.ts`. The grep in Step 1 is authoritative; if the names differ, use what it finds and note a `> Deviation:`.
- Modify (tests): the existing Phase 5 test files for those modules, found by `rg -l "internal/jobs/callback|sweep" test` (planned: `test/worker/jobs/callback.test.ts`, `test/worker/jobs/sweeper.test.ts`). One new test per site, using each file's own request signer and fixtures.

**Interfaces:**
- Consumes: `notifyBackupFinished(env: Env, backupId: string): Promise<void>` and `afterResponse(c, task)` (Task 7). From Phase 5 (planned): a callback handler that applies terminal events with a conditional UPDATE (`... WHERE status IN ('queued','running')`) and can tell how many rows changed; a sweeper that sets `timed_out` and `failed` with `error_code = 'queue_timeout'`; a queue consumer that sets `failed` when the container cannot start.
- Produces: Every terminal transition of a `backups` row calls the hook exactly once. No new exports.

**Gotcha:** This task edits files from Phase 5 that this plan has not seen. It is the largest unknown in the plan. Keep each edit to one or two lines and one test; do not refactor Phase 5. `last_backup_at` ordering matters only for the staleness reference; the failure and success counters do not read it.

**Steps:**
- [ ] Step 1: Find every site. Run: `rg -n "\"(success|failed|timed_out)\"" src/worker --glob "!*.test.ts" | rg -i "status"` and read each hit. A site is any code that writes one of those three values to `backups.status`. Write the list in the commit message body. Ignore sites that write `connection_tests` or `restores` (not backups).
- [ ] Step 2: At each site, after the conditional UPDATE that changed a row, add the call. Never call it when the UPDATE changed zero rows (an ignored duplicate or replayed event).
  - Hono route (the HTTP callback). Import `afterResponse, notifyBackupFinished` from `../alerts/notify`:
```ts
if (applied) await afterResponse(c, notifyBackupFinished(c.env, backupId));
```
  - Sweeper, queue consumer, or any non-HTTP site that has `env`:
```ts
if (applied) await notifyBackupFinished(env, backupId);
```
  `applied` stands for whatever the existing code uses to know the UPDATE changed a row (for Drizzle D1 usually `.returning({ id })` length or `meta.changes`). Do not add a second read to compute it. If the existing code cannot tell, STOP and report, because Phase 5 promised idempotent terminal transitions.
- [ ] Step 3: For `success` sites the hook only resets the episode counters. It must run after `targets.last_backup_at` has been updated, never before. Check the order in the code.
- [ ] Step 4: Add one test per site to the existing Phase 5 test files (reuse their signer and fixtures; do not write new ones):
  - Callback: seed a channel (`seedChannel(env, "c1", targetId)`) linked to the callback test's target, spy on `fetch` returning `204`, send a valid signed `failed` callback. Expect exactly 1 fetch call to the Discord webhook, `consecutive_failures = 1` in `targets`, and the HTTP response still 200. Send the same callback again (replay): expect still 1 fetch call and `consecutive_failures = 1`.
  - Callback with a throwing sender: make the `fetch` spy reject. Expect the callback response is still 200 and the backup row is `failed` (alerts never fail the flow).
  - Sweeper: seed a `running` backup past its deadline, run the sweeper, expect the row is `timed_out`, exactly 1 fetch call whose body contains `Backup timed out`.
  - Consumer start failure (and the `queue_timeout` branch of the sweeper, if separate): expect 1 fetch call containing `Backup failed`.
- [ ] Step 5: Verify - Run: `rg -n "notifyBackupFinished" src/worker --glob "!*.test.ts"` - Expected: one hit per site listed in Step 1 (plus the definition and import lines); no terminal-status write is left without a call
- [ ] Step 6: Verify - Run: `bun run test && bun run typecheck` - Expected: every test passes (the full suite, including the new site tests); typecheck 0 new errors
- [ ] Step 7: Commit - `git add -A src/worker test/worker && git commit -m "feat(alerts): call the alert hook on every terminal backup transition"` (stage only the files you changed; check `git status --short` first)

---

### Task 11: Run the staleness check from the cron

**Files:**
- Modify: `src/worker/index.ts` (anchor: the `scheduled` handler; the call goes after the sweeper call)
- Test: `test/worker/alerts/cron-staleness.test.ts`

**Interfaces:**
- Consumes: `checkStaleness(env: Env, now?: Date): Promise<void>` (Task 8); the default export of `src/worker/index.ts` with a `scheduled(controller, env, ctx)` handler (Phase 5, planned); seed helpers (Task 2).
- Produces: The per-minute cron checks staleness after enqueueing due targets and sweeping. No new exports.

**Gotcha:** Awaiting the check inside the handler keeps it in the same cron invocation, so a slow webhook only delays the end of that tick. Because the claim is atomic and the candidate filter excludes already-alerted targets, overlapping ticks cannot double-send.

**Steps:**
- [ ] Step 1: In `src/worker/index.ts`, import `checkStaleness` from `./alerts/staleness` and add, after the sweeper call and before any retention call that Phase 6 added:
```ts
await checkStaleness(env, new Date(controller.scheduledTime));
```
Use the real parameter names of the handler (`controller` or `event`). `checkStaleness` never throws, so it cannot stop later cron work.
- [ ] Step 2: Create `test/worker/alerts/cron-staleness.test.ts` (not run in scratch). It drives the real `scheduled` handler:
```ts
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import worker from "../../../src/worker/index";
import type { Env } from "../../../src/worker/env";
import { createTestEnv } from "../../helpers/env";
import { seedChannel, seedTarget, targetRow } from "../../helpers/alerts-seed";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

let env: Env;
let dispose: () => Promise<void>;
let fetchSpy: MockInstance<typeof fetch>;

beforeEach(async () => {
  ({ env, dispose } = await createTestEnv());
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(null, { status: 204 }));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await dispose();
});

async function tick(at: Date) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const controller = { scheduledTime: at.getTime(), cron: "* * * * *", noRetry() {} } as ScheduledController;
  await worker.scheduled?.(controller, env, ctx);
  await Promise.all(pending);
}

describe("scheduled handler", () => {
  it("sends one stale alert across repeated ticks", async () => {
    await seedTarget(env, "t1", { last_backup_at: hoursAgo(30), created_at: hoursAgo(500) });
    await seedChannel(env, "c1", "t1");
    await tick(NOW);
    await tick(new Date(NOW.getTime() + 60_000));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await targetRow(env, "t1"))?.stale_alerted_at).not.toBeNull();
  });

  it("sends nothing for a target with a recent success", async () => {
    await seedTarget(env, "t1", { last_backup_at: hoursAgo(1), created_at: hoursAgo(500) });
    await seedChannel(env, "c1", "t1");
    await tick(NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```
If `worker.scheduled` is typed as possibly undefined, the `?.` handles it; if the handler needs bindings the test env lacks (for example the container namespace), pass them through `createTestEnv({ ... })` overrides and note a `> Deviation:`.
- [ ] Step 3: Verify - Run: `bun run test test/worker/alerts/cron-staleness.test.ts` - Expected: 2 pass, 0 fail
- [ ] Step 4: Verify - Run: `bun run test && bun run typecheck` - Expected: all pass; typecheck 0 new errors
- [ ] Step 5: Commit - `git add src/worker/index.ts test/worker/alerts/cron-staleness.test.ts && git commit -m "feat(alerts): check staleness in the per-minute cron"`

---

### Task 12: Alerts documentation

**Files:**
- Create: `docs/alerts.md`

**Interfaces:**
- Consumes: Behavior from Tasks 1 to 12.
- Produces: `docs/alerts.md`, which Phase 10 links from the README.

**Steps:**
- [ ] Step 1: Create `docs/alerts.md` with the content below (one sentence per line):
```markdown
# Alerts

Cellar sends alerts to LINE and Discord when a backup needs attention.

## Events

- `backup_failed`: a backup ended as `failed` or `timed_out`. Sent on every failure.
- `backup_consecutive_failures`: a target reached N failures in a row (default 3, set per target on the target form or API). Sent once. A success resets the count and re-arms the alert.
- `backup_stale`: a target has no successful backup within its stale limit. Sent once per stale episode. The next success re-arms it.
- `retention_failed` and `restore_finished` can be selected on a channel, but Cellar does not send them yet.

On the Nth failure a channel that listens to both `backup_failed` and `backup_consecutive_failures` gets two messages.

## Who receives alerts

A target sends alerts only to channels that are linked to it, enabled, and subscribed to the event.
A target with no linked channel gets no alerts.
Link channels to a target on the target form.

## Stale limit

Set `stale_after_hours` on the target (target form or API) to choose the limit.
If it is empty, Cellar uses the expected gap between runs of the schedule plus 2 hours.
A daily schedule gives 26 hours.
A target that never succeeded is measured from its creation time.
Disabled and deleted targets are never checked.

## Channels

Create channels under Settings, or with `POST /api/alert-channels`.
Credentials are encrypted and cannot be read back.
Use `POST /api/alert-channels/:id/test` to send a test message.

### LINE

Needs a Messaging API channel access token and the id of the user, group, or room to message (`to`).
The account must be allowed to push to that id (the user added the account as a friend, or the account joined the group).
Cellar uses the push message endpoint.
Push messages count against the account's monthly message quota [uncertain: check your LINE plan].

### Discord

Needs a channel webhook URL (Channel settings, Integrations, Webhooks).
Only URLs that start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/` are accepted.
Mentions in messages are disabled.

## Message

Each message has the target name, project tag, the event, a redacted error summary, the time in the target's timezone, and a link to `${APP_BASE_URL}/targets/<id>`.
Set `APP_BASE_URL` in `wrangler.jsonc` `vars` (and `.dev.vars` locally).

## Failures

If LINE or Discord rejects a message, Cellar writes one log line with the channel id and the HTTP status.
It never retries and never fails the backup because of an alert.
Logs never contain tokens, webhook URLs, or connection strings.
```
- [ ] Step 2: Verify - Run: `rg -n "\x{2014}" docs/alerts.md; rg -n "APP_BASE_URL" docs/alerts.md .dev.vars.example wrangler.jsonc | wc -l` - Expected: the first command prints nothing (no em dash found, exit 1); the second prints a number of 3 or more
- [ ] Step 3: Commit - `git add docs/alerts.md && git commit -m "docs(alerts): events, rules, and channel setup"`

---

### Task 13: Update docs/PLAN.md and close the phase

**Files:**
- Modify: `docs/PLAN.md` (edits listed below; if Phase 1 Task 6 or other phases already changed a nearby sentence, edit the current text, not the original)

**Interfaces:**
- Consumes: The final state of Tasks 1 to 13.
- Produces: `docs/PLAN.md` matches the code. The phase summary.

**Steps:**
- [ ] Step 1: Edit `docs/PLAN.md` section 2 (repo structure). Replace the `alerts/  line.ts  discord.ts  staleness.ts` line with `alerts/  message.ts  types.ts  line.ts  discord.ts  dispatch.ts  notify.ts  staleness.ts`. Replace `routes/ ... alerts.ts ...` with `alert-channels.ts`. Add `shared/alerts.ts` (shared Zod schemas and event names).
- [ ] Step 2: Edit section 3, `targets` table: `alert_failure_threshold` is already there (Phase 1, round 2). Add rows `consecutive_failures | integer NOT NULL DEFAULT 0 | reset by a success`, `failure_alerted_at | text | set when the N-in-a-row alert fired; cleared by a success`, `stale_alerted_at | text | set when the stale alert fired; cleared by a success`.
- [ ] Step 3: Edit section 3, `alert_channels` table: `credential_enc` note becomes "JSON encrypted as one string: LINE `{token, to}`, Discord `{webhookUrl}`". Keep the `events` list. If `target_id` is still shown (Phase 1 Task 6 should have removed it), remove it and add "linked to targets through `target_alert_channels`".
- [ ] Step 4: Edit section 4 (API). Replace the single alert-channels row with: `GET /api/alert-channels` (`?limit&cursor`, `{ items, nextCursor }`), `POST /api/alert-channels` (`201`), `PATCH /api/alert-channels/:id`, `DELETE /api/alert-channels/:id` (`204`, hard delete with its links); channel responses show `hasCredential: true`. Change the test row to `POST /api/alert-channels/:id/test` -> `200 { ok } | { ok: false, error }`. Add a note that `alert_failure_threshold` and `stale_after_hours` are edited through target create/update (Phase 2); there is no alert-settings endpoint.
- [ ] Step 5: Edit section 6 (job state machine rules). Replace the staleness bullet and the "On failed or timed_out" bullet with: "On `failed` or `timed_out`, send `backup_failed` every time. When `consecutive_failures` reaches `alert_failure_threshold`, send `backup_consecutive_failures` once until a success. Staleness is checked in the per-minute cron and sent once per stale episode (`stale_alerted_at`); a success resets both episodes. Reference time is `last_backup_at`, else `created_at`. Alert failures are logged and never fail the backup flow."
- [ ] Step 6: Edit section 10 (risks): add "LINE push messages count against the Official Account's monthly quota [uncertain]. Alerts send one message per event per channel."
- [ ] Step 7: Verify - Run: `rg -n "alert_failure_threshold|stale_alerted_at|alert-channels" docs/PLAN.md | wc -l && rg -n "\x{2014}" docs/PLAN.md` - Expected: the first prints 6 or more; the second prints nothing (no em dash; exit 1)
- [ ] Step 8: Verify - Run: `bun run test && bun run typecheck` - Expected: all tests pass (baseline count plus at least 62 new: 60 from Tasks 1 to 9 including the migration test, 2 from Task 11, plus the site tests added in Task 10); typecheck 0 errors
- [ ] Step 9: Commit - `git add docs/PLAN.md && git commit -m "docs: sync PLAN.md with phase 8 alerts"`
- [ ] Step 10: Run the `## End-to-end verification` section, then fill in `## Final summary` and stop.

---

## End-to-end verification

Run after Task 13 Step 9. It needs the Preflight items for the free port and (optionally) network to discord.com.
It uses a fake Discord webhook, so the real Discord answers 401 or 404, and that is the expected outcome.
Variables used below: `PORT=8798`, `LOG=/tmp/cellar-dev-8798.log`.

- [ ] Run: `bun run test && bun run typecheck` - Expected: both exit 0
- [ ] Run: `rg -n "notifyBackupFinished|checkStaleness" src/worker --glob "!*.test.ts"` - Expected: hits in the HTTP callback file, the sweeper, the queue consumer (if it writes terminal statuses), `src/worker/index.ts`, plus the definitions in `src/worker/alerts/`
- [ ] Manual: read every logging call in the new code. Run `rg -n "console\.(log|warn|error)" src/worker/alerts src/worker/routes/alert-channels.ts` - Expected: every hit is `console.warn(JSON.stringify({ msg: "...", ...ids, error: <fixed string or redactError(...)> }))`; none logs a credential, a webhook URL, a request body, or a raw exception message from a send
- [ ] Manual: prepare the local environment. Back up any existing `.dev.vars` (`cp .dev.vars /tmp/dev.vars.bak` if present). Write a throwaway one: `printf 'DEV_BYPASS=true\nENCRYPTION_KEY=%s\nACCESS_TEAM_DOMAIN=team.example.com\nACCESS_AUD=e2e\nAPP_BASE_URL=http://localhost:8798\n' "$(openssl rand -base64 32)" > .dev.vars` (add any other var the current `.dev.vars.example` lists). Then `rm -rf .wrangler/state/v3/d1 && bun run db:migrate:local` - Expected: migrations apply without error
- [ ] Manual: start the dev server in the background: `bash("bun run dev -- --port 8798 --test-scheduled > /tmp/cellar-dev-8798.log 2>&1")`, then poll `curl -sf localhost:8798/api/health` - Expected: `{"ok":true}` within about 30 seconds
- [ ] Manual: create a channel: `curl -s -X POST localhost:8798/api/alert-channels -H 'content-type: application/json' -d '{"type":"discord","name":"e2e","credential":{"webhookUrl":"https://discord.com/api/webhooks/123456789012345678/E2Etoken_abc123"}}'` - Expected: HTTP 201, JSON with `"hasCredential":true` and `"events":["backup_failed","backup_stale","backup_consecutive_failures"]`, and the text `E2Etoken` does not appear. Save the `id` as `CH`
- [ ] Manual: insert a stale, linked target (schedule cron stays the default `0 2 * * *`, so the derived limit is 26 h): `bunx wrangler d1 execute cellar --local --command "INSERT INTO targets (id,name,db_name,connection_url_enc,tunnel_hostname,tunnel_token_id_enc,tunnel_token_secret_enc,project_tag,last_backup_at,created_at,updated_at) VALUES ('e2e-target','e2e-target','shop','x','db.example.com','x','x','demo','$(date -u -v-30H +%Y-%m-%dT%H:%M:%S.000Z)','$(date -u -v-500H +%Y-%m-%dT%H:%M:%S.000Z)','$(date -u -v-500H +%Y-%m-%dT%H:%M:%S.000Z)'); INSERT INTO target_alert_channels (target_id, channel_id) VALUES ('e2e-target','$CH');"` (macOS `date`; on GNU use `date -u -d '30 hours ago' +...`) - Expected: command exits 0
- [ ] Manual: `curl -s "http://localhost:8798/__scheduled?cron=*+*+*+*+*"` then `bunx wrangler d1 execute cellar --local --command "SELECT stale_alerted_at, consecutive_failures FROM targets WHERE id='e2e-target'"` and `grep -c "alert delivery failed" /tmp/cellar-dev-8798.log` - Expected: `stale_alerted_at` is a timestamp, `consecutive_failures` is 0, the grep count is 1, and the line shows `"type":"discord"`, `"event":"backup_stale"`, and an error of `Discord webhook returned HTTP 401` or `HTTP 404` (or `network error` if offline)
- [ ] Manual: repeat the `__scheduled` call twice more, then re-run the SELECT and the grep - Expected: `stale_alerted_at` is unchanged and the grep count is still 1 (one alert per stale episode)
- [ ] Manual: `curl -s -X POST localhost:8798/api/alert-channels/$CH/test` - Expected: `{"ok":false,"error":"Discord webhook returned HTTP 401"}` (or 404, or network error), and `grep -c E2Etoken /tmp/cellar-dev-8798.log` prints `0`
- [ ] Manual: clean up. Stop the dev server (`handle.kill()`), restore `.dev.vars` (`mv /tmp/dev.vars.bak .dev.vars`, or `rm .dev.vars` if there was none), `rm -f /tmp/cellar-dev-8798.log`, `rm -rf .wrangler/state/v3/d1` - Expected: `git status --short` shows no stray files
- [ ] 👤 Human: in your own Discord test server create a webhook, create a `discord` channel with it, call `POST /api/alert-channels/<id>/test`, and confirm the message "[Cellar] Test message" appears. Do the same for a LINE Official Account (channel access token and a user or group id), and confirm the LINE message arrives and the Thai/English text renders. Expected: both messages arrive. - Proxy: Task 5 (`bun run test test/worker/alerts/senders.test.ts`) asserts the exact LINE and Discord request shapes, and Task 9 (`bun run test test/worker/routes/alert-channels.test.ts`) asserts the test route end to end with a mocked `fetch`

What the end-to-end section does not cover: a failure through a real container (needs Docker and the Phase 4 and 5 local setup; Task 10's wiring tests cover the transitions). Run one real failing Backup now in the Phase 5 local setup if Docker is up and confirm one alert log line.

## Final summary

Fill this in after execution, using the AGENTS.md format.

- ✅ Completed: [list the tasks done and the files created, with the real migration file name]
- 🧪 Tests and results: [`bun run test` pass counts (baseline plus at least 62 new), `bun run typecheck` 0 errors, the end-to-end results, and which 👤 item is awaiting human]
- ⚠️ Open issues and decisions needed:
  - No open ASK items. The threshold is edited in Phase 2's target API and the Discord allowlist is the two hosts from round 2.
  - Every `> Deviation:` recorded during execution, in particular any in Task 10 (Phase 5 file names and the way each site knows its UPDATE applied).
  - LINE and Discord request shapes were checked against docs only; the real delivery is the 👤 item above.
  - LINE monthly push quota [uncertain].
