# Phase 1: Foundation Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-1-foundation.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Preflight` checks BEFORE task 0 and report anything down.
> The code in the steps is a reference implementation that was type-checked and run in a scratch project, but not in this repo.
> When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Scaffold the Cellar repo, define the full D1 schema with a first migration applied to local D1 only, and build the Access JWT middleware, AES-256-GCM crypto util, and redaction util, all unit-tested.
**Architecture:** One Cloudflare Worker (Hono) under `src/worker/`. `GET /api/health` is open. Every other `/api/*` route goes through an Access middleware that verifies the RS256 JWT with WebCrypto against the team JWKS (cached in memory). Drizzle defines the schema, `drizzle-kit` emits SQL into `/migrations`, and `wrangler d1 migrations apply --local` applies it to a simulated local D1.
**Tech Stack:** Bun 1.3, TypeScript, Hono, Drizzle ORM + drizzle-kit, Wrangler (local only), Vitest (Node environment, WebCrypto).
**Spec:** `docs/PLAN.md` (sections 2 and 3 for structure and schema, section 4 for the health route) plus the Phase 1 prompt in the conversation. Phase prompt wins where the two differ (see "Decisions that differ from docs/PLAN.md").
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD`). The tree is empty except `LICENSE`, `README.md`, and staged-but-uncommitted `AGENTS.md` and `docs/`.
**Confidence:** 8/10. Rubric: start 10, minus 2 because the Verify and Preflight commands were run in a scratch project in `/tmp`, not in this repo (the independent review found one such command, the `git check-ignore` check, that could not pass as first written; it is fixed). No other deductions. Residual risk: nothing was run against a real Cloudflare Access JWKS (needs real resources), and dependency versions are the latest at planning time.
**NOT building:**
- Targets API, Zod schemas, audit-log writing, CRUD of any kind (Phase 2).
- UUIDv7 generator, `src/worker/lib/hmac.ts`, `r2-key.ts`, `tz.ts`, `schedule.ts` (later phases).
- Queue consumer, cron trigger, `scheduled` handler, Container binding or class (Phases 4-5). Only the Queue **producer** binding is declared.
- `src/worker/db/client.ts` (no code queries D1 yet), `routes/`, `error.ts`/`audit.ts` middleware.
- UI, `ui/` directory, Workers Static Assets binding.
- `zod` dependency (first used in Phase 2).
- Any remote command: no `wrangler deploy`, no `--remote`, no `wrangler secret put`, no resource creation.
- Live verification against a real Access JWKS endpoint.
- Settings seed rows. Defaults for `settings` keys live in code and are introduced by the phase that reads them.
- `@cloudflare/vitest-pool-workers` (tests run in plain Node Vitest; the code under test only needs WebCrypto and `fetch`).

## Decisions that differ from docs/PLAN.md

The Phase 1 prompt overrides the original `docs/PLAN.md` in these places. `docs/PLAN.md` and `AGENTS.md` were already updated to match (owner round 2), so no task edits them.

1. **Source root is `src/worker/`**, tests are in `test/worker/`. PLAN.md section 2 shows `src/` and `test/`.
2. **`GET /api/health` is unauthenticated** (owner approved, round 2). `AGENTS.md` and `docs/PLAN.md` already say so. The route returns only `{ ok, version }`, nothing about targets or config.
3. **Encrypted value format is `v1:<base64 iv>:<base64 ciphertext+tag>`.** PLAN.md section 3 says `base64(iv || ciphertext || tag)` with a `v1:` prefix. WebCrypto returns ciphertext with the tag appended, so the content is the same.
4. **`encrypt` and `decrypt` take the key as a second argument** (`encrypt(plaintext, keyBase64)`). The prompt shows `encrypt(plaintext)`, but a Worker has no global env, and passing the key keeps the functions pure and testable. `ENCRYPTION_KEY` must be base64 of exactly 32 bytes.
5. **Schema amendments to `docs/PLAN.md` section 3** (already applied to PLAN.md by the owner's round 2 update). Later phases need these, and doing them now avoids table rebuilds:
   - `targets.project_tag` (text, nullable) and `targets.alert_failure_threshold` (integer, NOT NULL, default 3).
   - The unique index on `targets.name` is partial: `uq_targets_name ... WHERE deleted_at IS NULL`, so a soft-deleted target's name can be reused.
   - There is no direct connection mode. Tunnel hostname and token columns stay `NOT NULL`.
   - `alert_channels.target_id` is removed. New table `target_alert_channels (target_id, channel_id)` with a composite primary key and an index on `channel_id` links channels to targets (many to many).
   - `backups.duration_ms` (integer) and `backups.deleted_reason` (text) are added.
6. **`DEV_BYPASS` has two conditions:** the value must be exactly `"true"` AND the request host must be `localhost`, `127.0.0.1`, or `[::1]`. This is stricter than "set explicitly" so a stray production variable cannot open the API.

## Dependencies that need your approval

AGENTS.md says to stop and ask before adding a dependency that is not listed. These are not listed but are required by the Phase 1 prompt (scripts, migrations, typecheck):

| Package | Why | Kind |
|---|---|---|
| `wrangler` | `dev`, `deploy`, local D1 migrations | dev |
| `drizzle-kit` | generate SQL migrations from the schema | dev |
| `typescript` | `typecheck` script | dev |
| `@cloudflare/workers-types` | `D1Database`, `R2Bucket`, `Queue`, WebCrypto types | dev |

Listed and used: `hono`, `drizzle-orm` (runtime), `vitest` (dev). The owner approved the four packages above (round 2).

## Global Constraints

- TypeScript everywhere; Bun is the package manager; `bun run test` runs Vitest.
- Worker is Hono on Cloudflare Workers; D1 + Drizzle ORM; migrations live in `/migrations`.
- Auth: Cloudflare Access. The Worker verifies `Cf-Access-Jwt-Assertion` on every request except `GET /api/health` (JWKS signature, `aud`, `exp`). `DEV_BYPASS` may skip this only in local dev. Any failure is `401`.
- Connection URLs, tunnel service tokens, and alert credentials are encrypted at rest with AES-256-GCM via WebCrypto, key from the `ENCRYPTION_KEY` secret. Never return them in plaintext. Never log them.
- Redact connection strings and passwords from logs, errors, API responses, and alerts.
- Never hardcode secrets. Document every secret in `.dev.vars.example`.
- All ids are text; all times are UTC ISO-8601 text. Column names are `snake_case`.
- Schema must match `docs/PLAN.md` section 3 exactly (columns, defaults, NOT NULL, indexes).
- Error body shape: `{ "error": { "code": string, "message": string } }`.
- Do not guess Cloudflare APIs or limits; write [uncertain] when unsure.
- Stop and ask before any real Cloudflare resource, `wrangler deploy`, any remote command, or any unlisted dependency (see table above).
- If the same step fails 3 times, stop and report what you tried.
- No em dash in any file you write. Use a plain dash.
- Do not add the agent as co-author in commit messages.

## Patterns to Mirror

No existing code in the repo. Establishing these conventions (taken from `docs/PLAN.md` and `AGENTS.md`):

- **Naming:** files are `kebab-case.ts`; Drizzle tables are plural `snake_case` SQL names with `camelCase` TS properties (`dbName: text("db_name")`); indexes are `idx_<table>_<what>`, unique indexes `uq_<table>_<what>`.
- **Error handling:** the middleware logs a short reason code with `console.warn` (never the token or any claim) and returns the generic `401` body. Crypto errors never include plaintext, ciphertext, or key.
- **Tests:** Vitest, files at `test/worker/<mirrors src/worker path>.test.ts`, Node environment, Hono apps tested with `app.request(url, init, env)`.

## Preflight

### DURABLE - true until the repo itself changes

- **The lockfile is Bun's.** Evidence: `package.json` is created by Task 1 and installed with `bun add`; no npm/yarn lockfile is ever created.
- **Local D1 accepts a placeholder `database_id`.** Evidence: `wrangler d1 migrations apply cellar --local` ran successfully in a scratch project with `database_id` set to all zeros and printed `Executing on local database cellar (00000000-0000-0000-0000-000000000000) from .wrangler/state/v3/d1`. Consequence: no real resource is needed.
- **`drizzle-kit generate` emits partial and `DESC` indexes that SQLite accepts.** Evidence: the exact schema in Task 4 was generated and applied in a scratch project; all 13 indexes were present in `sqlite_master`. Consequence: Task 4 can rely on the reference schema.
- **Hono registers handlers in order.** A handler that returns a response (`/api/health`) ends the chain before a later `app.use`. Evidence: scratch test `serves /api/health without authentication` passed with this order.

### PERISHABLE - recapture before task 0

- **Bun is installed.** Check: `bun --version` - Expected: `1.3.x` (planning run: 1.3.5). Needed by: every task.
- **Node is available for Vitest.** Check: `node --version` - Expected: 20 or newer (planning run: v22.19.0). Needed by: every test run.
- **Git state.** Check: `git status --short && git rev-parse --short HEAD` - Expected: AGENTS.md, docs/PLAN.md, docs/research-notes.md listed as added/untracked (` A` or `??`), HEAD `5f7ddc8`. Needed by: Task 0 and every commit. If `docs/plans/` also appears, that is this plan file.
- **No `package.json` yet, no `node_modules`.** Check: `ls package.json node_modules 2>&1` - Expected: both "No such file". Needed by: Task 1.
- **Network access to the npm registry** for `bun add`. Check: `bun pm view hono version` is not usable before Task 1 (no package.json). Use `curl -sI https://registry.npmjs.org/hono | head -1` - Expected: `HTTP/2 200`. Needed by: Task 1.
- **Free port 8799** for the end-to-end dev server. Check: `lsof -i :8799` - Expected: no output. If used, pick another port and use it in every end-to-end command. Needed by: End-to-end verification only.
- **Baseline red count.** The repo has no code, so the baseline is: typecheck, tests, and lint do not exist yet. Every Verify below is therefore absolute ("0 errors", "N pass, 0 fail"). Re-check with: `ls package.json 2>&1`.
- **Dependency versions** resolved at planning time (informational, `bun.lock` is the source after Task 1): hono 4.13.x, drizzle-orm 0.45.x, drizzle-kit 0.31.x, wrangler 4.152.x, vitest 5.0.x, typescript 7.0.x, @cloudflare/workers-types 5.x. If `bun add` resolves a new major version of any, run the verifies anyway and record a deviation if the reference code no longer compiles.
- **Secrets.** None needed. `ENCRYPTION_KEY` in tests is a fixed fake key built in the test file. The end-to-end run uses a throwaway `.dev.vars` (gitignored) with fake values.

## Execution

**Tracks:** one track, sequential. Phase 1 tasks 2, 3, 4, and 5 do not depend on each other, but each is below the parallel cost floor (fewer than 3 tasks or 5 files per track), so they run in one worktree.
**Merge order:** not applicable (single track).
**Shared files:** `package.json` and `bun.lock` are owned by Task 1 only. `docs/PLAN.md` and `AGENTS.md` are not edited by any task. `.dev.vars.example` is owned by Task 1 only.
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch: `git switch -c phase-1-foundation`.
**treehouse:** installed (`/Users/jametirakarn/.local/bin/treehouse`), not needed for a single track.

---

### Task 0: Commit the planning documents

**Files:**
- Commit only: `AGENTS.md`, `docs/PLAN.md`, `docs/research-notes.md`, `docs/plans/2026-10-24-phase-1-foundation.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a clean base so later diffs only show Phase 1 work.

**Steps:**
- [ ] Step 1: Create the branch: `git switch -c phase-1-foundation`
- [ ] Step 2: Stage and commit exactly these files (do not use `git add -A`):
      ```bash
      git add AGENTS.md docs/PLAN.md docs/research-notes.md docs/plans/2026-10-24-phase-1-foundation.md
      git commit -m "docs: add agent instructions, implementation plan, research notes, phase 1 plan"
      ```
- [ ] Step 3: Verify - Run: `git status --short` - Expected: no output (clean tree)

---

### Task 1: Repo scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `wrangler.jsonc`, `.dev.vars.example`, `.gitignore`, `src/worker/env.ts`, `bun.lock` (emitted by `bun add`)
- This task exceeds the usual 3-file ceiling on purpose: these files only build together, and each commit must build.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Env` interface in `src/worker/env.ts` (below), used by Tasks 5 and the Hono generics.
  - npm scripts `dev`, `test`, `typecheck`, `db:generate`, `db:migrate:local`, `db:migrate:remote`, `deploy`.
  - `wrangler.jsonc` bindings `DB` (D1 `cellar`), `BACKUPS` (R2 `cellar-backups`), `JOBS` (Queue producer `cellar-jobs`).

**Gotcha:** `vitest run` exits with code 1 when no test files exist, so Task 1 verifies it with `--passWithNoTests`. The `deploy` and `db:migrate:remote` scripts are defined but must never be run in this phase.

**Steps:**
- [ ] Step 1: Create `package.json` (no dependencies yet):
      ```json
{
  "name": "cellar",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply cellar --local",
    "db:migrate:remote": "wrangler d1 migrations apply cellar --remote",
    "deploy": "wrangler deploy"
  }
}
```
- [ ] Step 2: Install dependencies (this writes `dependencies`, `devDependencies`, and `bun.lock`):
      ```bash
      bun add hono drizzle-orm
      bun add -d drizzle-kit wrangler vitest typescript @cloudflare/workers-types
      ```
- [ ] Step 3: Create `tsconfig.json`:
      ```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test", "drizzle.config.ts", "vitest.config.ts"]
}
```
- [ ] Step 4: Create `vitest.config.ts`:
      ```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```
- [ ] Step 5: Create `drizzle.config.ts`:
      ```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
});
```
- [ ] Step 6: Create `wrangler.jsonc` (placeholder IDs only):
      ```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "cellar",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-10-01",
  // Placeholder IDs and names. Replace with real values only after the owner approves creating the resources.
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cellar",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ],
  "r2_buckets": [{ "binding": "BACKUPS", "bucket_name": "cellar-backups" }],
  "queues": { "producers": [{ "binding": "JOBS", "queue": "cellar-jobs" }] }
}
```
- [ ] Step 7: Create `.dev.vars.example`:
      ```dotenv
# Copy to .dev.vars for local development. Never commit .dev.vars.
# Production values are set with `wrangler secret put` (only after owner approval).

# 32 random bytes, base64-encoded. Generate: openssl rand -base64 32
ENCRYPTION_KEY=

# Cloudflare Access team domain, hostname only. Example: myteam.cloudflareaccess.com
ACCESS_TEAM_DOMAIN=

# Application Audience (AUD) tag of the Cellar Access application.
ACCESS_AUD=

# Local development only. "true" skips Access verification for requests to localhost.
# Leave empty everywhere else.
DEV_BYPASS=
```
- [ ] Step 8: Create `.gitignore`:
      ```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
*.log
.DS_Store
```
- [ ] Step 9: Create `src/worker/env.ts`:
      ```ts
export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  JOBS: Queue;
  ENCRYPTION_KEY: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_BYPASS?: string;
}
```
- [ ] Step 10: Verify - Run: `bun run typecheck && bunx vitest run --passWithNoTests` - Expected: `tsc` prints nothing and exits 0; Vitest prints "No test files found" and exits 0
- [ ] Step 11: Verify - Run: `git check-ignore .dev.vars .wrangler/state/x node_modules/x | wc -l; git check-ignore .dev.vars.example; echo "exit=$?"` - Expected: `3`, then `exit=1` (the example file is NOT ignored)
- [ ] Step 12: Commit - `git add package.json bun.lock tsconfig.json vitest.config.ts drizzle.config.ts wrangler.jsonc .dev.vars.example .gitignore src/worker/env.ts && git commit -m "chore: scaffold worker project, tooling, and wrangler placeholders"`

---

### Task 2: Encryption util

**Files:**
- Create: `src/worker/lib/crypto.ts`
- Test: `test/worker/lib/crypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `encrypt(plaintext: string, keyBase64: string): Promise<string>` - returns `v1:<base64 iv>:<base64 ciphertext+tag>`; throws `Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes")` for a bad key.
  - `decrypt(payload: string, keyBase64: string): Promise<string>` - throws `Error("Decryption failed")` for a wrong version, malformed payload, tampered data, or wrong key.

**Gotcha:** `decrypt` collapses every failure into the same message on purpose, so errors never reveal which part was wrong. `atob` throws on invalid base64; both functions catch that.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/crypto.ts`:
      ```ts
const VERSION = "v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(keyBase64);
  } catch {
    throw new Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  }
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Returns `v1:<base64 iv>:<base64 ciphertext+tag>`. A fresh 12-byte IV is used per call. */
export async function encrypt(plaintext: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decrypt(payload: string, keyBase64: string): Promise<string> {
  const key = await importKey(keyBase64);
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error("Decryption failed");
  try {
    const iv = fromBase64(parts[1] ?? "");
    const ciphertext = fromBase64(parts[2] ?? "");
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Decryption failed");
  }
}
```
- [ ] Step 2: Create `test/worker/lib/crypto.test.ts`:
      ```ts
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../../../src/worker/lib/crypto";

const keyA = btoa(String.fromCharCode(...new Uint8Array(32).fill(1)));
const keyB = btoa(String.fromCharCode(...new Uint8Array(32).fill(2)));

describe("crypto", () => {
  it("roundtrips, including unicode and empty strings", async () => {
    for (const text of ["postgres://u:p@h:5432/db", "", "รหัสผ่าน-🔑"]) {
      expect(await decrypt(await encrypt(text, keyA), keyA)).toBe(text);
    }
  });

  it("uses the v1:<iv>:<ciphertext> format with a 12-byte IV", async () => {
    const [version, iv, ciphertext, extra] = (await encrypt("secret", keyA)).split(":");
    expect(version).toBe("v1");
    expect(atob(iv ?? "").length).toBe(12);
    expect(ciphertext).toBeTruthy();
    expect(extra).toBeUndefined();
  });

  it("uses a different IV and ciphertext every time", async () => {
    const first = await encrypt("same", keyA);
    const second = await encrypt("same", keyA);
    expect(first).not.toBe(second);
    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
  });

  it("does not contain the plaintext", async () => {
    expect(await encrypt("super-secret-value", keyA)).not.toContain("super-secret-value");
  });

  it("rejects tampered ciphertext", async () => {
    const [version, iv, ciphertext] = (await encrypt("secret", keyA)).split(":");
    const bytes = Uint8Array.from(atob(ciphertext ?? ""), (c) => c.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = `${version}:${iv}:${btoa(String.fromCharCode(...bytes))}`;
    await expect(decrypt(tampered, keyA)).rejects.toThrow("Decryption failed");
  });

  it("rejects the wrong key", async () => {
    await expect(decrypt(await encrypt("secret", keyA), keyB)).rejects.toThrow("Decryption failed");
  });

  it("rejects unknown versions and malformed payloads", async () => {
    await expect(decrypt("v2:AAAA:AAAA", keyA)).rejects.toThrow("Decryption failed");
    await expect(decrypt("garbage", keyA)).rejects.toThrow("Decryption failed");
    await expect(decrypt("v1:!!!:!!!", keyA)).rejects.toThrow("Decryption failed");
  });

  it("rejects keys that are not 32 bytes of base64 without echoing the key", async () => {
    const shortKey = btoa("short");
    await expect(encrypt("x", shortKey)).rejects.toThrow("ENCRYPTION_KEY must be base64 of exactly 32 bytes");
    await expect(encrypt("x", "not base64 !!")).rejects.toThrow("ENCRYPTION_KEY");
  });
});
```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/lib/crypto.test.ts` - Expected: 8 pass, 0 fail
- [ ] Step 4: Commit - `git add src/worker/lib/crypto.ts test/worker/lib/crypto.test.ts && git commit -m "feat: add AES-256-GCM encrypt and decrypt helpers"`

---

### Task 3: Redaction util

**Files:**
- Create: `src/worker/lib/redact.ts`
- Test: `test/worker/lib/redact.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `REDACTED: "***"`
  - `redactSecrets(input: string): string` - masks the password in any `scheme://user:password@host` URL found in the text, and the value of `password=`, `passwd=`, or `pass=` pairs.
  - `redactError(error: unknown): string` - `redactSecrets` applied to `error.message` or `String(error)`.

**Gotcha:** the user name is kept on purpose (it is not a secret and helps debugging). A URL with a user but no `:` is returned unchanged. The password is everything after the first `:` in the user-info part, up to the LAST `@` before the path, so a raw `@` inside a password is still masked.

**Steps:**
- [ ] Step 1: Create `src/worker/lib/redact.ts`:
      ```ts
export const REDACTED = "***";

// scheme://user:password@host - the password is everything after the first ":" in the user-info,
// up to the LAST "@" in the same whitespace/quote-free run, so raw "@", "/", "?" and "#" inside a
// password are still masked. Over-masking is accepted: it fails safe.
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^\s'"]*)@/gi;
// password=value, PGPASSWORD=value, db_password = 'value' (query strings, libpq strings, env lines).
const PASSWORD_PAIR = /(\b[a-z_]*pass(?:word|wd)?\s*=\s*)('[^']*'|"[^"]*"|[^\s&;'"]+)/gi;
// "password": "value" in JSON.
const PASSWORD_JSON = /("[a-z_]*pass(?:word|wd)?"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

export function redactSecrets(input: string): string {
  return input
    .replace(URL_USERINFO, (match, scheme: string, userinfo: string) => {
      const colon = userinfo.indexOf(":");
      if (colon === -1) return match;
      return `${scheme}${userinfo.slice(0, colon)}:${REDACTED}@`;
    })
    .replace(PASSWORD_PAIR, `$1${REDACTED}`)
    .replace(PASSWORD_JSON, `$1"${REDACTED}"`);
}

export function redactError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
```
- [ ] Step 2: Create `test/worker/lib/redact.test.ts`:
      ```ts
import { describe, expect, it } from "vitest";
import { redactError, redactSecrets } from "../../../src/worker/lib/redact";

describe("redactSecrets", () => {
  it("masks the password and keeps the rest of the URL", () => {
    expect(redactSecrets("postgres://app:hunter2@db.internal:5432/shop?sslmode=require")).toBe(
      "postgres://app:***@db.internal:5432/shop?sslmode=require",
    );
  });

  it("leaves URLs without a password unchanged", () => {
    for (const url of ["postgres://app@db.internal:5432/shop", "postgres://db.internal:5432/shop", "postgresql:///shop"]) {
      expect(redactSecrets(url)).toBe(url);
    }
  });

  it("masks URL-encoded passwords", () => {
    const out = redactSecrets("postgres://app:p%40ss%2Fw%3Ard@db:5432/shop");
    expect(out).toBe("postgres://app:***@db:5432/shop");
    expect(out).not.toContain("p%40ss");
  });

  it("masks passwords containing a raw @ or :", () => {
    expect(redactSecrets("postgres://app:p@ss:w0rd@db:5432/shop")).toBe("postgres://app:***@db:5432/shop");
  });

  it("masks passwords containing raw /, ? and # characters", () => {
    for (const password of ["ab/cd", "ab?cd", "ab#cd", "a/b+c==", "x@y/z"]) {
      const out = redactSecrets(`postgres://app:${password}@db:5432/shop`);
      expect(out).toBe("postgres://app:***@db:5432/shop");
    }
  });

  it("masks PGPASSWORD, spaced assignments, and JSON password fields", () => {
    expect(redactSecrets("PGPASSWORD=hunter2 pg_dump")).toBe("PGPASSWORD=*** pg_dump");
    expect(redactSecrets("password = 'my secret'")).toBe("password = ***");
    expect(redactSecrets('{"user":"app","password":"p\\"w","db":"shop"}')).toBe('{"user":"app","password":"***","db":"shop"}');
  });

  it("masks password query parameters and libpq key/value strings", () => {
    expect(redactSecrets("postgres://db/shop?user=app&password=s3cret&sslmode=require")).toBe(
      "postgres://db/shop?user=app&password=***&sslmode=require",
    );
    expect(redactSecrets("host=db user=app password='my secret' dbname=shop")).toBe(
      "host=db user=app password=*** dbname=shop",
    );
  });

  it("masks every URL inside an error message", () => {
    const message =
      'connection to "postgres://app:s3cret@db:5432/shop" failed, retrying postgres://root:t0ps3cret@other:5432/x';
    const out = redactSecrets(message);
    expect(out).toBe('connection to "postgres://app:***@db:5432/shop" failed, retrying postgres://root:***@other:5432/x');
    expect(out).not.toMatch(/s3cret|t0ps3cret/);
  });

  it("leaves plain text alone", () => {
    expect(redactSecrets("pg_dump exited with code 1")).toBe("pg_dump exited with code 1");
    expect(redactSecrets("contact ops@example.com")).toBe("contact ops@example.com");
  });
});

describe("redactError", () => {
  it("redacts Error messages and non-Error values", () => {
    expect(redactError(new Error("fail postgres://u:pw@h/db"))).toBe("fail postgres://u:***@h/db");
    expect(redactError("raw postgres://u:pw@h/db")).toBe("raw postgres://u:***@h/db");
  });
});
```
- [ ] Step 3: Verify - Run: `bunx vitest run test/worker/lib/redact.test.ts` - Expected: 10 pass, 0 fail
- [ ] Step 4: Commit - `git add src/worker/lib/redact.ts test/worker/lib/redact.test.ts && git commit -m "feat: add secret redaction for URLs and error messages"`

---

### Task 4: D1 schema and first migration (local only)

**Files:**
- Create: `src/worker/db/schema.ts`, `migrations/0000_init.sql`, `migrations/meta/0000_snapshot.json`, `migrations/meta/_journal.json` (the last three are emitted by `drizzle-kit generate --name init`)

**Interfaces:**
- Consumes: `drizzle.config.ts` from Task 1 (schema path `./src/worker/db/schema.ts`, out `./migrations`).
- Produces: Drizzle tables `targets`, `backups`, `restores`, `alertChannels`, `targetAlertChannels`, `auditLogs`, `settings` exported from `src/worker/db/schema.ts`. Phase 2 imports them. Each table has an inferred row type (`typeof targets.$inferSelect`); no code uses these types yet, so there are no consumers or hand-built fixtures to update.

**Gotcha:**
- Drizzle emits `DEFAULT true` for boolean columns. SQLite treats `true` as `1`, so this is equivalent to PLAN.md's `DEFAULT 1`. Do not change it.
- `enabled`, `is_source_overwrite` use `{ mode: "boolean" }` (stored as integer 0/1), matching "integer" in PLAN.md.
- The schema includes the amendments listed in "Decisions that differ" item 5. `docs/PLAN.md` section 3 already contains them.
- `restores.queued_at` is nullable because PLAN.md lists it without NOT NULL. Do not "fix" it.
- `targets.name` uniqueness is partial (`WHERE deleted_at IS NULL`), so a soft-deleted target's name can be reused (owner approved).
- The `DESC` index parts use a raw `sql` fragment because that is what drizzle emits as `"col" DESC`.
- Do not run `db:migrate:remote`.

**Rollback:** local D1 only. `rm -rf .wrangler/state/v3/d1` then `bun run db:migrate:local` to re-apply. To discard the migration files: `git revert <commit>`. Nothing remote is touched.

**Steps:**
- [ ] Step 1: Create `src/worker/db/schema.ts`:
      ```ts
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const targets = sqliteTable(
  "targets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    dbName: text("db_name").notNull(),
    pgVersion: integer("pg_version"),
    connectionUrlEnc: text("connection_url_enc").notNull(),
    restoreUrlEnc: text("restore_url_enc"),
    projectTag: text("project_tag"),
    tunnelHostname: text("tunnel_hostname").notNull(),
    tunnelTokenIdEnc: text("tunnel_token_id_enc").notNull(),
    tunnelTokenSecretEnc: text("tunnel_token_secret_enc").notNull(),
    scheduleCron: text("schedule_cron").notNull().default("0 2 * * *"),
    timezone: text("timezone").notNull().default("Asia/Bangkok"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    keepLast: integer("keep_last").default(3),
    keepDaily: integer("keep_daily").default(7),
    keepWeekly: integer("keep_weekly").default(4),
    keepMonthly: integer("keep_monthly").default(6),
    maxAgeDays: integer("max_age_days"),
    jobDeadlineMinutes: integer("job_deadline_minutes").notNull().default(120),
    staleAfterHours: integer("stale_after_hours"),
    alertFailureThreshold: integer("alert_failure_threshold").notNull().default(3),
    nextRunAt: text("next_run_at"),
    lastBackupAt: text("last_backup_at"),
    lastStatus: text("last_status"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    uniqueIndex("uq_targets_name").on(t.name).where(sql`${t.deletedAt} IS NULL`),
    index("idx_targets_next_run").on(t.enabled, t.nextRunAt).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const backups = sqliteTable(
  "backups",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => targets.id),
    status: text("status", { enum: ["queued", "running", "success", "failed", "timed_out"] }).notNull(),
    trigger: text("trigger", { enum: ["schedule", "manual"] }).notNull(),
    r2Key: text("r2_key"),
    sizeBytes: integer("size_bytes"),
    sha256: text("sha256"),
    pgVersionServer: text("pg_version_server"),
    attempt: integer("attempt").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    scheduleSlot: text("schedule_slot"),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    heartbeatAt: text("heartbeat_at"),
    expiresAt: text("expires_at"),
    deletedAt: text("deleted_at"),
    deletedReason: text("deleted_reason"),
  },
  (t) => [
    index("idx_backups_target_time")
      .on(t.targetId, sql`${t.startedAt} DESC`)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_backups_status").on(t.status, t.heartbeatAt),
    uniqueIndex("uq_backups_r2_key").on(t.r2Key),
    uniqueIndex("uq_backups_target_slot")
      .on(t.targetId, t.scheduleSlot)
      .where(sql`${t.scheduleSlot} IS NOT NULL`),
  ],
);

export const restores = sqliteTable(
  "restores",
  {
    id: text("id").primaryKey(),
    sourceBackupId: text("source_backup_id")
      .notNull()
      .references(() => backups.id),
    destinationTargetId: text("destination_target_id")
      .notNull()
      .references(() => targets.id),
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

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: text("details"),
    ip: text("ip"),
  },
  (t) => [
    index("idx_audit_logs_at").on(sql`${t.at} DESC`),
    index("idx_audit_logs_entity").on(t.entityType, t.entityId, sql`${t.at} DESC`),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```
- [ ] Step 2: Generate the migration: `bun run db:generate -- --name init` - Expected: prints a per-table summary (7 tables) and `migrations/0000_init.sql`
- [ ] Step 3: Verify - Run: `grep -c "CREATE TABLE" migrations/0000_init.sql && grep -c "WHERE" migrations/0000_init.sql && grep -c "DESC" migrations/0000_init.sql` - Expected: `7`, `4`, `4` (7 tables; 4 partial indexes: `idx_backups_target_time`, `uq_backups_target_slot`, `idx_targets_next_run`, `uq_targets_name`; 4 `DESC` index parts)
- [ ] Step 4: Apply to LOCAL D1 only: `bun run db:migrate:local` - Expected: output contains `Executing on local database cellar` and a table row `0000_init.sql | ✅`; it must NOT mention `remote`
- [ ] Step 5: Verify - Run: `bunx wrangler d1 execute cellar --local --json --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('targets','backups','restores','alert_channels','target_alert_channels','audit_logs','settings') ORDER BY name" | grep -c '"name"'` - Expected: `7`
- [ ] Step 6: Verify - Run: `bunx wrangler d1 execute cellar --local --json --command "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'" | grep -c '"name"'` - Expected: `13`
- [ ] Step 7: Verify - Run: `bun run typecheck` - Expected: exits 0, no output
- [ ] Step 8: Commit - `git add src/worker/db/schema.ts migrations && git commit -m "feat: add D1 schema and initial migration"`

---

### Task 5: Access middleware and Hono app

**Files:**
- Create: `src/worker/middleware/access.ts`, `src/worker/app.ts`, `src/worker/index.ts`
- Test: `test/worker/middleware/access.test.ts`

**Interfaces:**
- Consumes: `Env` from `src/worker/env.ts` (Task 1).
- Produces:
  - `type AppEnv = { Bindings: Env; Variables: { actorEmail: string } }` (exported from `access.ts`; Phase 2 routes use it as the Hono generic).
  - `access(): MiddlewareHandler<AppEnv>` - creates a middleware with its own JWKS cache. Sets `actorEmail` on success; returns `401 {"error":{"code":"unauthorized","message":"Unauthorized"}}` on any failure.
  - `app: Hono<AppEnv>` exported from `src/worker/app.ts`; `GET /api/health` returns `{"ok":true,"version":<package.json version>}` without auth.
  - Default export of `src/worker/index.ts`: `{ fetch: app.fetch }`.

**Gotcha:**
- `/api/health` must be registered BEFORE `app.use("/api/*", access())`. Reversing the order protects health too, and the test `serves /api/health without authentication` fails.
- Unknown `/api/*` paths return `401` (not `404`) without a token, because the middleware runs first.
- `ACCESS_TEAM_DOMAIN` is the hostname only (no `https://`). The issuer is derived as `https://<domain>` and the JWKS URL as `https://<domain>/cdn-cgi/access/certs`.
- JWKS cache: keys are imported once and kept by `kid`. A refresh happens when the `kid` is unknown or the keys are over 10 minutes old, at most once per 60 seconds (failed attempts count), with one shared in-flight fetch. If a refresh fails, cached keys keep working. So random `kid` values or a JWKS outage cannot cause a fetch per request.
- `exp` and `nbf` allow 30 seconds of clock leeway.
- Tests stub the global `fetch`; they never reach the network.
- Service-token JWTs have no `email` claim and are rejected (human users only in this phase).
- Negative control (do this once): temporarily delete the line `if (!valid) throw new AccessError("bad signature");`, run the test file, and expect the `rejects a bad signature` test to FAIL; then restore the line.

**Steps:**
- [ ] Step 1: Create `src/worker/middleware/access.ts`:
      ```ts
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

export type AppEnv = { Bindings: Env; Variables: { actorEmail: string } };

const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
const CLOCK_LEEWAY_SECONDS = 30;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

class AccessError extends Error {}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
  if (typeof parsed !== "object" || parsed === null) throw new AccessError("malformed token");
  return parsed as Record<string, unknown>;
}

function unauthorized(reason: string): Response {
  console.warn(`access: rejected (${reason})`);
  return Response.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
}

/**
 * Verifies `Cf-Access-Jwt-Assertion` (RS256 signature against the team JWKS, `iss`, `aud`, `exp`, `nbf`)
 * and sets `actorEmail`. Any failure is a 401. Create one instance per app: it owns the JWKS cache.
 *
 * JWKS cache: imported keys are kept by `kid`. Refresh happens when a `kid` is unknown or the keys are
 * older than 10 minutes, at most once per minute (failed attempts count), with one shared in-flight fetch.
 * If a refresh fails, the previously cached keys keep working.
 */
export function access() {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = 0;
  let lastAttemptAt = 0;
  let inflight: Promise<void> | null = null;

  function refresh(domain: string): Promise<void> {
    inflight ??= (async () => {
      lastAttemptAt = Date.now();
      try {
        const response = await fetch(`https://${domain}/cdn-cgi/access/certs`);
        if (!response.ok) return;
        const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
        const next = new Map<string, CryptoKey>();
        for (const jwk of body.keys ?? []) {
          if (!jwk.kid) continue;
          try {
            next.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, RS256, false, ["verify"]));
          } catch {
            continue;
          }
        }
        keys = next;
        fetchedAt = Date.now();
      } catch {
        return;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function getKey(domain: string, kid: string): Promise<CryptoKey> {
    const now = Date.now();
    const needsRefresh = !keys.has(kid) || now - fetchedAt >= JWKS_TTL_MS;
    if (needsRefresh && (inflight || now - lastAttemptAt >= JWKS_MIN_REFETCH_MS)) await refresh(domain);
    const key = keys.get(kid);
    if (!key) throw new AccessError("unknown kid or jwks unavailable");
    return key;
  }

  async function verify(token: string, env: Env): Promise<string> {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new AccessError("access not configured");
    const parts = token.split(".");
    if (parts.length !== 3) throw new AccessError("malformed token");
    const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;

    const header = decodeJson(headerPart);
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AccessError("unsupported header");

    const key = await getKey(env.ACCESS_TEAM_DOMAIN, header.kid);
    const valid = await crypto.subtle.verify(
      RS256,
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
    if (!valid) throw new AccessError("bad signature");

    const claims = decodeJson(payloadPart);
    const nowSeconds = Date.now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_LEEWAY_SECONDS <= nowSeconds) {
      throw new AccessError("expired");
    }
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_LEEWAY_SECONDS > nowSeconds) {
      throw new AccessError("not yet valid");
    }
    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new AccessError("wrong issuer");
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.ACCESS_AUD)) throw new AccessError("wrong audience");
    if (typeof claims.email !== "string" || claims.email === "") throw new AccessError("no email claim");
    return claims.email;
  }

  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.env.DEV_BYPASS === "true" && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      c.set("actorEmail", "dev@localhost");
      return next();
    }
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) return unauthorized("missing header");
    try {
      c.set("actorEmail", await verify(token, c.env));
    } catch (error) {
      return unauthorized(error instanceof AccessError ? error.message : "verification error");
    }
    return next();
  });
}
```
- [ ] Step 2: Create `src/worker/app.ts`:
      ```ts
import { Hono } from "hono";
import pkg from "../../package.json";
import { access, type AppEnv } from "./middleware/access";

export const app = new Hono<AppEnv>();

// Registration order matters: /api/health must be registered before the Access middleware.
app.get("/api/health", (c) => c.json({ ok: true, version: pkg.version }));
app.use("/api/*", access());
```
- [ ] Step 3: Create `src/worker/index.ts`:
      ```ts
import { app } from "./app";

export default { fetch: app.fetch };
```
- [ ] Step 4: Create `test/worker/middleware/access.test.ts`:
      ```ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { access, type AppEnv } from "../../../src/worker/middleware/access";
import { app } from "../../../src/worker/app";
import pkg from "../../../package.json";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const KID = "kid-1";
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

let signingKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(
  claims: Record<string, unknown>,
  key: CryptoKeyPair = signingKey,
  header: Record<string, unknown> = { alg: "RS256", kid: KID },
): Promise<string> {
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(body));
  return `${body}.${b64url(signature)}`;
}

const validClaims = () => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  email: "ops@example.com",
  exp: Math.floor(Date.now() / 1000) + 300,
});

const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as AppEnv["Bindings"];

function makeApp() {
  const test = new Hono<AppEnv>();
  test.use("/api/*", access());
  test.get("/api/me", (c) => c.json({ email: c.get("actorEmail") }));
  return test;
}

function request(test: Hono<AppEnv>, token?: string, bindings = env, url = "https://cellar.example.com/api/me") {
  return test.request(url, token ? { headers: { "Cf-Access-Jwt-Assertion": token } } : {}, bindings);
}

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  signingKey = (await crypto.subtle.generateKey(RS256, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKey = (await crypto.subtle.generateKey(RS256, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = { ...((await crypto.subtle.exportKey("jwk", signingKey.publicKey)) as JsonWebKey), kid: KID, alg: "RS256" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubJwks() {
  const fetchMock = vi.fn(async () => Response.json({ keys: [publicJwk] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("access middleware", () => {
  it("rejects a missing header", async () => {
    stubJwks();
    expect((await request(makeApp())).status).toBe(401);
  });

  it("rejects a malformed token", async () => {
    stubJwks();
    expect((await request(makeApp(), "not-a-jwt")).status).toBe(401);
  });

  it("rejects a bad signature", async () => {
    stubJwks();
    const token = await sign(validClaims(), otherKey);
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects a wrong audience", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), aud: ["someone-else"] });
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 120 });
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects a wrong issuer, a missing email, and a non-RS256 header", async () => {
    stubJwks();
    const test = makeApp();
    expect((await request(test, await sign({ ...validClaims(), iss: "https://evil.example.com" }))).status).toBe(401);
    expect((await request(test, await sign({ ...validClaims(), email: undefined }))).status).toBe(401);
    expect((await request(test, await sign(validClaims(), signingKey, { alg: "HS256", kid: KID }))).status).toBe(401);
  });

  it("rejects an unknown kid", async () => {
    stubJwks();
    const token = await sign(validClaims(), signingKey, { alg: "RS256", kid: "other-kid" });
    expect((await request(makeApp(), token)).status).toBe(401);
  });

  it("rejects everything when Access is not configured", async () => {
    stubJwks();
    const token = await sign(validClaims());
    const unconfigured = { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: "" } as AppEnv["Bindings"];
    expect((await request(makeApp(), token, unconfigured)).status).toBe(401);
  });

  it("accepts a valid token and exposes the email", async () => {
    stubJwks();
    const response = await request(makeApp(), await sign(validClaims()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: "ops@example.com" });
  });

  it("accepts aud given as a plain string", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), aud: AUD });
    expect((await request(makeApp(), token)).status).toBe(200);
  });

  it("caches the JWKS across requests", async () => {
    const fetchMock = stubJwks();
    const test = makeApp();
    await request(test, await sign(validClaims()));
    await request(test, await sign(validClaims()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`https://${TEAM}/cdn-cgi/access/certs`);
  });

  it("does not refetch the JWKS on every unknown kid", async () => {
    const fetchMock = stubJwks();
    const test = makeApp();
    const unknown = await sign(validClaims(), signingKey, { alg: "RS256", kid: "nope" });
    await request(test, unknown);
    await request(test, unknown);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when the JWKS endpoint fails, and does not hammer it", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const test = makeApp();
    expect((await request(test, await sign(validClaims()))).status).toBe(401);
    expect((await request(test, await sign(validClaims()))).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one JWKS fetch between concurrent cold-start requests", async () => {
    const fetchMock = stubJwks();
    const test = makeApp();
    const [a, b] = await Promise.all([
      request(test, await sign(validClaims())),
      request(test, await sign(validClaims())),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps using cached keys when a later refresh fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const test = makeApp();
      stubJwks();
      expect((await request(test, await sign(validClaims()))).status).toBe(200);
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
      expect((await request(test, await sign(validClaims()))).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a token that expired a few seconds ago (clock leeway)", async () => {
    stubJwks();
    const token = await sign({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 5 });
    expect((await request(makeApp(), token)).status).toBe(200);
  });
});

describe("DEV_BYPASS", () => {
  const bypass = { ...env, DEV_BYPASS: "true" } as AppEnv["Bindings"];

  it("skips verification only when DEV_BYPASS is true and the host is local", async () => {
    stubJwks();
    const local = await request(makeApp(), undefined, bypass, "http://localhost:8787/api/me");
    expect(local.status).toBe(200);
    expect(await local.json()).toEqual({ email: "dev@localhost" });
  });

  it("is ignored on non-local hosts", async () => {
    stubJwks();
    expect((await request(makeApp(), undefined, bypass)).status).toBe(401);
  });

  it.each([undefined, "", "false", "1", "TRUE"])("is ignored when DEV_BYPASS is %j", async (value) => {
    stubJwks();
    const bindings = { ...env, DEV_BYPASS: value } as AppEnv["Bindings"];
    expect((await request(makeApp(), undefined, bindings, "http://localhost:8787/api/me")).status).toBe(401);
  });
});

describe("app", () => {
  it("serves /api/health without authentication", async () => {
    const response = await app.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: pkg.version });
  });

  it("protects every other /api route, including unknown ones", async () => {
    stubJwks();
    expect((await app.request("/api/targets", {}, env)).status).toBe(401);
    expect((await app.request("/api/does-not-exist", {}, env)).status).toBe(401);
  });
});
```
- [ ] Step 5: Verify - Run: `bunx vitest run test/worker/middleware/access.test.ts` - Expected: 25 pass, 0 fail
- [ ] Step 6: Verify - Run (negative control): remove the `bad signature` line as described in Gotcha, run `bunx vitest run test/worker/middleware/access.test.ts` - Expected: at least `rejects a bad signature` fails. Then restore the line and re-run - Expected: 25 pass
- [ ] Step 7: Verify - Run: `bun run typecheck` - Expected: exits 0, no output
- [ ] Step 8: Commit - `git add src/worker/middleware/access.ts src/worker/app.ts src/worker/index.ts test/worker/middleware/access.test.ts && git commit -m "feat: add Cloudflare Access JWT middleware and health route"`

---

---

## Failure handling summary

- **`bun add` resolves a version that breaks the reference code** - Detect: `bun run typecheck` errors in files from this plan, or tests fail on APIs that changed. Respond: fix minimally, record a `> Deviation:` with the package and version. If the same step fails 3 times, STOP and report.
- **`wrangler d1 ... --local` prints `remote`, asks to log in, or tries to create a resource** - Detect: output mentions `remote`, `login`, or `create`. Respond: STOP immediately and report. Do not continue, and do not run any wrangler command without `--local`.
- **`wrangler dev` hangs on the port** - Detect: no `Ready on` line within 30 seconds. Respond: kill the process, pick a free port, re-run once; then STOP and report.

## End-to-end verification

These run on the integrated result, through the real Worker runtime (local `wrangler dev`, simulated bindings, no network to Cloudflare).

- [ ] Run: `bun run test && bun run typecheck` - Expected: Vitest reports `Test Files  3 passed (3)` and `Tests  43 passed (43)`; typecheck prints nothing and exits 0
- [ ] Run: `printf 'ENCRYPTION_KEY=AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=\nACCESS_TEAM_DOMAIN=test.cloudflareaccess.com\nACCESS_AUD=test-aud\n' > .dev.vars` - Expected: file created (it is gitignored; values are fake)
- [ ] Manual: start `bunx wrangler dev --local --port 8799` in the background, wait for `Ready on http://localhost:8799`, then `curl -s -w ' %{http_code}\n' localhost:8799/api/health` - Expected: `{"ok":true,"version":"0.1.0"} 200`. The startup table lists `env.DB`, `env.BACKUPS`, `env.JOBS` all with Mode `local`
- [ ] Manual: `curl -s -w ' %{http_code}\n' localhost:8799/api/targets` - Expected: `{"error":{"code":"unauthorized","message":"Unauthorized"}} 401`
- [ ] Manual: `curl -s -w ' %{http_code}\n' -H 'Cf-Access-Jwt-Assertion: a.b.c' localhost:8799/api/targets` - Expected: `401` (malformed token)
- [ ] Manual: stop the dev server, append `DEV_BYPASS=true` to `.dev.vars`, restart `bunx wrangler dev --local --port 8799`, then `curl -s -w ' %{http_code}\n' localhost:8799/api/targets` - Expected: `404 Not Found 404` (body then status; the middleware passed the request; no `/api/targets` route exists yet)
- [ ] Manual: stop the dev server, delete `.dev.vars` (`rm .dev.vars`), then `lsof -i :8799` - Expected: no output; `git status --short` shows no `.dev.vars`
- [ ] Run: `bunx wrangler d1 execute cellar --local --json --command "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('targets','backups','restores','alert_channels','target_alert_channels','audit_logs','settings')" | grep '"n"'` - Expected: `"n": 7`
- [ ] Run: `git status --short && git log --oneline | head -8` - Expected: clean tree; commits for Tasks 0-5 on branch `phase-1-foundation`; no file under `.wrangler/` is tracked (`git ls-files .wrangler | wc -l` prints `0`)

When all boxes are ticked, end with the phase summary required by `AGENTS.md`:

- ✅ Completed
- 🧪 Tests and results
- ⚠️ Open issues and decisions needed (include: first real Access JWKS check happens only at deploy; the four dev dependencies approved above; `encrypt`/`decrypt` take the key as an argument)
