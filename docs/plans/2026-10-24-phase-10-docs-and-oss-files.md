# Phase 10: Docs and OSS Files Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-10-docs-and-oss-files.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE Task 0 and report anything down.
> This plan was written before Phases 2 to 9 exist in the tree.
> Reconciled with the owner's round 2 answers (`docs/plans/2026-10-24-phases-2-10-decisions.md`, binding) on 2026-10-24.
> The scripts in Task 1 and the SQL and YAML in the docs were run in a scratch directory (see "What was run while planning").
> The README edits and the checks against the real code were NOT run against the real tree.
> When a tool rejects a snippet, the tool wins: correct minimally and record a `> Deviation:` line.
> When the real code differs from what a doc sentence says, the CODE wins: fix the doc sentence, record a `> Deviation:` line.

**Goal:** Make `README.md` match the real code, and add `CONTRIBUTING.md`, `SECURITY.md`, `docs/vm-onboarding.md`, `docs/restore-runbook.md`, and `.github/workflows/ci.yml` (`LICENSE` already exists and is only verified), plus `scripts/check-readme.ts`, a docs checker that CI runs.
**Architecture:** Documentation, one CI file, and one docs-check script (`scripts/check-readme.ts`), no product code. The README is edited in place. The cloudflared snippet, the role SQL, and the manual restore steps live in exactly one place (the two new docs), and the README links to them. The committed Bun script `scripts/check-readme.ts` cross-checks every `bun run` script, `wrangler` command, env var, route, resource name, link, and banned string in the docs against `package.json`, `wrangler.jsonc`, `.dev.vars.example`, and `src/`.
**Tech Stack:** Markdown, GitHub Actions YAML, one committed Bun script (`scripts/check-readme.ts`), throwaway Bun helpers in `/tmp`, a local Postgres from Homebrew or the system for SQL checks.
**Spec:** `docs/plans/prds/phase-10.md`, plus `docs/plans/2026-10-24-phases-2-10-decisions.md` (the register, section "Phase 10", and "Owner answers, round 2", which is binding) and `docs/PLAN.md`.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`, planning tree). The tree has only `LICENSE`, `README.md`, `AGENTS.md`, and `docs/`. Phase 1 to 9 code does not exist yet, so every code location below is cited from a plan and marked "(planned, not yet in tree)".
**Confidence:** 6/10. Rubric: start 10, minus 2 (register X18: anchors in files that do not exist yet, counted once), minus 2 (Preflight and Phase gate commands that need Phases 1 to 9 could not be run while planning; only the ones that do not need the tree were run). No other deductions: no `Consumes:` entry lacks a signature, no Human check lacks a proxy, no task touches a schema, and no NOT-building entry cuts a requirement on an unproven codebase claim. Below 7 forces single-track sequential execution, which this plan already uses. Largest uncertainty: documentation sentences that describe Phase 4 to 9 behaviour (callback path, connection URL host, restore confirmation fields, `max_age_days`, dry-run default) are written from the register and PLAN.md. Tasks 5, 6, 7, 8, and 10 each contain an inspect step that compares the sentence with the real code. Round 2 changes no rubric item, so the score stays 6/10.
**NOT building:**
- No product code, no new npm dependency, no `package.json` edit. The only code file is `scripts/check-readme.ts`, run in CI as `bun scripts/check-readme.ts`.
- No new LICENSE: `LICENSE` is already MIT (verified in Task 2). It is not overwritten.
- No API reference section in the README. The README keeps describing the product, and the cross-check script verifies the routes it already mentions.
- No change to the README Roadmap checklist or the "early development" status line.
- No jsdom, no Testing Library, no UI tests (round 2, answer 10).
- No docs site, no changelog, no issue or pull request templates, no code of conduct.
- No documentation of manual backup deletion (`DELETE /api/backups/:id`). The register adds it as an extra and the UI may not expose it.
- No `wrangler deploy`, no remote command, no Cloudflare resource creation, no `git push`.

## ASK list (owner decisions needed)

### Closed by owner (round 2)

- Direct connection mode is removed (answer 1). The docs describe tunnel only. The old ASK A1 and the Q-direct warning are gone.
- Repository URL is `https://github.com/theerakarnm/cellar` (answer 25). The clone URL in `README.md` and `CONTRIBUTING.md` is `https://github.com/theerakarnm/cellar.git`. The old ASK A2 is closed.
- `scripts/check-readme.ts` is committed and runs in CI (answer 26). The old ASK A3 is closed.
- Tagline is "Every Postgres, aged and kept safe." and the Retention sentence is "A backup is kept if" (answer 27). The old ASK A4 is closed.
- Restore: the typed destination target name is always required, and `acknowledgeOverwrite: true` is also required when the destination is the source database (answers 19 and 20). The docs follow this. The old ASK A5 is closed.
- GitHub Actions are approved in principle (answer 11): latest major versions that exist, pinned by commit SHA (see the dependency table).

### Still open

- **A6 (human action, answer 28): GitHub private vulnerability reporting.** `SECURITY.md` tells people to use "Report a vulnerability". The owner enables the repository setting (Settings, Code security). An agent cannot confirm it. See the Human check in Task 2.

These are repeated in the final summary (end of this file).

## Phase gate

Run before Task 0. Phase 10 documents Phases 1 to 9, so every one of them must be finished.
If any item fails, STOP and report: an earlier phase moved.

- [ ] Run: `bun run test && bun run typecheck` - Expected: both exit 0 (baseline green at HEAD of phase 9)
- [ ] Run (files named in the register and the Phase 1 plan, all planned, not yet in tree): `for f in package.json wrangler.jsonc .dev.vars.example bun.lock src/worker/env.ts src/worker/app.ts src/worker/index.ts src/worker/middleware/access.ts src/worker/middleware/error.ts src/worker/lib/crypto.ts src/worker/lib/redact.ts src/worker/lib/audit.ts src/worker/lib/validate.ts src/worker/lib/uuidv7.ts src/worker/lib/s3-presign.ts src/worker/db/schema.ts src/worker/db/client.ts src/shared/tz.ts src/shared/cron.ts src/worker/retention/types.ts src/worker/container/job-runner.ts container/Dockerfile container/hmac.ts test/helpers/env.ts test/docker-compose.test.yml; do test -f "$f" || echo "MISSING $f"; done; for d in ui/src migrations test/worker/retention; do test -d "$d" || echo "MISSING $d"; done` - Expected: no output
- [ ] Run (Phase 3 export, planned file per PLAN.md section 2): `grep -rln "export function selectBackupsToDelete\|export const selectBackupsToDelete" src/worker/retention` - Expected: exactly one file path printed. Write it down: Task 10 imports from that file.
- [ ] Run: `grep -rn "alert-channels" src/worker | head -1; grep -rn "retention-preview" src/worker | head -1; grep -rn "restores" src/worker | head -1` - Expected: three non-empty lines (the Phase 8, 6, and 7 routes exist)
- [ ] Ask the owner or read the Phase 4 summary: did the tunnel spike pass? - Expected: yes. If it failed, STOP: the onboarding guide would document a path that does not work.

## Decisions that differ from the PRD / docs/PLAN.md

Precedence is AGENTS.md, then PLAN.md owner answers, then the PRD, then the register.

1. **LICENSE is not created.** The PRD says "Create LICENSE (MIT)". It exists (`head -1 LICENSE` is `MIT License`, copyright line present). The register says do not overwrite an MIT license. Task 2 only verifies it.
2. **README says "every minute", not "every 5 minutes".** Register X13 (owner answer 14 in PLAN: one `* * * * *` trigger). PLAN.md section 1 already says per-minute.
3. **README secrets list changes.** The old list has `CALLBACK_HMAC_SECRET` and `R2_ACCOUNT_ID`. PLAN.md section 5 derives the job key from `jobId` and `ENCRYPTION_KEY`, so there is no callback secret. The register (Phase 5) uses the vars `R2_ENDPOINT` and `R2_BUCKET`, so there is no account id variable. New list: secrets `ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; vars `R2_ENDPOINT`, `R2_BUCKET`, `APP_BASE_URL` (Phase 8). The code wins: Task 7 reconciles with the real `.dev.vars.example` and `wrangler.jsonc`.
4. **README uses `bunx wrangler ...` and the D1 name `cellar`.** Wrangler is a Phase 1 dev dependency, not a global tool. `wrangler.jsonc` and `db:migrate:local` use the database name `cellar`, while the README said `cellar-db`.
5. **One source of truth for onboarding and restore.** The cloudflared compose snippet, the role SQL, and the manual `pg_restore` steps move out of the README into `docs/vm-onboarding.md` and `docs/restore-runbook.md`. The README keeps a short summary and links.
6. **README retention text follows the Phase 3 and Phase 6 rules in the register.** "daily N" means the newest backup of each of the N most recent days that have a backup. Failed backups are never counted. `retention_dry_run` defaults to `true`, so retention deletes nothing until the owner turns it off. "marked `deleted`" becomes soft delete with `deleted_at` (there is no `deleted` status). The example "roughly 7 to 20 backups" was wrong. A model run for 200 days of daily backups ending on each of 730 different days gave 13 to 15 kept backups (14 on 486 of the days). The README says "13 to 15", and Task 10 re-checks that against the real function.
7. **Access wording.** `GET /api/health` is open (Phase 1 plan, decision 2). `/internal/jobs/callback` is outside `/api` and is protected by HMAC, not Access (register, Phase 5). The README says both.
8. **README layout block.** The UI is `ui/` at the top level (register X1), not `src/ui/`. `src/shared/`, `test/`, and `docs/` are listed.
9. **One sentence per line.** `AGENTS.md` asks for this when substantially editing long Markdown. Task 9 reflows `README.md` mechanically. This makes the README diff large. The new files are written that way from the start.
10. **CI pins Bun 1.3.9**, the same version as the container image `oven/bun:1.3.9-slim` (AGENTS.md). The Phase 1 plan recorded Bun 1.3.5 locally and requires only `1.3.x`. Bun 1.3.9 exists (`bun-v1.3.9` release, checked 2026-10-24).
11. **The cross-check script is committed** as `scripts/check-readme.ts` and runs in CI (round 2, answer 26). The other helper scripts (`reflow-md.ts`, `extract-sql.ts`, `sql-check.sh`, `check-retention-example.ts`) stay throwaway under `/tmp/phase-10-tools/`.

## Dependencies that need your approval

No npm package is added and `package.json` is not edited.
The CI workflow uses two GitHub Actions, which are external code.
The owner approved GitHub Actions in principle (round 2, answer 11): use the latest major versions that exist, pinned by commit SHA.
Both versions and SHAs below were checked against the GitHub API on 2026-10-24 (the `v7` major of `actions/checkout` does exist: releases `v7.0.1`, `v6.1.0`, `v5.1.0`). Both tags are lightweight tags, so the tag points straight at the commit. Task 3 re-checks the SHAs before use.

| Item | Why | Pinned version |
|---|---|---|
| `actions/checkout` | Check out the repo in CI | `v7.0.1` = `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `oven-sh/setup-bun` | Install Bun in CI, official action from the Bun team | `v2.2.0` = `0c5077e51419868618aeaa5fe8019c62421857d6` |

Already approved and not used here: `@types/bun` (Phase 4, needed so `scripts/check-readme.ts` type-checks if `tsconfig.json` includes `scripts/`), RustFS (test and dev only).

## Global Constraints

- No em dash anywhere. Use a plain hyphen. Applies to every file written, every commit message, and the summary.
- When writing long Markdown, put each full sentence on its own line (`AGENTS.md` general guidelines).
- No private infrastructure, real hostnames, real account IDs, or tokens. Use `example.com` style placeholders. Allowed hosts in docs: `example.com` and subdomains, `github.com`, `cloudflare.com`, `cloudflarestorage.com` (only as `<account-id>.r2.cloudflarestorage.com`), `bun.sh`, `postgresql.org`, `discord.com` and `discordapp.com` (only as the webhook URL prefixes), `yourteam.cloudflareaccess.com`.
- Do not describe features that do not exist. Every command, env var, script name, and route in the docs must match the code.
- The cross-check must cover every `bun run <script>` against `package.json` (PRD "Done when").
- Never run `wrangler deploy`, `bun run deploy`, `bun run db:migrate:remote`, `wrangler secret put`, or any `--remote` command. Never run a command that creates, changes, or deletes a Cloudflare resource.
- GitHub Actions are pinned by commit SHA with the version in a trailing comment, never by tag.
- Never hardcode secrets. Every secret the docs mention must be in `.dev.vars.example`.
- Tunnel only: the docs never mention a direct connection mode (round 2, answer 1). `grep -rni "direct mode\|connection_mode\|direct connection" README.md CONTRIBUTING.md SECURITY.md docs/vm-onboarding.md docs/restore-runbook.md` must print nothing.
- Locked rules the docs must not contradict (`AGENTS.md`): Postgres ports are never public; the backup role is read-only; restore uses a separate restore connection URL; Cellar does logical backups only (no PITR); deleting a target is a soft delete; the latest successful backup is never deleted; default time zone is Asia/Bangkok.
- Do not add the agent as co-author in commit messages. Do not edit `CHANGELOG.md` files.
- If the same step fails 3 times, stop and report what you tried.
- End with `bun run test` and `bun run typecheck` passing, then the phase summary (Completed, Tests and results, Open issues and decisions needed).

## Patterns to Mirror

There is no code to mirror. These are the doc conventions already in the tree.

### README structure and tone
<!-- SOURCE: README.md:1-12 -->
Title, a one-line quote, a bold product sentence, a status note, then `## ` sections. Steps are numbered `### N. Title` under Quick start. Commands are fenced `bash`. Callouts are `> **Bold lead.** text`. Keep this.

### Existing compose snippet (moves to docs/vm-onboarding.md)
<!-- SOURCE: README.md:171-189 (the block that starts with `services:`) -->
````yaml
services:
  postgres:
    image: postgres:16
    # no "ports:" section needed, keep Postgres private
````

The new doc keeps the same service names `postgres` and `cloudflared` and the same `TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}` wiring.

### Existing role SQL (moves to docs/vm-onboarding.md)
<!-- SOURCE: README.md:199-203 -->
````sql
CREATE ROLE cellar_backup WITH LOGIN PASSWORD 'use-a-strong-password';
GRANT pg_read_all_data TO cellar_backup;
````

The role name `cellar_backup` and the placeholder password stay.

### Env var documentation
<!-- SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, Task 1 Step 7 (`.dev.vars.example`, planned, not yet in tree) -->
Each variable has a comment line above it. Production values are set with `wrangler secret put`. Phases 5 and 8 add more variables to this file.

### CI and CONTRIBUTING
No existing pattern - establishing new convention: one workflow `ci.yml` with one job that runs the same two commands `AGENTS.md` requires at the end of every phase (`bun run typecheck`, `bun run test`); `CONTRIBUTING.md` points to `AGENTS.md` and `docs/PLAN.md` instead of repeating them.

## Preflight

The Preflight needs no Docker and no Cloudflare access. Phase 10 never calls Cloudflare.

### DURABLE - true until the repo itself changes

- **The README is long and written as multi-sentence paragraphs.** Evidence: 339 lines at the base commit; `bun scripts/check-readme.ts README.md` (Task 1) reports many `more than one sentence on a line` hits. Consequence: Task 9 reflows it.
- **`LICENSE` is MIT.** Evidence: line 1 is `MIT License`, line 3 is `Copyright (c) 2026 Theerakarn Maiwong`. Consequence: Task 2 verifies and does not rewrite.
- **The README contains `cellart` twice (a typo for "kept").** Evidence: `grep -c cellart README.md` printed `2` while planning (lines 3 and 233). Consequence: Tasks 7 and 8 fix both (round 2, answer 27).
- **Lockfile is Bun's (`bun.lock`), created by Phase 1 Task 1.** Consequence: CI uses `bun install --frozen-lockfile`.
- **The tooling scripts work.** Evidence: Task 1 scripts ran in `/tmp/phase-10-scratch` against a fixture tree that mimics the Phase 1 tree and the final README text (see "What was run while planning").

### PERISHABLE - recapture before Task 0

- **Bun is installed.** Check: `bun --version` - Expected: `1.3.x` (planning run: 1.3.5). Needed by: every check and the CI proxy. The check script uses `Bun.spawnSync`, so it needs Bun 1.x.
- **Network access to the npm registry.** Check: `curl -sI https://registry.npmjs.org/hono | head -1` - Expected: `HTTP/2 200`. Needed by: the clean-clone CI proxy in the end-to-end section (`bun install --frozen-lockfile`) and `bunx wrangler ... --help`.
- **A local Postgres toolset for the SQL check.** Check: `command -v initdb pg_ctl psql pg_dump pg_restore || ls /opt/homebrew/opt/postgresql@*/bin/initdb` - Expected: all five on PATH, or a Homebrew `bin` folder you add to PATH (planning run used PostgreSQL 16, Homebrew). Needed by: the Task 5 verify and the end-to-end section. If missing: STOP and ask. Docker is not a substitute (this phase does not require it).
- **Network access to GitHub's API and Cloudflare docs.** Check: `curl -sI https://api.github.com/repos/actions/checkout | head -1; curl -sI https://developers.cloudflare.com/r2/buckets/object-lifecycles/ | head -1` - Expected: two `HTTP/2 200` lines (unauthenticated GitHub API calls are rate limited to 60 per hour). Needed by: the Task 3 Step 2 SHA re-check and the Task 8 Step 6 link check.
- **Free port 55433** for the scratch Postgres. Check: `lsof -i :55433` - Expected: no output. If used, edit `PORT=55433` in `sql-check.sh`.
- **Free port 8787** for the dev server check. Check: `lsof -i :8787` - Expected: no output. If used, pick another port and use it in the Manual command.
- **Git state.** Check: `git status --short && git rev-parse --short HEAD && git branch --show-current` - Expected: clean tree, on the branch where Phase 9 merged. Needed by: Task 0 and every commit.
- **No existing Phase 10 files.** Check: `ls CONTRIBUTING.md SECURITY.md docs/vm-onboarding.md docs/restore-runbook.md .github/workflows/ci.yml 2>&1` - Expected: five "No such file". If one exists, STOP and ask: another change created it.
- **Baseline red count.** Check: `bun run typecheck; bun run test` - Expected: both green (this is the Phase gate). Phase 10 adds no code, so any red is not Phase 10's, but the final summary must say so.
- **Dependencies installed in this checkout.** Check: `test -d node_modules && bun run typecheck` exits 0 - Needed by: the Task 3 verify (`bun run` names) and the end-to-end section. If missing: `bun install --frozen-lockfile`.
- **The repo's default branch name.** Check: `git symbolic-ref --short refs/remotes/origin/HEAD` - Expected: `origin/main` (planning run). Needed by: the `branches: [main]` line in `ci.yml`. If different, use the real name.

## Execution

**Tracks:** one track, sequential (`plan:phase-10:track-a`). Separate tracks would be below the cost floor (register rule 4): 12 small tasks (Tasks 0 to 11), all editing different files except `README.md` (Tasks 7 to 10).
**Merge order:** not applicable.
**Shared files:** `scripts/check-readme.ts` is created by Task 1 and only read afterwards (Task 3 adds the CI step that runs it). `README.md` is owned by Tasks 7, 8, 9, and 10 in that order. `docs/PLAN.md` is owned by Task 11 only. `package.json` and `bun.lock` are not touched in this phase.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch: `git switch -c phase-10-docs-and-oss-files`.
**treehouse:** installed (`/Users/jametirakarn/.local/bin/treehouse`), not needed for a single track.

## What was run while planning

Run in `/tmp/phase-10-scratch` (not in the repo).
Re-run after the round 2 reconciliation (2026-10-24), on a fixture tree `fx3`: the new `scripts/check-readme.ts` (with the `discord.com` host allowance and the direct-mode ban), the SHA-pinned `ci.yml`, and the new `SECURITY.md`, `CONTRIBUTING.md`, `docs/vm-onboarding.md` (no direct callout, save-disabled flow), and `docs/restore-runbook.md`. Results: the check printed `docs cross-check OK: 6 files`; a README line with the connection mode `direct` failed it (negative control); a Discord webhook sentence passed; the CI verify command printed the four `run` steps and found every action pinned; `sql-check.sh` on the new `docs/vm-onboarding.md` gave the same pg13, pg14, restore, and row count results as before. The README fragments added in Tasks 7 and 8 (Limits bullets, Alerts text, restore list) were NOT run against a real README.

- `check-readme.ts`, `reflow-md.ts`, `extract-sql.ts`, `sql-check.sh`, and `check-retention-example.ts` (Task 1 copies them). `check-readme.ts` was run against a fixture tree (Phase 1 `package.json` scripts, a `wrangler.jsonc` with `cellar`, `cellar-backups`, `cellar-jobs`, an expected final `.dev.vars.example`, and a `src/worker/app.ts` with the two routes). On the current README it reported the real defects (`cellar-db`, `cellart`, missing env vars, undocumented `DEV_BYPASS`). It passed on the new README text after the reflow. Negative controls: removing the callback route, adding a placeholder word, and a shim `bunx` that fails for `queues create` each produced the expected failure.
- `reflow-md.ts` on the current README: idempotent, only splits sentences.
- `sql-check.sh` against `docs/vm-onboarding.md` on a scratch PostgreSQL 16: the PG13 block and the PG14 block both gave a role that can `pg_dump -Fc` (including a table created after the grants) and holds no non-SELECT table grant. The restore block restored a dump as `cellar_restore` into a database it owns, and row counts matched with the `\gexec` query from the runbook. NOT run: PostgreSQL 13 or 14 servers (no Docker on the planning machine). The PG13 block uses only syntax that exists since PostgreSQL 9.x (`DO`, `ALTER DEFAULT PRIVILEGES`, `format`).
- `check-retention-example.ts` ran against a scratch reference implementation of the register's rules (not Phase 3's code): kept counts 13 (172 days), 14 (486), 15 (72) over 730 end dates. A separate Python model gave the same counts.
- `ci.yml` (SHA-pinned, with the `bun scripts/check-readme.ts` step) parsed with `Bun.YAML.parse` (6 steps) and checked for 40 character SHA pins. Action versions and SHAs checked through the GitHub API on 2026-10-24. NOT run: the workflow on GitHub.
- NOT run: `check-readme.ts --wrangler` against the real `wrangler` (not installed in the fixture), any command against the real tree, and the final README against the real `.dev.vars.example`.

---

### Task 0: Branch and phase gate

**Files:**
- Create: nothing.

**Interfaces:**
- Consumes: the Phase gate section above.
- Produces: branch `phase-10-docs-and-oss-files`.

**Steps:**
- [ ] Step 1: Run the Phase gate and Preflight checks. Record the PERISHABLE values in your notes.
- [ ] Step 2: Create the branch: `git switch -c phase-10-docs-and-oss-files`
- [ ] Step 3: Verify - Run: `git branch --show-current && git status --short` - Expected: `phase-10-docs-and-oss-files`, then no other output

No commit (nothing changed).

---

### Task 1: Add the docs check script, install the throwaway helpers, and capture the README baseline

**Files:**
- Create (committed, run in CI): `scripts/check-readme.ts`
- Create (outside the repo, nothing is committed): `/tmp/phase-10-tools/reflow-md.ts`, `/tmp/phase-10-tools/extract-sql.ts`, `/tmp/phase-10-tools/sql-check.sh`, `/tmp/phase-10-tools/check-retention-example.ts`

**Interfaces:**
- Consumes: nothing from the repo yet (the scripts read `package.json`, `wrangler.jsonc`, `.dev.vars.example`, `src/`, `container/`, and the doc files at run time).
- Produces (used by Tasks 2 to 11), all run from the repo root:
  - `bun scripts/check-readme.ts [--list] [--wrangler] [files...]` - exit 0 and one `docs cross-check OK` line, or exit 1 and one failure per line. With no files it checks `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/vm-onboarding.md`, `docs/restore-runbook.md`, and `.github/workflows/ci.yml` (those that exist). Checks: `bun run` names vs `package.json` scripts, env vars vs `.dev.vars.example` and `src/worker/env.ts` (and the reverse for `README.md`), `/api` and `/internal` routes vs string literals in `src/` and `container/`, `wrangler d1|r2 bucket|queues create` names vs `wrangler.jsonc`, banned strings (em dash, `cellart`, placeholder words, 32-hex ids, JWT-like tokens, non-placeholder hostnames), relative links, and one sentence per line. `--wrangler` also runs `bunx wrangler <command> --help` for each documented wrangler command (local, creates nothing).
  - `bun /tmp/phase-10-tools/reflow-md.ts <file.md>` - rewrites one sentence per line, idempotent.
  - `bash /tmp/phase-10-tools/sql-check.sh <doc.md>` - runs the `sql pg13`, `sql pg14`, and `sql restore` blocks of the doc against a scratch Postgres.
  - `bun /tmp/phase-10-tools/check-retention-example.ts` - exit 0 and `README retention example OK` when the real `selectBackupsToDelete` keeps 13 to 15 backups for the README example.

**Gotcha:** `scripts/check-readme.ts` is a real repo file: it must type-check if `tsconfig.json` includes `scripts/` (it needs `@types/bun` from Phase 4 for `Bun.spawnSync`), so Step 7 runs `bun run typecheck`. The scripts take deliberate shortcuts. The route check accepts a documented route when its full literal, or a prefix literal plus a suffix literal (Hono sub-routers), appears in the code with `:param` names normalised. The sentence check ignores code fences, tables, headings, and inline code.

**Steps:**
- [ ] Step 1: `mkdir -p scripts /tmp/phase-10-tools` and create `scripts/check-readme.ts`:
````ts
// Docs cross-check, run in CI. Run from the repo root: bun scripts/check-readme.ts [--list] [--wrangler] [files...]
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DOCS = (argFiles.length ? argFiles : ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/vm-onboarding.md", "docs/restore-runbook.md", ".github/workflows/ci.yml"]).filter(existsSync);
const read = (p: string) => readFileSync(p, "utf8");
const docs = Object.fromEntries(DOCS.map((p) => [p, read(p)]));
const all = Object.values(docs).join("\n");
const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const uniq = (xs: string[]) => [...new Set(xs)];

const walk = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
const sources = ["src", "container"].flatMap(walk).map(read).join("\n");

// 1. bun run <script> must exist in package.json
const scripts = Object.keys(JSON.parse(read("package.json")).scripts ?? {});
for (const s of uniq([...all.matchAll(/\bbun run ([\w:-]+)/g)].map((m) => m[1]!))) {
  if (!scripts.includes(s)) fail(`bun run ${s}: not in package.json scripts`);
}

// 2. wrangler subcommands (collected here, validated with --help by the caller)
const wranglerCmds = uniq([...all.matchAll(/\bwrangler (r2 bucket [a-z]+|[a-z0-9]+(?: [a-z]+)?)/g)].map((m) => m[1]!))
  .filter((c) => !/^(config|and|is|to)\b/.test(c));
if (process.argv.includes("--list")) console.log("wrangler commands:", wranglerCmds);
if (process.argv.includes("--wrangler")) {
  for (const cmd of wranglerCmds) {
    const run = Bun.spawnSync(["bunx", "wrangler", ...cmd.split(" "), "--help"], { stdout: "ignore", stderr: "ignore" });
    if (run.exitCode !== 0) fail(`wrangler ${cmd}: "--help" exited ${run.exitCode}`);
  }
}

// 3. env vars: documented names must exist in the code or example, and the reverse
const example = existsSync(".dev.vars.example") ? read(".dev.vars.example") : "";
const exampleVars = [...example.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!);
const envTs = existsSync("src/worker/env.ts") ? read("src/worker/env.ts") : "";
const known = new Set([...exampleVars, ...[...envTs.matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:/gm)].map((m) => m[1]!)]);
const DOCS_ONLY = new Set(["CLOUDFLARE_TUNNEL_TOKEN", "TUNNEL_TOKEN", "PGPASSWORD", "POSTGRES_PASSWORD", "AUD", "UTC", "ISO", "MIT", "R2", "D1", "SQL", "TCP", "LINE", "JWT", "URL", "UI", "API", "HMAC", "PITR", "WAL", "AES", "GFS", "CRON"]);
const secretPut = [...all.matchAll(/wrangler secret put ([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]!);
const ticked = [...all.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)].map((m) => m[1]!);
for (const v of uniq([...secretPut, ...ticked])) {
  if (!known.has(v) && !DOCS_ONLY.has(v)) fail(`env var ${v}: not in .dev.vars.example or src/worker/env.ts`);
}
if (DOCS.includes("README.md")) for (const v of exampleVars) if (!all.includes(v)) fail(`env var ${v}: in .dev.vars.example but not documented`);

// 4. routes: every /api or /internal route in the docs is registered in code (sub-router prefix + suffix allowed)
const norm = (s: string) => s.replace(/:[A-Za-z]+/g, ":p");
const src = norm(sources);
const routes = uniq([...all.matchAll(/(?<![\w./-])\/(?:api|internal)\/[A-Za-z0-9_:/-]+/g)].map((m) => norm(m[0]!.replace(/[/.]+$/, ""))));
for (const r of routes) {
  const segs = r.split("/").slice(1);
  let ok = src.includes(`"${r}"`);
  for (let i = 1; i < segs.length && !ok; i++) {
    const prefix = "/" + segs.slice(0, i).join("/");
    const suffix = "/" + segs.slice(i).join("/");
    ok = src.includes(`"${prefix}"`) && src.includes(`"${suffix}"`);
  }
  if (!ok) fail(`route ${r}: no registration found in src/ or container/`);
}

// 5. resource names must match wrangler.jsonc
const wr = existsSync("wrangler.jsonc") ? read("wrangler.jsonc") : "";
const expectName = (cmd: RegExp, key: string, label: string) => {
  const want = wr.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`))?.[1];
  for (const m of all.matchAll(cmd)) if (m[1] !== want) fail(`${label} ${m[1]}: wrangler.jsonc has ${want}`);
};
expectName(/wrangler d1 create (\S+)/g, "database_name", "d1");
expectName(/wrangler r2 bucket create (\S+)/g, "bucket_name", "r2 bucket");
expectName(/wrangler queues create (\S+)/g, "queue", "queue");

// 6. banned content
const BANNED: [RegExp, string][] = [
  [/\u2014/, "em dash"], [/cellart/i, "typo cellart"], [/connection_mode|direct (?:connection )?mode|`direct`/i, "direct connection mode (removed)"], [/\b[0-9a-f]{32}\b/, "32-hex id (account id?)"],
  [/eyJ[A-Za-z0-9_-]{10,}/, "JWT-like token"], [new RegExp(`\\b(?:${["TO", "DO"].join("")}|${["TB", "D"].join("")})\\b`), "placeholder"],
];
for (const [file, text] of Object.entries(docs)) {
  for (const [re, label] of BANNED) if (re.test(text)) fail(`${file}: contains ${label}`);
  for (const m of text.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.(?:com|io|dev|net|org|app|me)\b/g)) {
    const host = m[0];
    if (!/(^|\.)(example\.com|github\.com|cloudflare\.com|cloudflarestorage\.com|bun\.sh|postgresql\.org|discord\.com|discordapp\.com)$/.test(host) && !/^(yourteam|myteam)\.cloudflareaccess\.com$/.test(host)) {
      fail(`${file}: hostname ${host} is not an allowed placeholder`);
    }
  }
}

// 7. relative markdown links resolve; 8. one sentence per line in prose
for (const [file, text] of Object.entries(docs)) {
  if (!file.endsWith(".md")) continue;
  for (const m of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
    const target = join(file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ".", m[1]!);
    if (!existsSync(target)) fail(`${file}: broken link ${m[1]}`);
  }
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence || /^\s*\||^#|^\s*<!--/.test(line)) return;
    const prose = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/`[^`]*`/g, "``").replace(/\]\([^)]*\)/g, "]");
    for (const m of prose.matchAll(/[.!?] (?=[A-Z])/g)) {
      if (!/(?:e\.g|i\.e|vs|etc)\.$/.test(prose.slice(0, m.index! + 1))) { fail(`${file}:${i + 1}: more than one sentence on a line`); break; }
    }
  });
}

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`docs cross-check OK: ${DOCS.length} files, ${scripts.length} scripts, ${routes.length} routes, ${known.size} env vars`);
````

- [ ] Step 2: Create `/tmp/phase-10-tools/reflow-md.ts`:
````ts
// Throwaway: one sentence per line. Usage: bun /tmp/phase-10-tools/reflow-md.ts <file.md>  (rewrites in place)
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2]!;
const lines = readFileSync(file, "utf8").split("\n");
const ABBREV = /(?:e\.g|i\.e|vs|etc)\.$/;
let inFence = false;
const out: string[] = [];

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const token of text.split(/(?<=[.!?])\s+(?=[A-Z*`\[(])/)) {
    current = current ? `${current} ${token}` : token;
    if (ABBREV.test(current)) continue;
    parts.push(current);
    current = "";
  }
  if (current) parts.push(current);
  return parts;
}

for (const line of lines) {
  if (/^\s*```/.test(line)) { inFence = !inFence; out.push(line); continue; }
  if (inFence || /^\s*\|/.test(line) || /^#{1,6}\s/.test(line) || /^\s*<!--/.test(line) || line.trim() === "") { out.push(line); continue; }
  const m = line.match(/^(\s*(?:>\s*)*(?:[-*]\s+|\d+\.\s+|- \[[ x]\]\s+)?)(.*)$/)!;
  const prefix = m[1]!;
  const continuation = prefix.replace(/[-*]\s+|\d+\.\s+|- \[[ x]\]\s+/, (s) => " ".repeat(s.length));
  const sentences = splitSentences(m[2]!);
  sentences.forEach((s, i) => out.push((i === 0 ? prefix : continuation) + s));
}
writeFileSync(file, out.join("\n"));
````

- [ ] Step 3: Create `/tmp/phase-10-tools/extract-sql.ts`:
````ts
// Throwaway: bun /tmp/phase-10-tools/extract-sql.ts <doc.md> <outdir>  -> writes <outdir>/<tag>.sql for each ```sql <tag> block
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const [doc, outDir] = process.argv.slice(2) as [string, string];
mkdirSync(outDir, { recursive: true });
let n = 0;
for (const m of readFileSync(doc, "utf8").matchAll(/^\s*```sql (\w+)\n([\s\S]*?)^\s*```/gm)) {
  const body = m[2]!.split("\n").map((l) => l.replace(/^ {2}/, "")).join("\n");
  writeFileSync(`${outDir}/${m[1]}.sql`, body);
  n++;
}
console.log(`extracted ${n} blocks`);
````

- [ ] Step 4: Create `/tmp/phase-10-tools/sql-check.sh`:
````bash
#!/bin/bash
# Throwaway: runs the SQL blocks of docs/vm-onboarding.md against a scratch Postgres (needs initdb/pg_ctl/psql/pg_dump/pg_restore on PATH).
# Usage: bash /tmp/phase-10-tools/sql-check.sh docs/vm-onboarding.md
set -euo pipefail
DOC=$(realpath "$1"); W=/tmp/sqlcheck-work; rm -rf $W; mkdir -p $W; cd $W
bun /tmp/phase-10-tools/extract-sql.ts "$DOC" $W/sql
PORT=55433; P="-h $W -p $PORT"
initdb -D $W/data -U owner_admin --auth=trust >/dev/null
pg_ctl -D $W/data -o "-p $PORT -k $W" -l $W/pg.log -w start >/dev/null
trap 'pg_ctl -D $W/data -m fast stop >/dev/null' EXIT
seed() { psql $P -U owner_admin -d postgres -qc "DROP DATABASE IF EXISTS shop" -c "CREATE DATABASE shop"
  psql $P -U owner_admin -d shop -q -c "CREATE TABLE orders (id serial PRIMARY KEY, note text); INSERT INTO orders(note) SELECT 'n'||g FROM generate_series(1,100) g; CREATE SCHEMA billing; CREATE TABLE billing.invoices (id serial PRIMARY KEY, amount int); INSERT INTO billing.invoices(amount) SELECT g FROM generate_series(1,50) g;"; }
for tag in pg13 pg14; do
  seed; psql $P -U owner_admin -d postgres -qc "DROP ROLE IF EXISTS cellar_backup" 2>/dev/null || true
  psql $P -U owner_admin -d shop -q -v ON_ERROR_STOP=1 -f sql/$tag.sql
  psql $P -U owner_admin -d shop -qc "CREATE TABLE later (id int); INSERT INTO later VALUES (1);"
  pg_dump $P -U cellar_backup -d shop -Fc -f $W/$tag.dump && echo "$tag: dump ok (incl. table created after the grants)"
  W_GRANTS=$(psql $P -U cellar_backup -d shop -Atc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'cellar_backup' AND privilege_type <> 'SELECT'"); echo "$tag: non-SELECT table grants = $W_GRANTS"
  psql $P -U owner_admin -d shop -qc "DROP OWNED BY cellar_backup" -c "DROP ROLE cellar_backup"
done
psql $P -U owner_admin -d postgres -v ON_ERROR_STOP=1 -q -f sql/restore.sql
pg_restore $P -U cellar_restore --clean --if-exists --no-owner -d shop_restore_test $W/pg14.dump && echo "restore as cellar_restore ok"
cat > $W/counts.sql <<'SQL'
SELECT format('SELECT %L AS table_name, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1 \gexec
SQL
psql $P -U owner_admin -d shop -At -f $W/counts.sql > $W/a.txt; psql $P -U owner_admin -d shop_restore_test -At -f $W/counts.sql > $W/b.txt
diff $W/a.txt $W/b.txt && echo "row counts identical:" && cat $W/a.txt
````

- [ ] Step 5: Create `/tmp/phase-10-tools/check-retention-example.ts`:
````ts
// Throwaway: bun /tmp/phase-10-tools/check-retention-example.ts  (run from the repo root)
// Backs up once a day at 02:00 Asia/Bangkok for 200 days ending on 730 different days, applies the README example policy.
const { selectBackupsToDelete } = await import(`${process.cwd()}/src/worker/retention/gfs.ts`);

const policy = { keep_last: 3, daily: 7, weekly: 4, monthly: 6, max_age_days: null };
const counts = new Map<number, number>();
for (let offset = 0; offset < 730; offset++) {
  const end = Date.UTC(2026, 0, 1 + offset, 19 - 24, 0, 0); // 02:00 Bangkok = 19:00 UTC the day before
  const backups = Array.from({ length: 200 }, (_, i) => ({
    id: `b${i}`, status: "success", created_at: new Date(end - i * 86_400_000).toISOString(),
  }));
  const { keep } = selectBackupsToDelete(backups, policy, new Date(end + 3_600_000), "Asia/Bangkok");
  counts.set(keep.length, (counts.get(keep.length) ?? 0) + 1);
}
const sizes = [...counts.keys()];
console.log("kept counts over 730 end dates:", Object.fromEntries(counts));
if (Math.min(...sizes) !== 13 || Math.max(...sizes) !== 15) { console.error("README says 13 to 15"); process.exit(1); }
console.log("README retention example OK");
````

- [ ] Step 6: Verify - Run (negative control, the current README is known to be wrong): `bun scripts/check-readme.ts README.md; echo "exit=$?"` - Expected: `exit=1`, and the output contains `contains typo cellart` and `d1 cellar-db: wrangler.jsonc has cellar`, plus env var lines for `CALLBACK_HMAC_SECRET` and `R2_ACCOUNT_ID`, plus `broken link CONTRIBUTING.md` and `broken link SECURITY.md` (and a `direct connection mode (removed)` hit if the old README still mentions it). Paste the full output into your notes as the baseline.
- [ ] Step 7: Verify the script is a clean repo file - Run: `bun run typecheck && bun run test` - Expected: both exit 0.
- [ ] Step 8: Commit - `git add scripts/check-readme.ts && git commit -m "docs: add README cross-check script"`

---

### Task 2: LICENSE check and SECURITY.md

**Files:**
- Create: `SECURITY.md`
- Read only: `LICENSE`

**Interfaces:**
- Consumes: nothing.
- Produces: `SECURITY.md` at the repo root (linked from `README.md` and `CONTRIBUTING.md`).

**Steps:**
- [ ] Step 1: Confirm the license is MIT and leave it alone: `head -1 LICENSE; grep -c "Permission is hereby granted, free of charge" LICENSE` - Expected: `MIT License`, then `1`. If either differs, STOP and report (the register forbids rewriting it silently).
- [ ] Step 2: Create `SECURITY.md`:
````markdown
# Security policy

Cellar is in early development.
Only the latest commit on `main` receives security fixes.

## Report a vulnerability

Please do not open a public issue, pull request, or discussion for a security problem.

Use GitHub Security Advisories instead:

1. Open the **Security** tab of this repository.
2. Select **Report a vulnerability**.
3. Describe the problem, the steps to reproduce it, and the impact.

Only you and the maintainers can see the report.
We will confirm that we received it, work on a fix with you, and publish an advisory when the fix is released.

Never put a real connection string, token, key, or password in a report.
Replace secrets with placeholders.

## What counts as a vulnerability

- A way to call the API without a valid Cloudflare Access token.
- A way to forge or replay a container callback.
- Any path that shows a connection URL, tunnel token, alert credential, or R2 credential in plaintext after it is saved, in a log, in an error, or in an alert.
- Deleting or overwriting a backup or a database without the confirmation the product requires.
- A weakness in the encryption of stored secrets.
````

- [ ] Step 3: Verify - Run: `bun scripts/check-readme.ts SECURITY.md` - Expected: `docs cross-check OK: 1 files`
- [ ] Step 4: 👤 Verify - Human: in the repository on GitHub open Settings, Code security, and confirm "Private vulnerability reporting" is enabled, then open the Security tab and confirm the "Report a vulnerability" button shows - Expected: both true - Proxy: Step 3 passes and `grep -c "Report a vulnerability" SECURITY.md` prints `1`, which proves the file uses exactly the button name (the setting itself is not reachable without a GitHub login)
- [ ] Step 5: Commit - `git add SECURITY.md && git commit -m "docs: add security policy"`

---

### Task 3: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `scripts/check-readme.ts` (Task 1); scripts `typecheck` and `test` in `package.json` (Phase 1 plan, Task 1 Step 1: `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`), and `bun.lock` committed.
- Produces: the workflow `CI`, job `check`, which runs on pushes to `main` and on pull requests. Both actions are pinned by commit SHA (round 2, answer 11).

**Gotcha:** `permissions: contents: read` is deliberate. The workflow uses no secrets and must not need any. `bun install --frozen-lockfile` fails if `bun.lock` and `package.json` disagree, which is the point. The tests use `getPlatformProxy` from `wrangler` (register X4), which starts a local `workerd`. That should work on `ubuntu-latest` but was not run on Linux while planning [uncertain]. Use the real default branch name from Preflight in place of `main`.

**Steps:**
- [ ] Step 1: Create `.github/workflows/ci.yml`:
````yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.9
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run test
      - run: bun scripts/check-readme.ts
````

- [ ] Step 2: Re-check the pinned versions (they may have moved since 2026-10-24; verify, do not assume): `curl -s https://api.github.com/repos/actions/checkout/releases/latest | grep '"tag_name"'; curl -s https://api.github.com/repos/oven-sh/setup-bun/releases/latest | grep '"tag_name"'; curl -s https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1 | grep '"sha"'; curl -s https://api.github.com/repos/oven-sh/setup-bun/git/ref/tags/v2.2.0 | grep '"sha"'` - Expected: `v7.0.1` and `v2.2.0` (or newer majors, then pin the newer release instead and record a `> Deviation:`), then the SHAs `3d3c42e5aac5ba805825da76410c181273ba90b1` and `0c5077e51419868618aeaa5fe8019c62421857d6`. If a tag is an annotated tag the `object.type` is `tag`, and the commit SHA is one more lookup (`git/tags/<sha>`); both were lightweight (`commit`) when planned.
- [ ] Step 3: Verify - Run: `bun -e 'const w = Bun.YAML.parse(await Bun.file(".github/workflows/ci.yml").text()); const steps = w.jobs.check.steps; const runs = steps.map((s) => s.run).filter(Boolean); console.log(JSON.stringify(runs)); const bad = steps.filter((s) => s.uses && !/@[0-9a-f]{40}$/.test(s.uses)); if (bad.length) { console.error("unpinned", bad); process.exit(1) } if (runs.join("|") !== "bun install --frozen-lockfile|bun run typecheck|bun run test|bun scripts/check-readme.ts") process.exit(1)' && bun scripts/check-readme.ts .github/workflows/ci.yml` - Expected: `["bun install --frozen-lockfile","bun run typecheck","bun run test","bun scripts/check-readme.ts"]`, then `docs cross-check OK: 1 files` (the second part proves the `bun run` names exist in `package.json`; the first part proves every action is pinned by a 40 character SHA)
- [ ] Step 4: Commit - `git add .github/workflows/ci.yml && git commit -m "ci: run typecheck, tests, and the README check on push and pull request"`

---

### Task 4: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `SECURITY.md` (Task 2); scripts `db:migrate:local`, `dev`, `typecheck`, `test`, `db:generate`, `deploy`, `db:migrate:remote` in `package.json`; `src/worker/lib/redact.ts` exporting `redactSecrets(input: string): string` and `redactError(error: unknown): string` (Phase 1 plan, planned, not yet in tree; the exact return types are the Phase 1 plan's, this task only names the functions); `selectBackupsToDelete` in `src/worker/retention/` (Phase 3).
- Produces: `CONTRIBUTING.md` at the repo root (linked from `README.md`).

**Steps:**
- [ ] Step 1: Create `CONTRIBUTING.md`:
````markdown
# Contributing to Cellar

Thank you for helping.
This page tells you how to set up, what to run before a pull request, and which rules are strict.

## Set up

You need [Bun](https://bun.sh) and Node.js 20 or newer.
Docker is only needed to work on the container image in `container/`.

```bash
git clone https://github.com/theerakarnm/cellar.git
cd cellar
bun install
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run dev
```

Fill in `.dev.vars` with fake values.
Set `DEV_BYPASS=true` to skip Cloudflare Access on `localhost`.
Never commit `.dev.vars`.

## Layout

- `src/worker/` is the Worker (Hono API, cron, queue, retention, alerts).
- `src/shared/` is code used by both the Worker and the UI.
- `ui/` is the React and Vite dashboard.
- `container/` is the image and job runner for `pg_dump` and `pg_restore`.
- `migrations/` holds Drizzle migrations for D1.
- `test/` mirrors the source folders.

## Before you open a pull request

Run these commands.
CI runs the same three.

```bash
bun run typecheck
bun run test
bun scripts/check-readme.ts
```

The last command checks that the README and the files in `docs/` match the code: scripts, environment variables, routes, resource names, and links.

Rules:

- Add tests for new behavior and for every bug fix.
- Changes to retention need tests.
  The logic is the pure function `selectBackupsToDelete` in `src/worker/retention/`.
  A bug there deletes backups, so every rule and the "latest successful backup is never deleted" rule must stay covered.
- Change the database with a new migration: `bun run db:generate -- --name <what>`.
  Never edit a migration that was already applied.
- Never run `wrangler deploy`, `bun run deploy`, `bun run db:migrate:remote`, or any command that changes real Cloudflare resources from a pull request.
- Never commit secrets, real hostnames, or account IDs.
  Use `example.com` style placeholders.
- Never log or return connection URLs, tokens, or credentials.
  Use `redactSecrets` and `redactError` from `src/worker/lib/redact.ts`.
- Do not add a dependency without asking first.
  The stack is fixed: see `AGENTS.md`.

## How work is planned

Work is split into phases, listed in `docs/PLAN.md`, with a plan for each phase in `docs/plans/`.
A phase is done when `bun run test` and `bun run typecheck` pass.
In your pull request description, say what you finished, what you tested and the result, and what is still open.

## Reporting security problems

Do not open a public issue.
See [SECURITY.md](SECURITY.md).
````

- [ ] Step 2: Verify - Run: `bun scripts/check-readme.ts CONTRIBUTING.md && test -f src/worker/lib/redact.ts && grep -q "redactSecrets" src/worker/lib/redact.ts && grep -q "redactError" src/worker/lib/redact.ts && grep -rq "selectBackupsToDelete" src/worker/retention && echo refs-ok` - Expected: `docs cross-check OK: 1 files`, then `refs-ok`
- [ ] Step 3: Commit - `git add CONTRIBUTING.md && git commit -m "docs: add contributing guide"`

---

### Task 5: docs/vm-onboarding.md

**Files:**
- Create: `docs/vm-onboarding.md`

**Interfaces:**
- Consumes: Phase 2 target fields (tunnel only; `restore_url_enc`, tunnel hostname, token id and secret, `enabled`, `alert_failure_threshold`); Phase 4 runner URL handling (planned `container/` code, see Step 2); the `sql pg13`, `sql pg14`, `sql restore` fence tags read by `extract-sql.ts`.
- Produces: `docs/vm-onboarding.md` with the headings `## 3. Create the backup role` and `## 4. Restore role` (linked from `docs/restore-runbook.md` as `vm-onboarding.md#4-restore-role` and from `README.md`).

**Gotcha:** the SQL fences use the info strings `sql pg13`, `sql pg14`, and `sql restore`. The check script depends on them. Keep the backslash escapes in the PG13 `DO` block exactly as written (`'pg\_%' ESCAPE '\'`): they escape the underscore in the `LIKE` pattern so that schemas starting with `pg_` are skipped.

**Steps:**
- [ ] Step 1: Check that direct mode is gone (round 2, answer 1): `grep -rni "connection_mode\|direct" src/worker/db/schema.ts src/shared 2>/dev/null | head -5` - Expected: no output, and the tunnel hostname and token columns are `NOT NULL` in `src/worker/db/schema.ts`. If a `connection_mode` column exists, STOP and report: Phase 1 or 2 drifted from the owner's decision.
- [ ] Step 2: Check what host the user must type in the connection URL. Read how the Phase 4 runner builds the URL it connects with: `grep -rn "127.0.0.1\|localPort\|new URL" container/*.ts | head -20`. The doc below says "the host is the tunnel hostname, Cellar swaps it for the local tunnel port at run time", from PLAN.md section 3 (`connection_url_enc` host = tunnel hostname) and section 5 (`db.url` uses `127.0.0.1:{localPort}`). If the runner uses the stored host and port unchanged, change that sentence in the "Register the database in Cellar" list to what the code does. If you cannot tell, STOP and ask.
- [ ] Step 3: Check that a target without a restore URL cannot be a restore destination: `grep -rn "hasRestoreUrl\|restore_url_enc" src/worker | grep -v "db/schema" | head -10` and read the restore route that Phase 7 added. The doc says "A database without a restore URL cannot be a restore destination." If the route does not reject that case, remove that sentence.
- [ ] Step 4: Create `docs/vm-onboarding.md`:
````markdown
# VM onboarding

Do this once for each VM that hosts a Postgres database you want Cellar to back up.
Cellar never needs an open Postgres port.
It reaches the database through Cloudflare Tunnel.

You will:

1. Add a tunnel to the VM's docker-compose stack.
2. Protect the tunnel hostname with Cloudflare Access and a service token.
3. Create a read-only backup role.
4. Prepare a restore role.
5. Register the database in Cellar and test it.

## 1. Create a tunnel and add `cloudflared` to the compose stack

In Cloudflare Zero Trust, go to **Networks > Tunnels** and create a tunnel.
Copy the tunnel token.
Add a public hostname of type **TCP**, for example `db-shop.example.com`, that points to `postgres:5432`.
The name `postgres` must match the Postgres service name in your compose file.

Add `cloudflared` next to Postgres:

```yaml
services:
  postgres:
    image: postgres:16
    # No "ports:" section. Keep Postgres private.
    volumes:
      - pgdata:/var/lib/postgresql/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    depends_on:
      - postgres

volumes:
  pgdata:
```

Put `CLOUDFLARE_TUNNEL_TOKEN` in the `.env` file next to the compose file, then start it:

```bash
docker compose up -d cloudflared
```

`latest` is fine for a first try.
For production, pin `cloudflared` to a release tag you have tested.

## 2. Protect the hostname with Access and a service token

Cellar's container logs in to the tunnel hostname with a service token.
No person signs in.

1. Go to **Access > Service Auth > Service Tokens** and create a token for Cellar.
   Copy the **Client ID** and **Client Secret**.
   The secret is shown only once.
2. Go to **Access > Applications > Add an application > Self-hosted**.
   Set the application domain to the tunnel hostname, for example `db-shop.example.com`.
3. Add one policy with action **Service Auth**.
   Include only the Cellar service token.
   Do not add an identity provider rule.

Dashboard menu names change from time to time.
See the Cloudflare docs on [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) and [arbitrary TCP applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/) if a screen looks different.

## 3. Create the backup role

The backup role is read-only.
Run the SQL as a superuser or the database owner, connected to the database you are backing up (here `shop`).
Replace the password.

### PostgreSQL 14 and newer

```sql pg14
CREATE ROLE cellar_backup WITH LOGIN PASSWORD 'use-a-strong-password';
GRANT CONNECT ON DATABASE shop TO cellar_backup;
GRANT pg_read_all_data TO cellar_backup;
```

### PostgreSQL 13

The role `pg_read_all_data` does not exist before PostgreSQL 14.
Grant read access on every schema explicitly instead:

```sql pg13
CREATE ROLE cellar_backup WITH LOGIN PASSWORD 'use-a-strong-password';
GRANT CONNECT ON DATABASE shop TO cellar_backup;

DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname NOT IN ('pg_catalog', 'information_schema')
             AND nspname NOT LIKE 'pg\_%' ESCAPE '\'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO cellar_backup', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO cellar_backup', s);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO cellar_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO cellar_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON SEQUENCES TO cellar_backup', s);
  END LOOP;
END
$$;
```

Notes for PostgreSQL 13:

- `ALTER DEFAULT PRIVILEGES` only covers objects created later by the role that runs it.
  If your app creates tables as another role, also run `ALTER DEFAULT PRIVILEGES FOR ROLE <app_owner> IN SCHEMA <schema> GRANT SELECT ON TABLES TO cellar_backup;` (and the same for `SEQUENCES`).
- Run the block again after you add a new schema.
- If the database uses large objects, `pg_dump` also needs `SELECT` on them.
  The Cellar project has not tested this case.

### Check the backup role

From the VM, run both commands:

```bash
docker compose exec -T postgres pg_dump -U cellar_backup -d shop -Fc > /dev/null && echo dump-ok
docker compose exec -T postgres psql -U cellar_backup -d shop -Atc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'cellar_backup' AND privilege_type <> 'SELECT'"
```

The first command prints `dump-ok` when the role can read everything.
The second prints `0` when the role holds no write privilege on any table.

PostgreSQL 14 and older let every role create objects in the schema `public` by default.
That is a Postgres default and not a Cellar setting.

## 4. Restore role

Cellar restores with a separate connection URL, the **restore URL**, that you enter when you register the database.
The backup role cannot be used for restore.
A database without a restore URL cannot be a restore destination.

Cellar runs `pg_restore --clean --if-exists --no-owner`.
This drops and recreates every object in the dump.
With `--no-owner`, restored objects belong to the role that connects.

Use these roles:

- **Scratch database (recommended for practice).**
  Create a role and a database it owns.
  The role then has all the rights a restore needs.

  ```sql restore
  CREATE ROLE cellar_restore WITH LOGIN PASSWORD 'use-a-strong-password';
  CREATE DATABASE shop_restore_test OWNER cellar_restore;
  ```

- **Real database.**
  Use the role that owns the objects, normally your app's owner role.
  Then the restored objects keep the right owner and your app still works after the restore.
  Do not use a superuser unless you must.
- **Extensions.**
  `pg_restore` re-creates extensions.
  A role that is not a superuser can do this only for trusted extensions.
  Create other extensions in the destination database first.

Cellar never creates databases.
The destination database must already exist.

## 5. Register the database in Cellar

In the dashboard, select **Add database** and fill in:

- **Name** and an optional **project tag**
- **Connection URL**, for example `postgresql://cellar_backup:use-a-strong-password@db-shop.example.com:5432/shop` (the host is the tunnel hostname, Cellar swaps it for the local tunnel port at run time)
- **Restore connection URL** (optional, needed to restore into this database)
- **Tunnel hostname** and the service token ID and secret (all required)
- **Schedule**, for example `0 2 * * *` (every day at 02:00), and the time zone
- **Retention policy**
- **Alert channels**, the failure threshold, and an optional staleness limit

Cellar tests a database only after it is saved.
The form therefore saves the database as **disabled** first.
Then:

1. Click **Test connection**.
   Cellar shows the server version if everything is reachable.
2. When the test passes, switch the database to **enabled**.
   Scheduled backups start only after that.

A disabled database never runs scheduled backups.
````

- [ ] Step 5: Verify - Run: `grep -ni "direct\|connection mode" docs/vm-onboarding.md; export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH; bash /tmp/phase-10-tools/sql-check.sh docs/vm-onboarding.md && bun scripts/check-readme.ts docs/vm-onboarding.md` (adjust the PATH line to your Postgres install, or drop it when the tools are already on PATH) - Expected: no output from the `grep` (no direct mode wording), then `extracted 3 blocks`; `pg13: dump ok ...`; `pg13: non-SELECT table grants = 0`; `pg14: dump ok ...`; `pg14: non-SELECT table grants = 0`; `restore as cellar_restore ok`; `row counts identical:` with three table lines; then `docs cross-check OK: 1 files`
- [ ] Step 6: Commit - `git add docs/vm-onboarding.md && git commit -m "docs: add VM onboarding guide with tunnel, backup role, and restore role"`

---

### Task 6: docs/restore-runbook.md

**Files:**
- Create: `docs/restore-runbook.md`

**Interfaces:**
- Consumes: `docs/vm-onboarding.md#4-restore-role` (Task 5); the Phase 7 restore request schema and routes; the Phase 7 download route; the `sha256` field on the backup record (PLAN.md section 3, `backups.sha256`).
- Produces: `docs/restore-runbook.md` (linked from `README.md`).

**Steps:**
- [ ] Step 1: Read the restore request schema Phase 7 shipped: `grep -rn "confirmName\|acknowledgeOverwrite\|sameDatabase\|409" src/worker src/shared | head -20`. The docs below follow the owner's round 2 answers 19 and 20: the typed destination target name is always required; `acknowledgeOverwrite: true` is additionally required when the destination is the source database (the API answers 400 otherwise); the API answers 409 when the destination has an active backup or restore. If the code differs from these three facts, the code wins: fix the sentences in "Restore from the dashboard" and record a `> Deviation:` line. Record the actual field names in your notes.
- [ ] Step 2: Confirm the download route and the 15 minute limit: `grep -rn "download-url\|download_url_ttl_seconds\|900" src/worker | head -10` - Expected: a route and a TTL capped at 900 seconds. If the cap differs, fix "15 minutes at most" here and in `README.md` (Task 8).
- [ ] Step 3: Create `docs/restore-runbook.md`:
````markdown
# Restore runbook

This page explains how to restore a Cellar backup.
Backups are PostgreSQL custom-format dumps (`pg_dump -Fc`).
You can restore from the dashboard or by hand with `pg_restore`.

Restoring is destructive.
Cellar runs `pg_restore --clean --if-exists --no-owner`, which drops and recreates every object in the dump inside the destination database.
Practice on a scratch database first.

## Before you start

- Pick the destination database.
  Cellar has no default destination.
  Cellar never creates databases, so the destination must already exist.
- Use a restore role, not the backup role.
  See [Restore role](vm-onboarding.md#4-restore-role).
- The destination must be a database registered in Cellar with a **restore connection URL**.
- Use a `pg_restore` that is at least as new as the PostgreSQL server that was backed up.
  An older `pg_restore` fails with `unsupported version ... in file header`.

## Restore from the dashboard

1. Open the target, find the backup in the history table, and select **Restore**.
2. Choose the destination database from the list of registered databases.
3. Type the destination name to confirm.
   This is always required.
4. If the destination is the same database the backup came from, the dialog shows an extra warning and an **I understand this overwrites the live data** checkbox.
   Read the warning and tick the box.
   The restore overwrites the live data.
   Without the checkbox, the API rejects the request with `400`.
5. Confirm.
   Cellar queues the restore job.
   If the destination already has a backup or a restore running, Cellar rejects the request with `409`.
   Wait for the running job to finish and try again.
6. Watch the restore status on the target page until it shows `success` or `failed`.
   A failed restore shows a redacted error message.

Every restore is written to the audit log with the person who started it.

## Restore by hand

Use this when the dashboard is not available or when you want to restore on your own machine.

1. Get a download link.
   In the dashboard, select **Download** on the backup.
   The link works for 15 minutes at most.
2. Download the file:

   ```bash
   curl -fL -o backup.dump "<presigned-url>"
   ```

3. Check the checksum.
   It must equal the `sha256` value of the backup in Cellar:

   ```bash
   shasum -a 256 backup.dump
   ```

4. Check that the archive is readable:

   ```bash
   pg_restore --list backup.dump | head
   ```

5. Create an empty scratch database on the server you restore to:

   ```bash
   createdb -h <host> -U <restore-role> shop_restore_test
   ```

6. Restore:

   ```bash
   pg_restore --clean --if-exists --no-owner -h <host> -U <restore-role> -d shop_restore_test backup.dump
   ```

   `pg_restore` prints a message for each object that it cannot drop on a fresh database.
   With `--if-exists` those messages are not errors.
   Real errors stop the object they belong to.
   Read the output before you trust the result.

## Verify a restore

Compare the restored database with the source, or with what you expect.

Count the rows of every table in both databases and compare the two lists:

```bash
cat > counts.sql <<'SQL'
SELECT format('SELECT %L AS table_name, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1 \gexec
SQL

psql -h <source-host> -U <role> -d shop -At -f counts.sql > source-counts.txt
psql -h <host> -U <restore-role> -d shop_restore_test -At -f counts.sql > restored-counts.txt
diff source-counts.txt restored-counts.txt && echo identical
```

Counts differ if the source took writes after the backup finished.
Compare against the backup time, not against the live source.

Then run two or three queries that your application depends on and check the answers.

When you are done with a scratch database, drop it:

```bash
dropdb -h <host> -U <restore-role> shop_restore_test
```
````

- [ ] Step 4: Verify - Run: `bun scripts/check-readme.ts docs/restore-runbook.md docs/vm-onboarding.md` - Expected: `docs cross-check OK: 2 files` (this checks the one-sentence rule, links, and banned strings; the `pg_restore` flags and the row count query were run by `sql-check.sh` in Task 5, but they are not extracted from this file)
- [ ] Step 5: Commit - `git add docs/restore-runbook.md && git commit -m "docs: add restore runbook"`

---

### Task 7: README, part 1 (top of the file through Access setup)

**Files:**
- Modify: `README.md` (anchors: `> Every Postgres, aged and cellart safe.`, `https://github.com/<your-org>/cellar.git`, `- **Automatic cleanup**`, `1. Every 5 minutes`, `- [Bun](https://bun.sh) and`, `### 2. Create Cloudflare resources`, `### 4. Set secrets`, `Cellar verifies the Access JWT on every request.`)

**Interfaces:**
- Consumes: `.dev.vars.example` and the `vars` block of `wrangler.jsonc` as they are after Phases 5 and 8; the Phase 5 callback path.
- Produces: README sections "Quick start" 2, 4, 6 that match the code, and the variable table (names later checked by `check-readme.ts`).

**Steps:**
- [ ] Step 1: Reconcile the variable list with the code before editing. Run `grep -E '^[A-Z]' .dev.vars.example` and `grep -n -A8 '"vars"' wrangler.jsonc`. Expected (planned): `.dev.vars.example` lists `ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `DEV_BYPASS`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `APP_BASE_URL`. The table in Step 7 follows that list: names in the `vars` block of `wrangler.jsonc` get the Kind `var`, all others get `secret` (except `DEV_BYPASS`, which is `local only`). If the real list differs, change the table, the `wrangler secret put` lines, and the `vars` JSON example to match the code.
- [ ] Step 2: Tagline (round 2, answer 27). Replace `> Every Postgres, aged and cellart safe.` with `> Every Postgres, aged and kept safe.`
- [ ] Step 3: In the Features list replace the bullet `- **Automatic cleanup** - expired backups are deleted from R2 automatically` with:
````markdown
- **Automatic cleanup** - expired backups are deleted from R2 automatically (retention starts in dry-run mode, see [Retention](#retention-gfs))
````

- [ ] Step 4: In "How a backup runs" replace `1. Every 5 minutes, the Cron Trigger finds databases that are due and enqueues jobs.` with `1. Every minute, the Cron Trigger finds databases that are due and enqueues jobs.`
- [ ] Step 5: In Requirements replace the Bun and Wrangler bullet (the line that starts `- [Bun](https://bun.sh) and`) with:
````markdown
- [Bun](https://bun.sh) (`bun install` also installs [Wrangler](https://developers.cloudflare.com/workers/wrangler/))
````

In the same step, in Quick start "1. Clone and install", replace `https://github.com/<your-org>/cellar.git` with `https://github.com/theerakarnm/cellar.git` (round 2, answer 25).

- [ ] Step 6: In Quick start, replace the fenced `bash` block between `### 2. Create Cloudflare resources` and the line `Copy the generated IDs into` (the three `wrangler ... create` commands) with:
````markdown
```bash
bunx wrangler login
bunx wrangler d1 create cellar
bunx wrangler r2 bucket create cellar-backups
bunx wrangler queues create cellar-jobs
```
````

Quick start step 3 keeps `bun run db:migrate:remote` and step 5 keeps `bun run deploy`. Do not change them (both script names exist in `package.json`). Do NOT run them.
- [ ] Step 7: Replace everything from the line `### 4. Set secrets` up to, but not including, the line `For local development, copy` with:
````markdown
### 4. Create the R2 API token and set configuration

Cellar's container writes backups to R2 with an S3 API token.
Give it as little access as possible:

1. In the Cloudflare dashboard, go to **R2 > Manage API tokens** and create an API token.
2. Set the permission to **Object Read and Write**.
3. Limit the token to the bucket `cellar-backups` only.
   Never use an account-wide token.
4. Copy the **Access Key ID** and the **Secret Access Key**.
   The secret is shown only once.

Cellar hands this token to each job at run time.
It is never put in the image, in queue messages, or in logs.
See the [R2 token docs](https://developers.cloudflare.com/r2/api/tokens/).

Set the secrets:

```bash
bunx wrangler secret put ENCRYPTION_KEY          # 32-byte base64 key, see below
bunx wrangler secret put ACCESS_TEAM_DOMAIN      # e.g. yourteam.cloudflareaccess.com
bunx wrangler secret put ACCESS_AUD              # Access application AUD tag
bunx wrangler secret put R2_ACCESS_KEY_ID        # from the R2 token
bunx wrangler secret put R2_SECRET_ACCESS_KEY    # from the R2 token
```

Set the plain values in the `vars` block of `wrangler.jsonc`:

```jsonc
"vars": {
  "R2_ENDPOINT": "https://<account-id>.r2.cloudflarestorage.com",
  "R2_BUCKET": "cellar-backups",
  "APP_BASE_URL": "https://cellar.example.com"
}
```

| Name | Kind | Meaning |
|---|---|---|
| `ENCRYPTION_KEY` | secret | Base64 of 32 random bytes. Encrypts stored credentials. |
| `ACCESS_TEAM_DOMAIN` | secret | Your Access team domain, hostname only. |
| `ACCESS_AUD` | secret | Audience (AUD) tag of the Cellar Access application. |
| `R2_ACCESS_KEY_ID` | secret | Access Key ID of the bucket-scoped R2 token. |
| `R2_SECRET_ACCESS_KEY` | secret | Secret Access Key of the same token. |
| `R2_ENDPOINT` | var | S3 endpoint of your R2 account. |
| `R2_BUCKET` | var | Name of the backup bucket. |
| `APP_BASE_URL` | var | Public URL of Cellar. Used for links in alerts. |
| `DEV_BYPASS` | local only | `true` skips Access for requests to `localhost`. Never set it in production. |

Generate an encryption key:

```bash
openssl rand -base64 32
```

> **Keep `ENCRYPTION_KEY` safe.** If you lose it, stored connection URLs cannot be decrypted and every database must be re-registered. Backups in R2 are not affected.
````

- [ ] Step 8: Replace the two lines that start `Cellar verifies the Access JWT on every request.` with ONE of the two variants. Choose with this rule: run `grep -rn "outbound" src/worker/container src/worker/index.ts | head`. If Phase 5 wired an outbound handler and the job payload's `callbackUrl` points at it, use variant A. Otherwise (the public route `/internal/jobs/callback` is used) use variant B. The real deployed confirmation of the outbound path is a Phase 5 Human item. Do not claim more than the code does.
Variant A:
````markdown
Cellar verifies the Access JWT on every `/api` request, except `GET /api/health`, which returns only `{ "ok", "version" }` (the fields `ok` and `version`, nothing about targets or config).
Requests without a valid token are rejected with `401`.

The container reports job results to the Worker through the Worker's outbound handler inside Cloudflare, not over the public internet.
The route `/internal/jobs/callback` is outside `/api`, is not covered by the Access check, and accepts only requests with a valid HMAC signature.
You do not need an Access bypass.
````

Variant B:
````markdown
Cellar verifies the Access JWT on every `/api` request, except `GET /api/health`, which returns only `{ "ok", "version" }` (the fields `ok` and `version`, nothing about targets or config).
Requests without a valid token are rejected with `401`.

The container reports job results to `POST /internal/jobs/callback` on the public Worker URL.
Access must let this one path through, or every job will look like it timed out:

1. In Zero Trust, add a second self-hosted application with the domain `cellar.example.com/internal/jobs/callback`.
2. Give it one policy with action **Bypass** for **Everyone**.
3. Do not bypass any other path.

The route is protected by its own checks instead: an HMAC-SHA256 signature made with a per-job key, a timestamp that must be less than 5 minutes old, and a sequence number that rejects replays.
````

- [ ] Step 9: Verify - Run: `bun scripts/check-readme.ts README.md 2>&1 | grep -E "env var|d1 |r2 |queue|route|hostname|bun run|wrangler|em dash|placeholder|hex|JWT"; echo "left=$?"` - Expected: no matching lines, then `left=1` (grep found nothing). Failures still allowed at this point: `contains typo cellart` (fixed in Task 8) and `more than one sentence on a line` (fixed in Task 9). The baseline from Task 1 Step 6 showed the `env var` and `d1` lines that these edits remove.
- [ ] Step 10: Commit - `git add README.md && git commit -m "docs: update README setup, secrets, and access sections to match the code"`

---

### Task 8: README, part 2 (connecting, retention, restore, alerts, security, development)

**Files:**
- Modify: `README.md` (anchors: `## Connecting a database (per VM)`, `## Retention (GFS)`, `## Restoring a backup`, `## Alerts`, `## Security`, `## Limits and considerations`, `## Development`)

**Interfaces:**
- Consumes: `docs/vm-onboarding.md` and `docs/restore-runbook.md` (Tasks 5 and 6); `SECURITY.md` (Task 2); `CONTRIBUTING.md` (Task 4); the Phase 6 dry-run default; the Phase 8 alert rules; the final directory layout.
- Produces: the finished README content (still multi-sentence lines until Task 9).

**Steps:**
- [ ] Step 1: Replace everything from `## Connecting a database (per VM)` up to, but not including, `## Retention (GFS)` with the text below. There is no direct mode (round 2, answer 1), so no connection mode callout:
````markdown
## Connecting a database (per VM)

Do this once for each VM that hosts a database.
The full guide is [docs/vm-onboarding.md](docs/vm-onboarding.md).

1. **Tunnel.** Add `cloudflared` to the VM's docker-compose stack and create a public TCP hostname for Postgres. Postgres needs no published port.
2. **Access.** Protect that hostname with an Access application that allows only a Cellar **service token**.
3. **Backup role.** Create a read-only role. The guide has the SQL for PostgreSQL 14 and newer (`pg_read_all_data`) and for PostgreSQL 13 (explicit grants).
4. **Restore role.** Prepare a role that can drop and create objects in the destination database.
5. **Register it.** In the dashboard, select **Add database**, fill in the connection details, schedule, retention, and alert channels. Cellar saves it as disabled. Click **Test connection**, and enable the database when the test passes.
````

- [ ] Step 2: Replace everything from `## Retention (GFS)` up to, but not including, `## Restoring a backup` with:
````markdown
## Retention (GFS)

Each database has its own policy:

| Setting | Meaning |
|---|---|
| `keep_last` | Keep the N newest successful backups |
| `daily` | Keep the newest backup of each of the last N days that have a backup |
| `weekly` | Keep the newest backup of each of the last N weeks that have a backup (ISO weeks, Monday start) |
| `monthly` | Keep the newest backup of each of the last N calendar months that have a backup |
| `max_age_days` | Optional. Backups older than this are not kept by any rule, except the latest successful backup |

Days, weeks, and months are counted in the database's time zone.
A rule that is empty or `0` is off.
Failed and timed-out backups are never counted and never deleted by retention.

A backup is kept if **any** rule wants to keep it.
Everything else is deleted from R2 and then soft-deleted in D1 (the row stays for the audit trail, with a `deleted_at` time).

Example: `keep_last=3, daily=7, weekly=4, monthly=6` with one backup per day keeps 13 to 15 backups that reach back about six months.
The exact number depends on where the weeks and months fall.

Retention runs after every successful backup and once a day.
The target detail page shows a **retention preview** of what the next run would delete.

> **Dry run is on by default.**
> Until you turn it off in **Settings**, retention only logs what it would delete and deletes nothing.
> Check the retention preview first.

**Safety rule:** the most recent successful backup of a database is never deleted, regardless of policy.
````

- [ ] Step 3: Replace everything from `## Restoring a backup` up to, but not including, `## Alerts` with the text below. If Task 6 Step 1 found that the code differs from the round 2 facts, change the numbered list here to match the code:
````markdown
## Restoring a backup

1. Open the database, choose a backup from the history, and select **Restore**.
2. Choose the destination database (it must be registered in Cellar and have a restore connection URL).
3. Type the destination name to confirm. This is always required.
4. If the destination is the source database, also tick the overwrite acknowledgement. Without it the API answers `400`.

Cellar has no default destination and never creates a database.
It runs:

```bash
pg_restore --clean --if-exists --no-owner -d <destination> <backup>
```

> Restoring with `--clean` drops and recreates objects in the destination.
> Cellar shows an extra warning when you restore into the same database the backup came from.
> A restore is rejected with `409` while the destination has a backup or a restore running.
> Test restores into a scratch database first.

To restore by hand, or to check a restore, follow [docs/restore-runbook.md](docs/restore-runbook.md).
````

- [ ] Step 4: Replace everything from `## Alerts` up to, but not including, `## Security` with:
````markdown
## Alerts

Configure channels under **Settings > Alert channels**:

- **LINE** - Messaging API channel access token and target user or group ID
- **Discord** - webhook URL (it must start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`, other URLs are rejected)

Link each database to the channels that should alert for it.
A channel can be linked to many databases, and a database can have many channels.
A database with no linked channel sends no alerts.
The failure threshold and the staleness limit are set per database when you create or edit it.

Alerts fire when:

- a backup fails or times out (every time)
- a database fails N times in a row (N is set per database, default 3, and the alert fires once until a backup succeeds)
- a database has no successful backup within X hours (the staleness check, once per stale period)

By default X is the expected gap between runs plus 2 hours, so a daily schedule goes stale after 26 hours.
You can set X per database.

Each message names the database and project tag, the event, a short redacted error, the time in the database's time zone, and a link to its page.
Alert messages never include connection strings or passwords.
````

- [ ] Step 5: Replace everything from `## Security` up to, but not including the line `Found a vulnerability?` with:
````markdown
## Security

- **Authentication:** Cloudflare Access, with JWT signature, audience, and expiry checked on every `/api` request except `GET /api/health`
- **Network:** Postgres stays private behind Cloudflare Tunnel, no public ports (see [docs/vm-onboarding.md](docs/vm-onboarding.md))
- **Secrets at rest:** connection URLs, service tokens, and alert credentials are encrypted with AES-256-GCM before being stored in D1
- **Secrets in transit:** plaintext values are never returned by the API after saving, and are redacted from logs, errors, and alerts
- **Least privilege:** use a read-only role for backups and a separate, scoped R2 token for the bucket
- **Downloads:** presigned URLs expire in 15 minutes or less, and every download is logged
- **Container callbacks:** signed with HMAC-SHA256 using a per-job key, with a 5 minute timestamp window and a sequence number, so results cannot be forged or replayed
````

- [ ] Step 6: In "Limits and considerations", replace `and the dashboard shows total size per database.` with `and the dashboard shows the total backup size.` Then check the numbers below against the code (round 2, answers 12, 14, and 21): `grep -rni "part_size\|partSize\|max_instances\|max_concurrent_jobs" wrangler.jsonc src/worker container | head -20`. If a default differs, the code wins: fix the bullet and record a `> Deviation:` line. Add these bullets at the end of the "Limits and considerations" list:
````markdown
- Backups are uploaded to R2 in multipart parts of 32 MiB (one config value).
  R2 allows at most 10,000 parts, so one dump can be about 312 GiB (335 GB) at most.
- Add an R2 bucket lifecycle rule that aborts incomplete multipart uploads after 1 day, so a failed upload does not keep using storage.
  Cellar does not create this rule for you.
  See the Cloudflare docs on [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
- At most 2 containers run at once (`max_instances`, configurable).
  Backups use at most `max_instances` - 1 of them (`max_concurrent_jobs`, 1 by default), so one container stays free for a restore or a connection test.
  Restores and connection tests do not count toward that limit.
````
Check that the link answers: `curl -sI https://developers.cloudflare.com/r2/buckets/object-lifecycles/ | head -1` - Expected: `HTTP/2 200`. If it does not, find the current page name in the Cloudflare R2 docs and use that URL.
- [ ] Step 7: Replace everything from `## Development` up to, but not including, `The retention logic lives in a pure function` with:
````markdown
## Development

```bash
bun install
cp .dev.vars.example .dev.vars    # fill in fake values, set DEV_BYPASS=true to skip Access on localhost
bun run db:migrate:local
bun run dev           # Worker + UI with local D1 and R2
bun run test          # Vitest
bun run typecheck
```

Project layout:

```
cellar/
├── src/
│   ├── worker/       # Hono API, cron, queue consumer, retention, alerts
│   └── shared/       # Code shared by the Worker and the UI
├── ui/               # React + Vite dashboard
├── container/        # Dockerfile and job runner (pg_dump / pg_restore)
├── migrations/       # Drizzle migrations for D1
├── test/             # Vitest tests, mirrors the source folders
├── docs/             # Plan, runbooks, onboarding guide
├── wrangler.jsonc
└── .dev.vars.example
```
````

If Phase 9 changed the `dev` script so it serves only the Worker, change the comment on the `bun run dev` line to what `package.json` really does.
- [ ] Step 8: Verify - Run: `bun scripts/check-readme.ts README.md 2>&1 | grep -v "more than one sentence" || echo none-left; for d in src/worker src/shared ui container migrations test docs; do test -d "$d" || echo "MISSING $d"; done` - Expected: `none-left`, and no `MISSING` line (only the sentence-per-line failures remain, and Task 9 fixes them). The `grep -v` prints every failure line that is not a sentence hit, and `none-left` appears only when there are none.
- [ ] Step 9: Commit - `git add README.md && git commit -m "docs: update README sections for onboarding, retention, restore, alerts, and layout"`

---

### Task 9: Reflow README to one sentence per line

**Files:**
- Modify: `README.md` (whole file, mechanical)

**Interfaces:**
- Consumes: `/tmp/phase-10-tools/reflow-md.ts` (Task 1).
- Produces: `README.md` with one full sentence per physical line (`AGENTS.md` rule).

**Gotcha:** the script skips code fences, tables, headings, and comments, keeps list and blockquote prefixes, and is idempotent. It does not split a sentence that ends in `**` before the next sentence (`**Keep ENCRYPTION_KEY safe.** If you ...`). That line stays as one line and the check script does not flag it. Read the diff for broken Markdown (a list item, a blockquote) before committing.

**Steps:**
- [ ] Step 1: Run: `bun /tmp/phase-10-tools/reflow-md.ts README.md`
- [ ] Step 2: Read `git diff README.md | head -200` and check that only line breaks changed in the lines the script touched (lists keep their numbering, blockquotes keep `> `).
- [ ] Step 3: Verify - Run: `bun scripts/check-readme.ts README.md && git diff --stat README.md | tail -1 && bun /tmp/phase-10-tools/reflow-md.ts README.md && git diff --stat README.md | tail -1` - Expected: `docs cross-check OK: 1 files`, then two identical `git diff --stat` summary lines (the second reflow changed nothing)
- [ ] Step 4: Commit - `git add README.md && git commit -m "docs: one sentence per line in README"`

---

### Task 10: Check README claims against the real code

**Files:**
- Modify: `README.md` (only if a check below finds a wrong sentence; anchors: the `max_age_days` table row, `keeps 13 to 15 backups`, the Features list)

**Interfaces:**
- Consumes: `selectBackupsToDelete(backups: RetentionBackup[], policy: RetentionPolicy, now: Date, tz: string): { keep: RetentionBackup[]; delete: RetentionBackup[]; reasons: Record<string, string[]> }` from the file found in the Phase gate (Phase 3). `RetentionBackup = { id: string; status: string; created_at: string }` and `RetentionPolicy = { keep_last: number | null; daily: number | null; weekly: number | null; monthly: number | null; max_age_days?: number | null }` (register, Phase 3).
- Produces: a README whose retention numbers and feature list are proven against the code.

**Steps:**
- [ ] Step 1: If the file that exports `selectBackupsToDelete` is not `src/worker/retention/gfs.ts`, edit the import path in `/tmp/phase-10-tools/check-retention-example.ts` to the real one.
- [ ] Step 2: Run the retention example check (Step 5 is the Verify). If it prints `README says 13 to 15` and exits 1, do NOT change the README number to fit. The planning model used the register's rules (newest backup of each of the N most recent buckets that have a backup, in the target time zone). A different count means the real function disagrees with the register, or the README example needs an owner decision: STOP and report both counts.
- [ ] Step 3: Check the `max_age_days` sentence. Run `grep -rn "max_age" test/worker/retention | head -20` and read the test titles and the rule in the Phase 3 code. The README says: "Backups older than this are not kept by any rule, except the latest successful backup". If the code only limits some of the keeps, change that table cell so it says exactly what the tests assert. Record what you changed.
- [ ] Step 4: Check that every README Features bullet exists in the code. Run: `test -f src/shared/cron.ts || echo "MISSING cron"; for pat in "download-url" "retention-preview" "alert-channels" "audit-logs" "api/settings" "restore"; do grep -rqi "$pat" src/worker || echo "MISSING route $pat"; done; grep -rqE '"/[^"]*backup"' src/worker || echo "MISSING backup-now route"; grep -rq "pg_dump" container || echo "MISSING pg_dump in container"; grep -rq "sha256" container || echo "MISSING sha256 in container"; test -d ui/src || echo "MISSING ui/src"` - Expected: no output. For each `MISSING` line, remove or reword the matching README bullet (Features, Alerts, or Retention) and record it.
- [ ] Step 5: Verify - Run: `bun /tmp/phase-10-tools/check-retention-example.ts` - Expected: a line `kept counts over 730 end dates:` with keys only from 13 to 15, then `README retention example OK`
- [ ] Step 6: Commit only if the README changed in Step 3 or 4 - `git add README.md && git commit -m "docs: correct README claims found by checking against the code"`. If nothing changed, write "no changes" in your notes and make no commit.

---

### Task 11: Update docs/PLAN.md

**Files:**
- Modify: `docs/PLAN.md` (anchors: `CONTRIBUTING.md  SECURITY.md`, `docs/  PLAN.md  research-notes.md`, `Setup per VM: a named Tunnel`)

**Interfaces:**
- Consumes: the files created in Tasks 2 to 6.
- Produces: `docs/PLAN.md` that lists the new files.

**Steps:**
- [ ] Step 1: In `docs/PLAN.md` section 2 (repo structure), keep the line `  README.md  LICENSE  CONTRIBUTING.md  SECURITY.md      (OSS files in phase 10)` and add the new line `  .github/workflows/ci.yml                               (typecheck + test, phase 10)` right under it. If an earlier phase already reformatted that line, grep the anchor `CONTRIBUTING.md  SECURITY.md` and add the CI line under it.
- [ ] Step 2: In the same block replace `  docs/  PLAN.md  research-notes.md` with `  docs/  PLAN.md  research-notes.md  vm-onboarding.md  restore-runbook.md  plans/`.
- [ ] Step 3: In section 7, at the end of the paragraph that starts `Setup per VM: a named Tunnel`, append ` Step by step: [vm-onboarding.md](./vm-onboarding.md).`
- [ ] Step 4: Verify - Run: `grep -c "vm-onboarding.md" docs/PLAN.md; grep -c "ci.yml" docs/PLAN.md; grep -c $'\xe2\x80\x94' docs/PLAN.md` - Expected: `2` or more, `1` or more, `0`
- [ ] Step 5: Commit - `git add docs/PLAN.md && git commit -m "docs: list phase 10 files in PLAN.md"`

---

## Failure handling summary

- **The check script fails on a sentence that is correct** (for example an unusual route literal) - Detect: `check-readme.ts` names one line. Respond: fix the script only if the doc is right and the heuristic is wrong, and record a `> Deviation:`. Never delete a check to get green.
- **A doc sentence contradicts the real code** - Detect: an inspect step in Tasks 5, 6, 7, 8, or 10. Respond: change the doc to match the code and record it. If the code looks wrong against the register or `AGENTS.md`, STOP and report instead of documenting a bug.
- **Tunnel spike failed in Phase 4** - Detect: Phase gate. Respond: STOP. The onboarding guide describes the tunnel path.
- **`sql-check.sh` fails on the PG13 block** - Detect: the script exits non-zero in Task 5. Respond: fix the SQL in `docs/vm-onboarding.md` (the tool wins) and re-run. If it fails 3 times, STOP and report.

## End-to-end verification

- [ ] Run: `bun run test && bun run typecheck` - Expected: both exit 0 (Phase 10 adds no code, so the result equals the Phase gate result)
- [ ] Run: `bun scripts/check-readme.ts --wrangler; echo "exit=$?"` - Expected: `docs cross-check OK: 6 files, ...` then `exit=0`. `--wrangler` ran `bunx wrangler <cmd> --help` for `login`, `d1 create`, `r2 bucket create`, `queues create`, and `secret put`. Paste the full output in the final summary. This is the PRD "Done when" evidence: every command in the README was cross-checked against `package.json` and `wrangler.jsonc`.
- [ ] Run: `export PATH=/opt/homebrew/opt/postgresql@16/bin:$PATH; bash /tmp/phase-10-tools/sql-check.sh docs/vm-onboarding.md | tail -8` - Expected: the output ends with `row counts identical:` and three table lines
- [ ] Run (the same three commands CI runs, from a clean clone of the committed state): `rm -rf /tmp/phase-10-clean && git clone -q . /tmp/phase-10-clean && cd /tmp/phase-10-clean && bun install --frozen-lockfile && bun run typecheck && bun run test; echo "exit=$?"` - Expected: `exit=0`
- [ ] Run: `git status --short; git log --oneline main..HEAD | cat` - Expected: clean tree; commits for Tasks 1 to 9 and 11 (Task 10 only if it changed something); every changed file is `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `scripts/check-readme.ts`, a file under `docs/`, or `.github/workflows/ci.yml` (check with `git diff --stat main..HEAD`)
- [ ] Manual: copy `.dev.vars.example` to `.dev.vars` with fake values and `DEV_BYPASS=true`, start `bun run dev` in the background, wait for the `Ready on http://localhost:8787` line (use the port it prints), then run `curl -s -w ' %{http_code}\n' localhost:8787/api/health` and `curl -s -o /dev/null -w '%{http_code} %{content_type}\n' localhost:8787/`, then stop the server and delete `.dev.vars` - Expected: `{"ok":true,"version":"..."} 200`, then `200 text/html...` (proves the README claim "Worker + UI" for `bun run dev`; if `/` is not HTML, reword the comment on the `bun run dev` line in the README Development block)
- [ ] 👤 Human: push the branch and open a pull request, then look at the `CI` check on GitHub - Expected: job `check` is green (install, typecheck, and test all pass on `ubuntu-latest`) - Proxy: the clean-clone Run above runs the same three commands on the committed state, so it proves everything except the GitHub runner environment (`workerd` on Linux is the one unproven point). The agent does not push.

When all boxes are ticked, end with the phase summary required by `AGENTS.md`:

- ✅ Completed: the files created and the README sections changed.
- 🧪 Tests and results: `bun run test` and `bun run typecheck` results, the pasted `check-readme.ts --wrangler` output, the `sql-check.sh` tail, the retention example output, and the clean-clone result.
- Root and shared edits (round 2, answer 6): `scripts/check-readme.ts` (new, run in CI) and `.github/workflows/ci.yml` (new). No `package.json` change, no shared code.
- ⚠️ Open issues and decisions needed: A6 (owner enables GitHub private vulnerability reporting); the CI Human check (not yet run); every `> Deviation:` made; that PostgreSQL 13 and 14 servers were not available for the SQL check (PostgreSQL 16 only); that the README "13 to 15" number was proven against the real function (or the mismatch that stopped Task 10).
