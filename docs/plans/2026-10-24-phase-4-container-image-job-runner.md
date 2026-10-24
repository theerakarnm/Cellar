# Phase 4: Container Image and Job Runner Implementation Plan

> **Run with:** `/execute-plan docs/plans/2026-10-24-phase-4-container-image-job-runner.md` - the runner that ticks these
> checkboxes and honours the track/merge layout below.
>
> **For the executing agent:** Implement this plan in order, in one worktree (single track).
> Steps use checkbox (`- [ ]`) syntax; tick them as you go.
> Run the `## Phase gate` and `## Preflight` checks BEFORE Task 0 and report anything down.
> Reconciled on 2026-10-24 with "Owner answers, round 2" in the decisions register (binding: tunnel only, 32 MiB parts, RustFS, `@types/bun`, the contract test). No ASK remains.
> This plan was written BEFORE Phases 1-3 exist in the tree. Every reference to their files comes from their plans, marked "(planned, not yet in tree)".
> The code in the steps is a reference implementation. Most of it was type-checked and run in a scratch project (see "What was run in scratch").
> When a tool rejects it, the tool wins: correct minimally and record a `> Deviation:` line.

**Goal:** Build a Docker image and a TypeScript (Bun) job runner that runs `test`, `backup`, and `restore` jobs against PostgreSQL 13-18, streams `pg_dump -Fc` to S3-compatible storage by multipart upload, and reports signed callbacks. Prove it locally with Docker Compose. Prove the Cloudflare Tunnel path with a real tunnel first.
**Architecture:** `container/` holds a Dockerfile (Debian trixie slim, `postgresql-client` 13-18 from PGDG, pinned `cloudflared`) and a runner with no npm dependencies. The image runs `bun run /app/entrypoint.ts`. The runner reads one job JSON (stdin), always starts `cloudflared access tcp` (tunnel only, no direct mode), runs the command, and sends HMAC-signed events (`started`, `progress` every 30 s, `succeeded` or `failed`) to the callback URL. Secrets travel only in environment variables and stdin, never in argv. A small in-house SigV4 client does the multipart upload with one part buffer and one request in flight.
**Tech Stack:** Bun 1.3.9 (image), TypeScript, `node:child_process` / `node:crypto` / `node:net` (work on Bun and Node), WebCrypto, Vitest (Node), Docker Compose, `postgres:14` and `postgres:17` images, an S3-compatible stand-in (RustFS).
**Spec:** `docs/plans/prds/phase-4.md` (owner PRD), `docs/plans/2026-10-24-phases-2-10-decisions.md` (register: "Owner answers, round 2" (binding), section "Phase 4", and X1, X3, X14, X15, X16, X18), `docs/PLAN.md` sections 5, 7, 8.
**Base commit:** `5f7ddc8` (`git rev-parse --short HEAD` at planning time). The tree then held only `LICENSE`, `README.md`, staged `AGENTS.md` and `docs/`. Phases 1-3 were not built yet. Anchors below describe files from the Phase 1 plan.
**Confidence:** 8/10. Rubric: start 10, minus 2 once for anchors in files that do not exist yet (register X18). No other rubric deduction applies: no `Consumes` entry lacks a signature, no Patterns SOURCE points at a file (they point at plan text, marked planned), every `Verify - Human` has a proxy, every Preflight command listed was run, there are no parallel tracks. Real residual risk, not scored by the rubric: the Dockerfile, the Compose file, and the three Docker scripts (`run.ts`, `large.ts`, `tunnel.ts`) were never run because Docker is not installed on the planning machine. They were type-checked only. The round 2 changes (tunnel-only code, contract test, fake `cloudflared`, `/app/` layout) were not type-checked or run in scratch. The 32 MiB part size (owner answer 12) was chosen from the scratch memory table under "Closed by owner (round 2)".
**NOT building:**
- Worker code: queue consumer, container binding, `JobRunner` class, callback route, `outboundByHost`, job-key derivation from `ENCRYPTION_KEY` (Phase 5). The runner only RECEIVES `jobKey`.
- The outbound-handler half of the spike (Phase 5, needs a Worker).
- Any Worker-side TCP proxy or VM-side agent. If the tunnel spike fails, STOP (AGENTS.md).
- Presigned URLs (Phase 7), retention (Phase 6), alerts (Phase 8).
- Parallel `pg_restore -j` (owner closed this question in PLAN.md section 10).
- Creating the database for a restore. The destination database must already exist (PLAN.md section 4).
- Any real R2 bucket, any Cloudflare resource, `wrangler deploy`, or any remote command. The only real Cloudflare resources are the owner's own tunnel and Access app in Task 2 and Task 18, which the owner supplies.
- A README or docs for the container (Phase 10).
- Direct mode (owner removed it, round 2 answer 1). The runner has no code path without `cloudflared`.
- The R2 bucket lifecycle rule that aborts incomplete multipart uploads after 1 day. It is documented (PLAN.md section 8, Phase 10 docs), never created by code.
- The part-size config value itself (Worker config, Phase 5). The runner only RECEIVES `r2.partSizeBytes`.
- Callback fields beyond PLAN.md section 5 other than the ones listed under "Decisions that differ".

## Closed by owner (round 2)

The owner answered every open question on 2026-10-24 ("Owner answers, round 2" in `docs/plans/2026-10-24-phases-2-10-decisions.md`). No ASK remains.

1. **S3 stand-in (former ASK-1): RustFS is approved** (answer 8), for test and dev only. It is never in the production image. The plan uses `rustfs/rustfs:1.0.3` (Apache-2.0, S3 API with multipart; the tag exists for amd64 and arm64 on Docker Hub). The PRD's original stand-in no longer publishes images. RustFS multipart and SigV4 behavior was NOT tested here [uncertain]. The image is one variable (`S3_IMAGE`) in `test/docker-compose.test.yml`.
2. **Part size (former ASK-2): 32 MiB parts at the 256 MB limit** (answer 12). The part size is a config value (`r2.partSizeBytes`, sent by the Worker), default 32 MiB = 33554432 bytes. 32 MiB x 10,000 parts = 320,000 MiB (about 312 GiB, 335 GB) per dump; `choosePartSize` grows the part above about 237 GiB of database. No local disk. Scratch peak RSS of the uploader alone while streaming 1 GiB (Bun 1.3.5, macOS arm64, one `fetch` per part):

   | Part size | Peak RSS of the runner process |
   |---|---|
   | 8 MiB | 102 MiB |
   | 16 MiB | 126 MiB |
   | 32 MiB | 174 MiB |

   `fetch` copies a `Uint8Array` body, so a part costs about 2x its size on top of a 21 MiB baseline. `pg_dump` adds more inside the same cgroup. Linux numbers may differ [uncertain]. Task 17 proves it and STOPs on failure.
3. **`@types/bun` (former ASK-3): approved** (answer 8). See "Dependencies (approved)".
4. **Direct mode: removed** (answer 1). Tunnel only. The `tunnel` block is always present and required by `parseJob`; `cloudflared` always starts. Local Docker tests use a test-only fake `cloudflared` (Task 16), never copied into the image.
5. **Container contract: confirmed** (answer 13): job JSON on stdin, entrypoint `bun run /app/entrypoint.ts`, `signCallback` exported. Task 14 adds the contract test that Phase 5 reuses.
6. **R2 lifecycle rule:** a bucket rule that aborts incomplete multipart uploads after 1 day is documented (Phase 10 docs, PLAN.md section 8), never created by code. The runner still sends `AbortMultipartUpload` on failure.

## Decisions that differ from the PRD / docs/PLAN.md / the register

Precedence is AGENTS.md, then PLAN.md owner answers, then the PRD, then the register.

1. **In-house SigV4 multipart client instead of Bun's `S3Client`.** The register asks for `S3Client` and marks it [uncertain]. A scratch run against a recording server showed that `writer.end(new Error("boom"))` still sends `CompleteMultipartUpload` for the parts written so far. A failed backup would leave a truncated but valid-looking object. The documented writer API has no abort. PLAN.md section 5 requires `AbortMultipartUpload` on any failure, and PLAN.md outranks the register. `container/s3.ts` (about 200 lines, WebCrypto + `fetch`, no dependency) implements create, upload part, complete, abort, and GET. Its signing matches two published AWS SigV4 test vectors (see Task 8).
2. **S3 stand-in is RustFS** (owner answer 8; test and dev only, never in the production image).
3. **Image build context is the repo root.** `container/Dockerfile` is built with `docker build -f container/Dockerfile .`. The image copies `container/` to `/app/` and `src/worker/lib/redact.ts` to `/src/worker/lib/redact.ts` (the relative import `../src/worker/lib/redact` resolves the same way in the repo and in the image, and the entrypoint is `/app/entrypoint.ts` as PLAN.md section 5 states), so the runner and the Worker share one redaction implementation (Phase 1 plan, Task 3). `container/Dockerfile.dockerignore` keeps the context small (BuildKit reads `<Dockerfile>.dockerignore`). Phase 5 must set `image_build_context` to the repo root in `wrangler.jsonc` (`docs/research-notes.md` section 1 lists the key). [uncertain] whether Wrangler's builder honors `Dockerfile.dockerignore`; if not, Phase 5 adds a root `.dockerignore`.
4. **The tunnel token goes in the environment, not in flags.** `cloudflared access tcp --help` (version 2026.10.3, run locally) shows `--service-token-id [$TUNNEL_SERVICE_TOKEN_ID]` and `--service-token-secret [$TUNNEL_SERVICE_TOKEN_SECRET]`. The runner sets those two env vars so the secret is never in argv. This also confirms that the flags exist in the current binary. The end-to-end proof is still the spike in Task 2.
5. **Job JSON arrives on stdin.** The owner confirmed stdin only: the Phase 5 JobRunner uses `container.exec` with stdin `"pipe"`, and PLAN.md section 5 forbids secrets in env vars, so there is no env var source. A file path argument is also accepted, for the local e2e harness only (`runRunner` in Task 15 mounts a mode 0600 temp file); argv carries only the path, never a secret. Production never passes an argument.
6. **`r2.region` is an optional job field** (default `auto`, right for R2). Some S3-compatible servers reject `auto`; the local tests pass `us-east-1`.
7. **The runner ignores the host and port in `db.url`** and always connects to `127.0.0.1:tunnel.localPort`. PLAN.md section 3 says the stored URL host is the tunnel hostname, while section 5 shows `127.0.0.1:{localPort}`. The runner accepts both. There is no direct mode (owner answer 1): the `tunnel` block is required and `cloudflared` always starts.
8. **Callback error codes** are PLAN.md section 5 codes plus three: `DOWNLOAD_FAILED`, `RESTORE_FAILED`, `INVALID_JOB`. **Result shapes** by job type: `test` gives `{ pgServerVersion, dbSizeBytes, hasReadAllData: boolean | null, durationMs }` (`null` on PostgreSQL 13, where the role does not exist); `backup` gives `{ sizeBytes, sha256, partCount, pgServerVersion, durationMs }`; `restore` gives `{ durationMs }`. `progress` carries no extra fields (it is only a heartbeat). Task 19 updates PLAN.md.
9. **Retries resend the same `seq`.** The runner retries a callback on network errors, 5xx, 429, and 408 (terminal events: 4 retries after 1, 2, 4, 8 s; others: 1 retry after 1 s). A retry sends the same body and `seq` with a fresh timestamp and signature. **Phase 5 must answer 2xx for a `seq` it already applied**, or a lost response would make the runner report failure.
10. **Restore uses the newest `pg_restore` (18), with no version probe.** Newer tools read every older archive; the reverse is not true. Any non-zero exit of `pg_restore` is a failure (`RESTORE_FAILED`), even when it only ignored some errors, because a partial restore must not look like a success. `restore.targetDbName` is accepted and ignored (the database comes from `db.url`); the PRD and PLAN.md list it, and Phase 7 may store a sanitized name that differs from the real one, so comparing them would give false failures. The `--single-transaction` flag is not used (the PRD lists the flags); it is a candidate for an owner decision (see summary).
11. **Exit codes:** 0 job succeeded, 1 job failed or timed out, 2 invalid job input. An invalid job cannot be reported by callback because its `callbackUrl` and `jobKey` cannot be trusted, so the sweeper will time it out (Phase 5).
12. **Test layout.** Unit tests live in `container/test/` and run under `bun run test` (Vitest, Node). Docker scripts (`container/e2e/*.ts`) are NOT part of `bun run test`: they need Docker and Bun APIs, and the root `tsconfig.json` (Phase 1) type-checks all of `test/` with `@cloudflare/workers-types` only. The compose file and seed SQL are at `test/docker-compose.test.yml` and `test/fixtures/seed.sql` as the PRD asks.
13. **Part size rule** (PLAN.md section 8 asks for a size derived from `pg_database_size`): the requested size (`r2.partSizeBytes`, a config value sent by the Worker, default 32 MiB = 33554432 bytes per owner answer 12) is used unless `dbSize * 1.25 / 9,500` is larger (above about 237 GiB of database at 32 MiB); the result is rounded up to whole MiB and refused above 128 MiB (`choosePartSize` in Task 9). Peak memory is about 2x one part plus runtime overhead, and the `basic` instance has 1 GiB, so 128 MiB is the cap. At 128 MiB x 10,000 parts the hard cap is about 1.2 TiB per dump; the default 32 MiB covers about 312 GiB. Parts are equal size except the last, which also satisfies R2's equal-size rule [uncertain: R2 docs not re-read].
14. **`container/scripts/tunnel-spike.sh` stays in the repo** as a diagnostic the owner can re-run against a new tunnel.

## Dependencies (approved)

| Package | Why | Kind |
|---|---|---|
| `@types/bun` | Approved by the owner (round 2, answer 8). Types for `node:*` modules and Bun globals so `tsc -p container` can check the runner. No runtime use; the image ships no `node_modules`. | dev |

No other dependency is added. The runner has zero npm dependencies. Docker images used by tests (`postgres:14`, `postgres:17`, `rustfs/rustfs`) are test fixtures, not packages.

## Root wiring edits (register X15)

Phase 4 may touch only `container/`, the local test compose file, and the minimum root edits needed to run its tests. Approving this plan approves exactly these edits (all in Task 3 unless noted):

- `package.json`: script `typecheck` becomes `tsc --noEmit && tsc --noEmit -p container`; `@types/bun` added to `devDependencies`; `bun.lock` updated.
- `vitest.config.ts`: `include` gains `"container/test/**/*.test.ts"`.
- New `container/tsconfig.json` (inside `container/`).
- Outside `container/`, Task 15 creates `test/docker-compose.test.yml` and `test/fixtures/seed.sql` (the "local test compose file" and its seed data).
- Task 19 edits `docs/PLAN.md` (register: final task of every plan).

## Contract this phase produces (Phase 5 and Phase 7 consume it)

All files are under `container/`. The job JSON arrives on stdin and the image runs `bun run /app/entrypoint.ts` (owner answer 13). Signatures are final.

`container/hmac.ts` (WebCrypto only, no Bun API; Phase 5 imports it by relative path, for example `../../../container/hmac` from `src/worker/jobs/`):

      ```ts
      export const TIMESTAMP_HEADER = "X-Cellar-Timestamp";
      export const SIGNATURE_HEADER = "X-Cellar-Signature";
      export const MAX_SKEW_SECONDS = 300;
      export function signCallback(jobKeyBase64: string, timestamp: string, jobId: string, rawBody: string): Promise<string>; // hex HMAC-SHA256(key = base64-decoded jobKey, message = timestamp + "." + jobId + "." + rawBody)
      export interface VerifyCallbackInput { jobKeyBase64: string; timestamp: string; signatureHex: string; jobId: string; rawBody: string; nowSeconds: number }
      export function verifyCallback(input: VerifyCallbackInput): Promise<"ok" | "bad_timestamp" | "bad_signature">; // window check first, then constant-time verify
      ```

Job JSON on stdin (a file path argument is accepted for local e2e tests only). Field rules are enforced by `parseJob` in `container/job.ts`:

      ```json
      {
        "jobId": "string",
        "type": "test | backup | restore",
        "callbackUrl": "http(s)://.../internal/jobs/callback",
        "jobKey": "base64, 32 bytes",
        "deadlineAt": "ISO date; the runner aborts and reports TIMEOUT at this time",
        "db": { "url": "postgres://user:pass@host:port/dbname?sslmode=...", "name": "dbname" },
        "tunnel": { "hostname": "db.example.com", "tokenId": "...", "tokenSecret": "...", "localPort": 15432 },
        "r2": { "endpoint": "https://<acct>.r2.cloudflarestorage.com", "bucket": "...", "accessKeyId": "...", "secretAccessKey": "...", "region": "auto", "key": "backups/...", "partSizeBytes": 33554432 },
        "restore": { "sourceKey": "backups/...", "targetDbName": "dbname" }
      }
      ```

- `tunnel` is required for every job type (there is no direct mode). `localPort` is 1024-65535.
- `r2` is required for `backup` and `restore`. `r2.key` and `r2.partSizeBytes` (5 MiB to 5 GiB) are required for `backup` only. `r2.region` is optional.
- `restore` is required for `restore` only.
- Supported `db.url` query parameters: `sslmode`, `connect_timeout`, `application_name`. Others are rejected (`INVALID_JOB`).

Contract test (owner answer 13), created in Task 14 so Phase 5 can reuse it and the two sides cannot drift:

- `container/contract.ts` (plain data, no imports; Phase 5 imports it by relative path like `container/hmac.ts`):

      ```ts
      export const CONTRACT_ENTRYPOINT: readonly ["bun", "run", "/app/entrypoint.ts"];
      export const SAMPLE_JOBS: { readonly test: object; readonly backup: object; readonly restore: object }; // one valid stdin job per type, tunnel block always present, partSizeBytes 33554432
      export const SIGNATURE_VECTOR: { readonly jobKeyBase64: string; readonly timestamp: string; readonly jobId: string; readonly rawBody: string; readonly signatureHex: string }; // known answer for signCallback
      export function jobShape(value: unknown, prefix?: string): string[]; // sorted dotted key paths
      ```
- `container/test/contract.test.ts`: every `SAMPLE_JOBS` entry read through `loadJobText` (stdin) passes `parseJob` and fails without `tunnel`; `signCallback` reproduces `SIGNATURE_VECTOR` and `verifyCallback` accepts it; the Dockerfile `ENTRYPOINT` equals `CONTRACT_ENTRYPOINT`.
- Phase 5 reuse: its tests assert `jobShape(builtJob)` equals `jobShape(SAMPLE_JOBS[type])` for each job type it builds, that its callback verifier accepts `SIGNATURE_VECTOR`, and that it starts the container without overriding the entrypoint.

Callback request: `POST callbackUrl`, headers `content-type: application/json`, `X-Cellar-Timestamp` (unix seconds), `X-Cellar-Signature` (hex). Body, signed as the exact raw string:

      ```json
      { "jobId": "string", "event": "started | progress | succeeded | failed", "at": "ISO", "seq": 1,
        "result": { },
        "error": { "code": "TUNNEL_FAILED | AUTH_FAILED | DUMP_FAILED | UPLOAD_FAILED | DOWNLOAD_FAILED | RESTORE_FAILED | TIMEOUT | INVALID_JOB | UNKNOWN", "message": "redacted" } }
      ```

`result` exists on `succeeded` and `error` on `failed` only. `seq` starts at 1 and rises by 1 per event. The runner sends events in order, one at a time.

## Phase gate

Run before Task 0. If any check fails, STOP and report: an earlier phase moved.

- [ ] `bun run test && bun run typecheck` - Expected: both exit 0 (record the pass count in the summary)
- [ ] `for f in package.json tsconfig.json vitest.config.ts wrangler.jsonc docs/PLAN.md src/worker/env.ts src/worker/lib/redact.ts src/worker/lib/crypto.ts src/worker/db/schema.ts; do test -f "$f" && echo "ok $f" || echo "MISSING $f"; done` - Expected: nine `ok` lines, no `MISSING` (Phase 4 uses only `redact.ts` and the toolchain; the other files prove Phase 1 is complete)
- [ ] `grep -c 'export const REDACTED' src/worker/lib/redact.ts; grep -c 'export function redactSecrets' src/worker/lib/redact.ts` - Expected: `1` then `1` (Phase 1 plan, Task 3: `redactSecrets(input: string): string`, `REDACTED = "***"`)
- [ ] `grep -n '"typecheck"' package.json; grep -n 'include' vitest.config.ts` - Expected: `"typecheck": "tsc --noEmit"` (possibly with other commands) and an `include` containing `test/**/*.test.ts`. Task 3 edits these two lines; if they changed shape, adapt minimally.

Phase 4 needs only Phase 1 (`redact.ts`, the toolchain). It does not need Phases 2 and 3.

## Global Constraints

- TypeScript everywhere; Bun is the package manager; `bun run test` runs Vitest. (AGENTS.md)
- Image: `oven/bun:1.3.9-slim` (Debian slim) with postgresql-client 13-18 and `cloudflared`. The container runs on Bun. Default instance type is `basic`, set by one config value. (AGENTS.md)
- DB reachability: Cloudflare Tunnel (`cloudflared`). Postgres ports are never public. (AGENTS.md)
- R2 credentials are a bucket-scoped token injected per job at runtime. Never bake them into the image, never log them, never put them in queue messages. (AGENTS.md)
- Backups use `pg_dump -Fc`, streamed to R2 via multipart upload. Compute sha256 while streaming. Never buffer the whole dump on disk or in memory. (AGENTS.md)
- The backup role is read-only (`pg_read_all_data`). Restore uses a separate restore-capable connection URL. (AGENTS.md)
- Connection URLs, tunnel service tokens, and alert credentials are never returned or logged in plaintext. Redact connection strings and passwords from logs, errors, and callbacks. (AGENTS.md)
- Never hardcode secrets. Test credentials in the compose file are throwaway local values and are the only exception. (AGENTS.md)
- Do not guess Cloudflare limits or APIs. Write [uncertain] when unsure. (AGENTS.md)
- Stop and ask before: real Cloudflare resources, `wrangler deploy` or any remote command, an unlisted dependency, changing a locked decision, any data-deleting operation, and a tunnel fallback if the spike fails. (AGENTS.md)
- Only build what the current phase prompt asks. This phase touches ONLY `/container` and a local test compose file. (AGENTS.md, PRD)
- Using a real R2 bucket or any Cloudflare account resource needs the owner's approval first. (PRD)
- Secrets never appear in argv. Postgres tools get `PG*` env vars; `cloudflared` gets `TUNNEL_SERVICE_TOKEN_*` env vars. (PLAN.md section 5)
- Hard timeout per job is `deadlineAt` (default 2 hours, set by the Worker). Heartbeat every 30 s. Non-zero exit on failure. (PRD, register)
- If the same step fails 3 times, stop and report what you tried. (AGENTS.md)
- No em dash in any file you write. Use a plain dash. Do not add the agent as co-author in commit messages.
- Every task ends with its commit building: `bun run typecheck` must pass at the end of every task from Task 3 on.

## Patterns to Mirror

No code exists in the repo yet. These conventions come from the Phase 1 plan (planned, not yet in tree). SOURCE: `docs/plans/2026-10-24-phase-1-foundation.md`, section "Patterns to Mirror" and Tasks 2-3.

- **Naming:** files are `kebab-case.ts`. Tests mirror the source path: `container/hmac.ts` has `container/test/hmac.test.ts`. Strict TypeScript with `noUncheckedIndexedAccess` (inherited from the root `tsconfig.json`).
- **Error handling:** errors never include secrets. The Phase 1 redaction helper is the single source for URL-password masking:

      ```ts
      // SOURCE: docs/plans/2026-10-24-phase-1-foundation.md, Task 3 (planned, not yet in tree)
      export const REDACTED = "***";
      export function redactSecrets(input: string): string;
      export function redactError(error: unknown): string;
      ```

- **Tests:** Vitest, Node environment, `describe` / `it` / `expect`. Each module has a test file next to the plan task that creates it. Phase 1 uses fixed fake keys built in the test file.
- **Style of Phase 1 reference code:** small modules, `export` only what other modules use, comments only where the code cannot explain itself.

## What was run in scratch

Scratch project: `/tmp/phase-4-scratch/proj` (Bun 1.3.5, TypeScript 7.0.2, Vitest 5.0.5, `@types/bun` 1.4.4). The Phase 1 `redact.ts` was copied from its plan.

| Run in scratch | Result |
|---|---|
| `tsc --noEmit -p container` (all `container/**/*.ts`, including e2e scripts) | 0 errors |
| root `tsc --noEmit` with a file that imports `container/hmac.ts` (workers-types only) | 0 errors after the `Uint8Array<ArrayBuffer>` fixes now in `hmac.ts` |
| `vitest run` (9 test files) | 64 tests pass |
| SigV4 signer against two AWS documentation vectors | signatures match |
| Runner (`entrypoint.ts`) against a local PostgreSQL 16 and a throwaway S3 server: `test`, `backup`, `restore`, and a missing-database failure | all behaved as expected; restored row counts 50,000 and 20,000 equal the source; callbacks verified with `verifyCallback` |
| `test/fixtures/seed.sql` on local PostgreSQL 16 | counts 2000 / 20000 / 5000 / 2000 |
| `bash -n` on the spike script; YAML parse of the compose file | ok |
| Memory probes | numbers in the "Closed by owner (round 2)" table; 64 MiB parts peaked at 239 MiB, which is why 32 MiB was chosen |

Not re-run after the round 2 reconciliation (2026-10-24): the required `tunnel` block in `job.ts` and its tests, the one-argument `classifyConnectionFailure`, the always-on tunnel in `context.ts` and `entrypoint.ts`, the 32 MiB `choosePartSize` tests, the `/app/` image layout, `container/contract.ts` and its test, `container/e2e/fake-cloudflared.ts`, and the `runner-local` compose service. The scratch runner run above used a direct connection, which no longer exists.

NOT run (no Docker on the planning machine, no real tunnel, no real R2): `container/Dockerfile`, `container/Dockerfile.dockerignore`, `test/docker-compose.test.yml`, the RustFS service, `container/e2e/run.ts`, `container/e2e/large.ts`, `container/e2e/tunnel.ts`, and the spike against a real tunnel.

The scratch run found one real bug that is already fixed in the code below: `setTimeout` overflowed for a deadline more than 24.8 days away (clamped by `MAX_TIMER_MS`).

## Preflight

### DURABLE - true until the repo itself changes

- **`cloudflared access tcp` reads the token from env.** Evidence: `cloudflared access tcp --help` (2026.10.3, run locally) prints `--service-token-id value ... [$TUNNEL_SERVICE_TOKEN_ID]` and `--service-token-secret value ... [$TUNNEL_SERVICE_TOKEN_SECRET]`. Consequence: Task 10 passes the secret in env only.
- **The base image is Debian trixie.** Evidence: Bun's Dockerfile at tag `bun-v1.3.9` starts `FROM debian:trixie-slim`; Docker Hub lists `oven/bun:1.3.9-slim` for `linux/amd64` and `linux/arm64`. Consequence: the PGDG suite is `trixie-pgdg`, taken from `/etc/os-release` at build time.
- **Pinned `cloudflared` 2026.10.3 checksums.** Evidence: the SHA-256 of `cloudflared-linux-amd64` and `cloudflared-linux-arm64` was computed from a fresh download and equals the value in the GitHub release notes. Both values are in the Dockerfile in Task 1.
- **Docker scripts cannot join `bun run test`.** Evidence: the Phase 1 plan's `tsconfig.json` has `"include": ["src", "test", ...]` and `"types": ["@cloudflare/workers-types"]`. Consequence: Bun-API scripts live in `container/e2e/`, not `test/`.
- **A Vitest test cannot import Bun globals.** Consequence: unit-tested modules use only `node:` APIs, `fetch`, and WebCrypto; only `entrypoint.ts` and `container/e2e/*` use top-level side effects.

### PERISHABLE - recapture before Task 0

- **Docker is installed and running.** Check: `docker info > /dev/null && echo docker-ok`. Needed by: Tasks 1, 2, 14-18. Planning machine result: `docker-DOWN` (`docker: command not found`; Docker is NOT installed there). If down: STOP and ask; do not defer the Docker verifies to the end.
- **Free disk, about 10 GB.** Check: `df -h . | tail -1`. Needed by: Task 17 (about 2.5 GB database, WAL, about 1.2 GB dump, images). Planning machine: 35 GiB free.
- **Bun version.** Check: `bun --version`. Planning machine: `1.3.5`. The image uses 1.3.9; behavior differences are covered by the Docker verifies.
- **Free ports 19000 (S3 stand-in) and 18080 (callback listener).** Check: `lsof -i :19000 -i :18080`. Expected: no output. Planning machine: free. Port 5432 may be in use by a local Postgres; the compose file does not publish Postgres ports.
- **Network access** to Docker Hub (`postgres:14`, `postgres:17`, `rustfs/rustfs:1.0.3`, `oven/bun:1.3.9-slim`), `apt.postgresql.org`, `www.postgresql.org`, and `github.com` (the `cloudflared` download). Check: `curl -sI https://apt.postgresql.org/pub/repos/apt/dists/trixie-pgdg/Release | head -1` - Expected: `HTTP/2 200`. The `postgresql-client-13` to `-18` packages were present for amd64 and arm64 in `trixie-pgdg` on 2026-10-24 (read from `Packages.gz`). Re-check with: `for a in amd64 arm64; do curl -s https://apt.postgresql.org/pub/repos/apt/dists/trixie-pgdg/main/binary-$a/Packages.gz | gunzip | grep -cE '^Package: postgresql-client-(1[3-8])$'; done` - Expected: a number of at least 6 for each architecture (planning run: `17` and `17`, because several versions of each package are listed).
- **Git state.** Check: `git status --short && git rev-parse --short HEAD`. Expected: only plan or docs files untracked; record the sha.
- **Baseline red count.** The Phase gate requires green, so the baseline is: `bun run test` and `bun run typecheck` exit 0. Record the pass count. Every later "no new failures" check means that count plus the tests this plan adds.
- **Owner-supplied tunnel (Task 2 and Task 18 only).** The owner has created, outside this repo, a named Tunnel with a TCP public hostname to a Postgres, a self-hosted Access application on that hostname, and a Service Auth policy for one service token (PLAN.md section 7). The agent creates none of it. Check the environment WITHOUT printing values: `for v in SPIKE_HOSTNAME TUNNEL_SERVICE_TOKEN_ID TUNNEL_SERVICE_TOKEN_SECRET PGUSER PGPASSWORD PGDATABASE; do test -n "${!v}" && echo "$v set" || echo "$v NOT set"; done` (bash). Planning machine: not set. If NOT set when Task 2 arrives, STOP and ask the owner.
- **Apple Silicon builds an arm64 image.** Production Containers need `linux/amd64` (`docs/research-notes.md` section 1). Local tests run the native architecture. Task 1 has an optional amd64 build check [uncertain: needs QEMU or a remote builder].

## Execution

**Tracks:** one track, sequential. The tasks form a chain (each builds on the previous one's files), and no group of independent tasks reaches the parallel cost floor, so there are no worktrees.
**Merge order:** not applicable.
**Shared files:** `package.json`, `bun.lock`, `vitest.config.ts` are owned by Task 3 only. `docs/PLAN.md` is owned by Task 19 only. `container/Dockerfile` is owned by Task 1 only (later tasks add files under `container/` that it already copies).
**Worktree setup:** none. Work in `/Users/jametirakarn/Desktop/Theerakarnm/Cellar` on a new branch from the current integration branch: `git switch -c phase-4-container`.
**treehouse:** not needed for a single track.

---

### Task 0: Branch and commit this plan

**Files:**
- Commit only: `docs/plans/2026-10-24-phase-4-container-image-job-runner.md`

**Interfaces:**
- Consumes: a green tree (Phase gate).
- Produces: branch `phase-4-container` with a clean base.

**Steps:**
- [ ] Step 1: Create the branch: `git switch -c phase-4-container`
- [ ] Step 2: Commit this plan only (do not use `git add -A`):
      ```bash
      git add docs/plans/2026-10-24-phase-4-container-image-job-runner.md
      git commit -m "docs: add phase 4 plan (container image and job runner)"
      ```
- [ ] Step 3: Verify - Run: `git status --short; git log --oneline | head -1` - Expected: no output from `git status` for tracked paths of this plan (other planning files may still be untracked), and the latest commit is the one above

---

### Task 1: Container image and the tunnel spike script

**Files:**
- Create: `container/Dockerfile`, `container/Dockerfile.dockerignore`, `container/scripts/tunnel-spike.sh`

**Interfaces:**
- Consumes: `src/worker/lib/redact.ts` (Phase 1, copied into the image; it need only exist for `COPY`).
- Produces: image `cellar-runner:dev`. Contains `/usr/lib/postgresql/{13..18}/bin/*`, `/usr/local/bin/cloudflared` 2026.10.3, `/app/**` (the contents of `container/`), `/src/worker/lib/redact.ts`, runs as user `bun`, `ENTRYPOINT ["bun", "run", "/app/entrypoint.ts"]` (owner answer 13) (that file arrives in Task 14).

**Gotcha:**
- Build from the repo root. The context is the root, so a build from inside `container/` fails on `COPY src/...`.
- `curl` stays installed (small). `gnupg` is not needed because PGDG publishes an armored key that `signed-by` accepts directly.
- `cloudflared` is a direct binary download checked against a pinned SHA-256, not the Cloudflare apt repo, so the version is exact. Bump the version and BOTH checksums together.
- The spike script reads the token from env vars named like `cloudflared`'s own (`TUNNEL_SERVICE_TOKEN_ID`, `TUNNEL_SERVICE_TOKEN_SECRET`), so `cloudflared` picks them up without flags.

**Steps:**
- [ ] Step 1: Create `container/Dockerfile`:
      ```dockerfile
      # Build from the repo root: docker build -f container/Dockerfile -t cellar-runner:dev .
      # The root is the build context so the runner can share src/worker/lib/redact.ts with the Worker.
      FROM oven/bun:1.3.9-slim

      ARG CLOUDFLARED_VERSION=2026.10.3
      ARG CLOUDFLARED_SHA256_AMD64=053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0
      ARG CLOUDFLARED_SHA256_ARM64=89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8

      RUN apt-get update \
       && apt-get install -y --no-install-recommends ca-certificates curl \
       && install -d /usr/share/postgresql-common/pgdg \
       && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       && . /etc/os-release \
       && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
       && apt-get update \
       && apt-get install -y --no-install-recommends \
            postgresql-client-13 postgresql-client-14 postgresql-client-15 \
            postgresql-client-16 postgresql-client-17 postgresql-client-18 \
       && rm -rf /var/lib/apt/lists/*

      RUN arch="$(dpkg --print-architecture)" \
       && case "$arch" in amd64) sha="$CLOUDFLARED_SHA256_AMD64" ;; arm64) sha="$CLOUDFLARED_SHA256_ARM64" ;; *) echo "unsupported architecture: $arch" >&2; exit 1 ;; esac \
       && curl -fsSL -o /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-${arch}" \
       && echo "${sha}  /usr/local/bin/cloudflared" | sha256sum -c - \
       && chmod +x /usr/local/bin/cloudflared

      WORKDIR /app
      COPY container/ /app/
      COPY src/worker/lib/redact.ts /src/worker/lib/redact.ts

      USER bun
      ENTRYPOINT ["bun", "run", "/app/entrypoint.ts"]
      ```
- [ ] Step 2: Create `container/Dockerfile.dockerignore`:
      ```
      # Applies to container/Dockerfile (BuildKit reads <Dockerfile>.dockerignore). Send only what the image copies.
      *
      !container/
      container/test/
      container/e2e/
      container/tsconfig.json
      !src/worker/lib/redact.ts
      ```
- [ ] Step 3: Create `container/scripts/tunnel-spike.sh`, then `chmod +x container/scripts/tunnel-spike.sh`:
      ```bash
      #!/usr/bin/env bash
      # Tunnel spike: proves that cloudflared + a service token reaches a real Postgres from inside the image.
      # Run it inside the image (see Task 2). All credentials come from the environment, never from a file or argv.
      # Required env: SPIKE_HOSTNAME, TUNNEL_SERVICE_TOKEN_ID, TUNNEL_SERVICE_TOKEN_SECRET, PGUSER, PGPASSWORD, PGDATABASE
      set -euo pipefail

      for name in SPIKE_HOSTNAME TUNNEL_SERVICE_TOKEN_ID TUNNEL_SERVICE_TOKEN_SECRET PGUSER PGPASSWORD PGDATABASE; do
        if [ -z "${!name:-}" ]; then echo "missing env var: $name" >&2; exit 2; fi
      done

      PORT="${SPIKE_LOCAL_PORT:-15432}"
      LOG="$(mktemp)"
      redact() { sed -e "s/${TUNNEL_SERVICE_TOKEN_SECRET}/***/g" -e "s/${PGPASSWORD}/***/g"; }

      cloudflared access tcp --hostname "$SPIKE_HOSTNAME" --url "127.0.0.1:${PORT}" --loglevel info >"$LOG" 2>&1 &
      CF_PID=$!
      trap 'kill "$CF_PID" 2>/dev/null || true' EXIT

      for _ in $(seq 1 60); do
        if (echo > "/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then break; fi
        if ! kill -0 "$CF_PID" 2>/dev/null; then echo "cloudflared exited early:" >&2; redact <"$LOG" >&2; exit 1; fi
        sleep 0.5
      done

      export PGHOST=127.0.0.1 PGPORT="$PORT"
      PG18=/usr/lib/postgresql/18/bin
      if ! "$PG18/psql" -X -At --no-password -c "select version()"; then
        echo "psql failed. cloudflared log:" >&2; redact <"$LOG" >&2; exit 1
      fi
      BYTES="$("$PG18/pg_dump" --format=custom --schema-only --no-password | wc -c)"
      echo "schema-only pg_dump streamed ${BYTES} bytes through the tunnel"
      if [ "$BYTES" -le 0 ]; then echo "pg_dump produced no data" >&2; exit 1; fi
      echo "SPIKE OK"
      ```
- [ ] Step 4: Build: `docker build -f container/Dockerfile -t cellar-runner:dev .` - the build must finish without error.
- [ ] Step 5: Verify - Run: `docker run --rm --entrypoint bash cellar-runner:dev -c 'for v in 13 14 15 16 17 18; do /usr/lib/postgresql/$v/bin/pg_dump --version; done; cloudflared --version; bun --version; id -un; cloudflared access tcp --help | grep -c "service-token"; test -f /app/scripts/tunnel-spike.sh && echo script-present; test -f /src/worker/lib/redact.ts && echo redact-present'` - Expected: six lines `pg_dump (PostgreSQL) 13.x` through `18.x`, then `cloudflared version 2026.10.3 (...)`, `1.3.9`, `bun`, `2`, `script-present`, `redact-present`
- [ ] Step 6: Verify - Run: `bash -n container/scripts/tunnel-spike.sh && docker run --rm --entrypoint bash cellar-runner:dev /app/scripts/tunnel-spike.sh; echo "exit=$?"` - Expected: `missing env var: SPIKE_HOSTNAME` on stderr and `exit=2`
- [ ] Step 7: Optional, only if the machine is not amd64: `docker buildx build --platform linux/amd64 -f container/Dockerfile -t cellar-runner:amd64 --load .` - Expected: build succeeds. If the machine has no QEMU or remote builder, record "amd64 build not checked" in the summary; this is not a failure (Phase 5's `wrangler deploy` builds amd64 later).
- [ ] Step 8: Commit - `git add container/Dockerfile container/Dockerfile.dockerignore container/scripts/tunnel-spike.sh && git commit -m "feat(container): add runner image with postgresql-client 13-18 and cloudflared, plus tunnel spike script"`

---

### Task 2: Tunnel spike with the owner's real tunnel (Human gate)

**Files:**
- No files. Run the spike script from Task 1.

**Interfaces:**
- Consumes: image `cellar-runner:dev` (Task 1); the owner's tunnel, Access TCP application, service token, and a Postgres behind them (Preflight).
- Produces: a go / no-go on the tunnel approach. Go means Task 3 may start.

**Gotcha:**
- Credentials go through the environment only: `docker run -e NAME` (no value) forwards the variable from your shell. Never put a value on the command line and never write one to a file.
- This task uses the owner's real Cloudflare resources. The agent does not create, change, or delete any of them. Only the owner runs Step 2.
- If the spike fails, STOP and report. Do NOT build a Worker-side TCP proxy or a VM-side agent (AGENTS.md). Include the redacted script output and the `cloudflared` log lines the script prints.
- The script prints the server version and the byte count of a schema-only `pg_dump -Fc` streamed through the tunnel. It does not write to R2 (the PRD forbids real R2 here).

**Steps:**
- [ ] Step 1: Owner exports the six variables in their own shell (names only here): `SPIKE_HOSTNAME`, `TUNNEL_SERVICE_TOKEN_ID`, `TUNNEL_SERVICE_TOKEN_SECRET`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
- [ ] Step 2: Owner runs:
      ```bash
      docker run --rm \
        -e SPIKE_HOSTNAME -e TUNNEL_SERVICE_TOKEN_ID -e TUNNEL_SERVICE_TOKEN_SECRET \
        -e PGUSER -e PGPASSWORD -e PGDATABASE \
        --entrypoint bash cellar-runner:dev /app/scripts/tunnel-spike.sh
      ```
- [ ] Step 3: Proxy for the Human check - Verify - Run: `docker run --rm --entrypoint cloudflared cellar-runner:dev access tcp --help | grep -E "service-token-(id|secret)"` - Expected: two lines, each ending with `[$TUNNEL_SERVICE_TOKEN_ID]` or `[$TUNNEL_SERVICE_TOKEN_SECRET]` (the binary in the image accepts the token via env)
- [ ] Step 4: Proxy, failure path - Verify - Run: `docker run --rm -e SPIKE_HOSTNAME=spike.invalid -e TUNNEL_SERVICE_TOKEN_ID=x -e TUNNEL_SERVICE_TOKEN_SECRET=y -e PGUSER=u -e PGPASSWORD=p -e PGDATABASE=d --entrypoint bash cellar-runner:dev /app/scripts/tunnel-spike.sh; echo "exit=$?"` - Expected: a non-zero exit with a `cloudflared` log or a `psql failed` message, within about 30 seconds, and the strings `x`-only secret `y` and `p` replaced by `***` where they appear
- [ ] 👤 Step 5: Verify - Human: owner reads the Step 2 output - Expected: first a line starting `PostgreSQL ` with the server version, then `schema-only pg_dump streamed N bytes through the tunnel` with N greater than 0, then `SPIKE OK` - Proxy: Step 3 (the binary takes the token from env) and Step 4 (the script fails loudly and redacts when the tunnel is wrong)
- [ ] Step 6: Record the outcome (date, `SPIKE OK` yes or no, server version, redacted log lines if it failed) in the phase summary. On failure: STOP.

---

### Task 3: Root wiring and the callback HMAC module

**Files:**
- Create: `container/tsconfig.json`, `container/hmac.ts`, `container/test/hmac.test.ts`
- Modify: `package.json` (anchor: `"typecheck": "tsc --noEmit"` in `scripts`; `devDependencies`), `vitest.config.ts` (anchor: `include: ["test/**/*.test.ts"]`), `bun.lock` (emitted by `bun add`)
- This task exceeds the usual 3-file ceiling on purpose: the container project cannot be type-checked or tested until its tsconfig, its test include, and its first source file exist together (`tsc -p container` fails with "No inputs were found" otherwise).

**Interfaces:**
- Consumes: root `tsconfig.json` (Phase 1: strict, `noUncheckedIndexedAccess`, `moduleResolution: Bundler`), root `vitest.config.ts` (Phase 1), scripts `typecheck` and `test`.
- Produces: `container/hmac.ts` with the signatures in "Contract this phase produces"; `bun run typecheck` now also checks `container/`; `bun run test` now also runs `container/test/**/*.test.ts`.

**Gotcha:**
- `hmac.ts` must compile under BOTH tsconfigs: the root one (`@cloudflare/workers-types`, because Phase 5's Worker imports it) and the container one (`bun` types). TypeScript 7 types `Uint8Array.from`, `TextEncoder.encode` as `Uint8Array<ArrayBufferLike>`, which `crypto.subtle` rejects, so the helpers build `new Uint8Array(n)` explicitly. Step 7 proves the root compile.
- `container/tsconfig.json` extends the root file and replaces `types` and `include`. Its `include` lists `../src/worker/lib/redact.ts` because container code imports it.
- `@types/bun` is owner-approved (round 2, answer 8; see the dependency table).

**Steps:**
- [ ] Step 1: Add the dev dependency: `bun add -d @types/bun`
- [ ] Step 2: In `package.json` change the script (if Phase 2 or 3 changed it, keep their parts):
  old: `"typecheck": "tsc --noEmit"`
  new: `"typecheck": "tsc --noEmit && tsc --noEmit -p container"`
- [ ] Step 3: In `vitest.config.ts` change:
  old: `include: ["test/**/*.test.ts"],`
  new: `include: ["test/**/*.test.ts", "container/test/**/*.test.ts"],`
- [ ] Step 4: Create `container/tsconfig.json`:
      ```json
      {
        "extends": "../tsconfig.json",
        "compilerOptions": {
          "types": ["bun"]
        },
        "include": ["./**/*.ts", "../src/worker/lib/redact.ts"]
      }
      ```
- [ ] Step 5: Create `container/hmac.ts`:
      ```ts
      export const TIMESTAMP_HEADER = "X-Cellar-Timestamp";
      export const SIGNATURE_HEADER = "X-Cellar-Signature";
      export const MAX_SKEW_SECONDS = 300;

      function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      function bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }

      function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
        if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return bytes;
      }

      function importKey(jobKeyBase64: string, usage: "sign" | "verify"): Promise<CryptoKey> {
        return crypto.subtle.importKey("raw", base64ToBytes(jobKeyBase64), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
      }

      function signedMessage(timestamp: string, jobId: string, rawBody: string): Uint8Array<ArrayBuffer> {
        return new Uint8Array(new TextEncoder().encode(`${timestamp}.${jobId}.${rawBody}`));
      }

      /** Hex HMAC-SHA256(jobKey, timestamp + "." + jobId + "." + rawBody). `timestamp` is unix seconds as a string. */
      export async function signCallback(
        jobKeyBase64: string,
        timestamp: string,
        jobId: string,
        rawBody: string,
      ): Promise<string> {
        const key = await importKey(jobKeyBase64, "sign");
        const signature = await crypto.subtle.sign("HMAC", key, signedMessage(timestamp, jobId, rawBody));
        return bytesToHex(new Uint8Array(signature));
      }

      export interface VerifyCallbackInput {
        jobKeyBase64: string;
        timestamp: string;
        signatureHex: string;
        jobId: string;
        rawBody: string;
        nowSeconds: number;
      }

      /** Checks the timestamp window first, then the signature with WebCrypto's constant-time `verify`. */
      export async function verifyCallback(input: VerifyCallbackInput): Promise<"ok" | "bad_timestamp" | "bad_signature"> {
        if (!/^\d{1,12}$/.test(input.timestamp)) return "bad_timestamp";
        if (Math.abs(input.nowSeconds - Number(input.timestamp)) > MAX_SKEW_SECONDS) return "bad_timestamp";
        const signature = hexToBytes(input.signatureHex);
        if (!signature) return "bad_signature";
        const key = await importKey(input.jobKeyBase64, "verify");
        const valid = await crypto.subtle.verify(
          "HMAC",
          key,
          signature,
          signedMessage(input.timestamp, input.jobId, input.rawBody),
        );
        return valid ? "ok" : "bad_signature";
      }
      ```
- [ ] Step 6: Create `container/test/hmac.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { MAX_SKEW_SECONDS, signCallback, verifyCallback } from "../hmac";

      const jobKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
      const otherKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(8)));
      const body = JSON.stringify({ jobId: "job-1", event: "started", seq: 1 });
      const now = 1_800_000_000;

      async function signed(timestamp = String(now)) {
        return { timestamp, signatureHex: await signCallback(jobKey, timestamp, "job-1", body) };
      }

      describe("callback hmac", () => {
        it("produces a stable 64-char hex signature", async () => {
          const first = await signCallback(jobKey, String(now), "job-1", body);
          expect(first).toMatch(/^[0-9a-f]{64}$/);
          expect(await signCallback(jobKey, String(now), "job-1", body)).toBe(first);
        });

        it("matches an independent HMAC-SHA256 computation", async () => {
          const { createHmac } = await import("node:crypto");
          const expected = createHmac("sha256", Buffer.from(jobKey, "base64")).update(`${now}.job-1.${body}`).digest("hex");
          expect(await signCallback(jobKey, String(now), "job-1", body)).toBe(expected);
        });

        it("accepts a valid signature", async () => {
          const { timestamp, signatureHex } = await signed();
          expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("ok");
        });

        it("rejects a changed body, job id, timestamp, or key", async () => {
          const { timestamp, signatureHex } = await signed();
          const base = { jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now };
          expect(await verifyCallback({ ...base, rawBody: body.replace("started", "succeeded") })).toBe("bad_signature");
          expect(await verifyCallback({ ...base, jobId: "job-2" })).toBe("bad_signature");
          expect(await verifyCallback({ ...base, timestamp: String(now + 1) })).toBe("bad_signature");
          expect(await verifyCallback({ ...base, jobKeyBase64: otherKey })).toBe("bad_signature");
        });

        it("rejects malformed signatures", async () => {
          const { timestamp } = await signed();
          for (const signatureHex of ["", "zz", "abc", "00".repeat(32)]) {
            expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("bad_signature");
          }
        });

        it("enforces the 5 minute window on both sides, boundary included", async () => {
          for (const offset of [-MAX_SKEW_SECONDS, MAX_SKEW_SECONDS]) {
            const { timestamp, signatureHex } = await signed(String(now + offset));
            expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("ok");
          }
          for (const offset of [-MAX_SKEW_SECONDS - 1, MAX_SKEW_SECONDS + 1]) {
            const { timestamp, signatureHex } = await signed(String(now + offset));
            expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex, jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("bad_timestamp");
          }
        });

        it("rejects non-numeric timestamps", async () => {
          for (const timestamp of ["", "abc", "1.5", "-1", "1e9"]) {
            expect(await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex: "00", jobId: "job-1", rawBody: body, nowSeconds: now })).toBe("bad_timestamp");
          }
        });
      });
      ```
- [ ] Step 7: Verify - Run (root compile with workers-types): `printf 'import { signCallback } from "../../container/hmac";\nexport const x = signCallback;\n' > src/worker/_hmac_compat.ts; bunx tsc --noEmit; echo "exit=$?"; rm src/worker/_hmac_compat.ts` - Expected: no tsc output and `exit=0`
- [ ] Step 8: Verify - Run: `bun run typecheck && bunx vitest run container/test/hmac.test.ts` - Expected: typecheck exits 0; `Tests  7 passed (7)`
- [ ] Step 9: Commit - `git add package.json bun.lock vitest.config.ts container/tsconfig.json container/hmac.ts container/test/hmac.test.ts && git commit -m "feat(container): add callback hmac module and wire container into typecheck and test"`

---

### Task 4: Job input: types, parsing, loading

**Files:**
- Create: `container/job.ts`, `container/test/job.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by every later container module):
  ```ts
  export type JobType = "test" | "backup" | "restore";
  export type ErrorCode = "TUNNEL_FAILED" | "AUTH_FAILED" | "DUMP_FAILED" | "UPLOAD_FAILED" | "DOWNLOAD_FAILED" | "RESTORE_FAILED" | "TIMEOUT" | "INVALID_JOB" | "UNKNOWN";
  export class JobError extends Error { constructor(code: ErrorCode, message: string); readonly code: ErrorCode }
  export interface TunnelInput { hostname: string; tokenId: string; tokenSecret: string; localPort: number }
  export interface R2Input { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string; key?: string; partSizeBytes?: number }
  export interface Job { jobId: string; type: JobType; callbackUrl: string; jobKey: string; deadlineAt: Date; db: { url: string; name: string }; tunnel: TunnelInput; r2?: R2Input; restore?: { sourceKey: string; targetDbName: string } }
  export function parseJob(text: string): Job; // throws JobError("INVALID_JOB") naming the field, never the value
  export function loadJobText(args: string[], io: { readFile(path: string): Promise<string>; readStdin(): Promise<string> }): Promise<string>
  ```

**Steps:**
- [ ] Step 1: Create `container/job.ts`:
      ```ts
      export type JobType = "test" | "backup" | "restore";

      export type ErrorCode =
        | "TUNNEL_FAILED"
        | "AUTH_FAILED"
        | "DUMP_FAILED"
        | "UPLOAD_FAILED"
        | "DOWNLOAD_FAILED"
        | "RESTORE_FAILED"
        | "TIMEOUT"
        | "INVALID_JOB"
        | "UNKNOWN";

      export class JobError extends Error {
        constructor(
          readonly code: ErrorCode,
          message: string,
        ) {
          super(message);
          this.name = "JobError";
        }
      }

      export interface TunnelInput {
        hostname: string;
        tokenId: string;
        tokenSecret: string;
        localPort: number;
      }

      export interface R2Input {
        endpoint: string;
        bucket: string;
        accessKeyId: string;
        secretAccessKey: string;
        region: string;
        key?: string;
        partSizeBytes?: number;
      }

      export interface Job {
        jobId: string;
        type: JobType;
        callbackUrl: string;
        jobKey: string;
        deadlineAt: Date;
        db: { url: string; name: string };
        tunnel: TunnelInput;
        r2?: R2Input;
        restore?: { sourceKey: string; targetDbName: string };
      }

      type Obj = Record<string, unknown>;

      function invalid(path: string, expected: string): never {
        throw new JobError("INVALID_JOB", `Invalid job: ${path} must be ${expected}`);
      }

      function obj(value: unknown, path: string): Obj {
        if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "an object");
        return value as Obj;
      }

      function str(parent: Obj, key: string, path: string): string {
        const value = parent[key];
        if (typeof value !== "string" || value.length === 0) invalid(`${path}${key}`, "a non-empty string");
        return value as string;
      }

      function optStr(parent: Obj, key: string, path: string): string | undefined {
        return parent[key] === undefined ? undefined : str(parent, key, path);
      }

      function int(parent: Obj, key: string, path: string, min: number, max: number): number {
        const value = parent[key];
        if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
          invalid(`${path}${key}`, `an integer between ${min} and ${max}`);
        }
        return value as number;
      }

      /** Parses the job JSON. Error messages name the bad field only, never its value. */
      export function parseJob(text: string): Job {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new JobError("INVALID_JOB", "Invalid job: not valid JSON");
        }
        const root = obj(raw, "job");
        const type = str(root, "type", "");
        if (type !== "test" && type !== "backup" && type !== "restore") invalid("type", "test, backup or restore");

        const deadlineAt = new Date(str(root, "deadlineAt", ""));
        if (Number.isNaN(deadlineAt.getTime())) invalid("deadlineAt", "an ISO date");

        const db = obj(root.db, "db");
        const tunnel = obj(root.tunnel, "tunnel");
        const job: Job = {
          jobId: str(root, "jobId", ""),
          type: type as JobType,
          callbackUrl: str(root, "callbackUrl", ""),
          jobKey: str(root, "jobKey", ""),
          deadlineAt,
          db: { url: str(db, "url", "db."), name: str(db, "name", "db.") },
          tunnel: {
            hostname: str(tunnel, "hostname", "tunnel."),
            tokenId: str(tunnel, "tokenId", "tunnel."),
            tokenSecret: str(tunnel, "tokenSecret", "tunnel."),
            localPort: int(tunnel, "localPort", "tunnel.", 1024, 65535),
          },
        };

        if (type !== "test") {
          const r2 = obj(root.r2, "r2");
          job.r2 = {
            endpoint: str(r2, "endpoint", "r2."),
            bucket: str(r2, "bucket", "r2."),
            accessKeyId: str(r2, "accessKeyId", "r2."),
            secretAccessKey: str(r2, "secretAccessKey", "r2."),
            region: optStr(r2, "region", "r2.") ?? "auto",
          };
          if (type === "backup") {
            job.r2.key = str(r2, "key", "r2.");
            job.r2.partSizeBytes = int(r2, "partSizeBytes", "r2.", 5 * 1024 * 1024, 5 * 1024 * 1024 * 1024);
          } else {
            const restore = obj(root.restore, "restore");
            job.restore = { sourceKey: str(restore, "sourceKey", "restore."), targetDbName: str(restore, "targetDbName", "restore.") };
          }
        }
        return job;
      }

      /** Job JSON from stdin. A file path argument is for the local e2e harness only; argv never holds secrets. */
      export async function loadJobText(
        args: string[],
        io: { readFile(path: string): Promise<string>; readStdin(): Promise<string> },
      ): Promise<string> {
        const path = args[0];
        if (path !== undefined && path !== "-") return io.readFile(path);
        return io.readStdin();
      }
      ```
- [ ] Step 2: Create `container/test/job.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { JobError, loadJobText, parseJob } from "../job";

      const base = {
        jobId: "job-1",
        type: "test",
        callbackUrl: "http://127.0.0.1:18080/internal/jobs/callback",
        jobKey: "a2V5",
        deadlineAt: "2026-10-24T04:00:00.000Z",
        db: { url: "postgres://app:s3cretpw@db:5432/shop", name: "shop" },
        tunnel: { hostname: "db.example.com", tokenId: "id-1234", tokenSecret: "tok-secret", localPort: 15432 },
      };
      const r2 = { endpoint: "http://s3:9000", bucket: "cellar", accessKeyId: "AKIA1234", secretAccessKey: "sup3rsecret" };
      const { tunnel } = base;

      function expectInvalid(input: unknown, field: string, secret?: string) {
        try {
          parseJob(typeof input === "string" ? input : JSON.stringify(input));
          throw new Error("expected parseJob to throw");
        } catch (error) {
          expect(error).toBeInstanceOf(JobError);
          expect((error as JobError).code).toBe("INVALID_JOB");
          expect((error as JobError).message).toContain(field);
          if (secret) expect((error as JobError).message).not.toContain(secret);
        }
      }

      describe("parseJob", () => {
        it("parses a test job; the tunnel block is required", () => {
          const job = parseJob(JSON.stringify(base));
          expect(job.type).toBe("test");
          expect(job.tunnel.hostname).toBe("db.example.com");
          expect(job.deadlineAt.toISOString()).toBe("2026-10-24T04:00:00.000Z");
        });

        it("parses a backup job and defaults the region to auto", () => {
          const job = parseJob(JSON.stringify({ ...base, type: "backup", r2: { ...r2, key: "backups/t/k.dump", partSizeBytes: 33554432 } }));
          expect(job.tunnel.localPort).toBe(15432);
          expect(job.r2).toMatchObject({ key: "backups/t/k.dump", partSizeBytes: 33554432, region: "auto" });
        });

        it("parses a restore job", () => {
          const job = parseJob(JSON.stringify({ ...base, type: "restore", r2, restore: { sourceKey: "backups/t/k.dump", targetDbName: "scratch" } }));
          expect(job.restore).toEqual({ sourceKey: "backups/t/k.dump", targetDbName: "scratch" });
          expect(job.r2?.key).toBeUndefined();
        });

        it("names the bad field and never echoes values", () => {
          expectInvalid("{not json", "not valid JSON");
          expectInvalid({ ...base, type: "explode" }, "type");
          expectInvalid({ ...base, deadlineAt: "tomorrow" }, "deadlineAt");
          expectInvalid({ ...base, db: { url: 5, name: "shop" } }, "db.url");
          expectInvalid({ ...base, type: "backup", r2 }, "r2.key");
          expectInvalid({ ...base, type: "backup", r2: { ...r2, key: "k", partSizeBytes: 100 } }, "r2.partSizeBytes");
          expectInvalid({ ...base, tunnel: undefined }, "tunnel");
          expectInvalid({ ...base, type: "backup", r2: { ...r2, key: "k", partSizeBytes: 33554432 }, tunnel: { ...tunnel, localPort: 80 } }, "tunnel.localPort");
          expectInvalid({ ...base, type: "restore", r2 }, "restore");
          expectInvalid({ ...base, type: "backup", r2: { ...r2, secretAccessKey: "" , key: "k", partSizeBytes: 33554432 } }, "r2.secretAccessKey", "sup3rsecret");
        });
      });

      describe("loadJobText", () => {
        const io = {
          readFile: async (path: string) => `file:${path}`,
          readStdin: async () => "stdin",
        };

        it("reads a file path argument (local e2e only)", async () => {
          expect(await loadJobText(["/job/job.json"], io)).toBe("file:/job/job.json");
        });

        it("reads stdin for '-' or when no argument is given", async () => {
          expect(await loadJobText(["-"], io)).toBe("stdin");
          expect(await loadJobText([], io)).toBe("stdin");
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/job.test.ts && bun run typecheck` - Expected: `Tests  6 passed (6)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/job.ts container/test/job.test.ts && git commit -m "feat(container): parse and validate the job input"`

---

### Task 5: Postgres connection helpers

**Files:**
- Create: `container/pg.ts`, `container/test/pg.test.ts`

**Interfaces:**
- Consumes: `JobError` (Task 4).
- Produces:
  ```ts
  export const PG_BIN_ROOT = "/usr/lib/postgresql";
  export const MIN_PG_MAJOR = 13;
  export const MAX_PG_MAJOR = 18;
  export interface PgConnection { host: string; port: number; user: string; password: string; database: string; sslmode?: string; connectTimeout?: string; applicationName?: string }
  export function parsePgUrl(value: string): PgConnection; // JobError("INVALID_JOB"), message never contains the URL
  export function pgEnv(connection: PgConnection): Record<string, string>; // PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE + optional PGSSLMODE PGCONNECT_TIMEOUT PGAPPNAME
  export function pgBinary(major: number, tool: "psql" | "pg_dump" | "pg_restore"): string;
  export interface ServerProbe { major: number; pgServerVersion: string; dbSizeBytes: number; hasReadAllData: boolean | null }
  export const PROBE_SQL: string;
  export function parseProbe(output: string): ServerProbe;
  export function assertSupportedMajor(major: number): void; // JobError("DUMP_FAILED") outside 13-18
  export function classifyConnectionFailure(stderr: string): "AUTH_FAILED" | "TUNNEL_FAILED" | null
  ```

**Gotcha:** `hasReadAllData` is `null` on PostgreSQL 13 because the role `pg_read_all_data` does not exist before PostgreSQL 14 (`to_regrole` returns null). The error text patterns in `classifyConnectionFailure` match libpq messages; the Docker run in Task 16 exercises the authentication one against a real server.

**Steps:**
- [ ] Step 1: Create `container/pg.ts`:
      ```ts
      import { JobError } from "./job";

      export const PG_BIN_ROOT = "/usr/lib/postgresql";
      export const MIN_PG_MAJOR = 13;
      export const MAX_PG_MAJOR = 18;

      export interface PgConnection {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
        sslmode?: string;
        connectTimeout?: string;
        applicationName?: string;
      }

      const PARAMS = { sslmode: "sslmode", connect_timeout: "connectTimeout", application_name: "applicationName" } as const;

      /** Parses postgres:// or postgresql:// URLs. Error messages never contain the URL. */
      export function parsePgUrl(value: string): PgConnection {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          throw new JobError("INVALID_JOB", "Invalid connection URL");
        }
        if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
          throw new JobError("INVALID_JOB", "Connection URL must start with postgres:// or postgresql://");
        }
        const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
        if (!url.hostname || !url.username || !database) {
          throw new JobError("INVALID_JOB", "Connection URL needs a host, a user, and a database name");
        }
        const connection: PgConnection = {
          host: url.hostname,
          port: url.port ? Number(url.port) : 5432,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
          database,
        };
        for (const [name, paramValue] of url.searchParams) {
          const field = PARAMS[name as keyof typeof PARAMS];
          if (!field) throw new JobError("INVALID_JOB", `Unsupported connection URL parameter: ${name}`);
          connection[field] = paramValue;
        }
        return connection;
      }

      /** libpq environment for a child process. Secrets travel in env, never in argv. */
      export function pgEnv(connection: PgConnection): Record<string, string> {
        const env: Record<string, string> = {
          PGHOST: connection.host,
          PGPORT: String(connection.port),
          PGUSER: connection.user,
          PGPASSWORD: connection.password,
          PGDATABASE: connection.database,
        };
        if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
        if (connection.connectTimeout) env.PGCONNECT_TIMEOUT = connection.connectTimeout;
        if (connection.applicationName) env.PGAPPNAME = connection.applicationName;
        return env;
      }

      export function pgBinary(major: number, tool: "psql" | "pg_dump" | "pg_restore"): string {
        return `${PG_BIN_ROOT}/${major}/bin/${tool}`;
      }

      export interface ServerProbe {
        major: number;
        pgServerVersion: string;
        dbSizeBytes: number;
        hasReadAllData: boolean | null;
      }

      export const PROBE_SQL =
        "select current_setting('server_version_num'), current_setting('server_version'), " +
        "pg_database_size(current_database()), " +
        "case when to_regrole('pg_read_all_data') is null then '' else pg_has_role(current_user, 'pg_read_all_data', 'member')::text end";

      /** Parses the one `|`-separated row printed by psql -At -F '|' for PROBE_SQL. */
      export function parseProbe(output: string): ServerProbe {
        const [versionNum, serverVersion, size, readAll] = output.trim().split("|");
        const num = Number(versionNum);
        const dbSizeBytes = Number(size);
        if (!Number.isInteger(num) || !serverVersion || !Number.isFinite(dbSizeBytes)) {
          throw new JobError("UNKNOWN", "Unexpected server version output");
        }
        return {
          major: Math.floor(num / 10000),
          pgServerVersion: serverVersion.split(" ")[0] ?? serverVersion,
          dbSizeBytes,
          hasReadAllData: readAll === "true" ? true : readAll === "false" ? false : null,
        };
      }

      export function assertSupportedMajor(major: number): void {
        if (major < MIN_PG_MAJOR || major > MAX_PG_MAJOR) {
          throw new JobError("DUMP_FAILED", `PostgreSQL ${major} is not supported (supported: ${MIN_PG_MAJOR}-${MAX_PG_MAJOR})`);
        }
      }

      const AUTH_PATTERN = /password authentication failed|authentication failed|no pg_hba\.conf entry|role ".*" does not exist|permission denied|\b(401|403)\b|forbidden|unauthori[sz]ed/i;

      /** Maps psql / pg_dump / pg_restore connection failures to an error code. */
      export function classifyConnectionFailure(stderr: string): "AUTH_FAILED" | "TUNNEL_FAILED" | null {
        if (AUTH_PATTERN.test(stderr)) return "AUTH_FAILED";
        // Every connection goes through the local cloudflared listener, so a connection problem is a tunnel problem.
        if (/could not (translate host name|connect to server)|connection refused|connection timed out|timeout expired|server closed the connection|connection reset|no route to host/i.test(stderr)) {
          return "TUNNEL_FAILED";
        }
        return null;
      }
      ```
- [ ] Step 2: Create `container/test/pg.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { JobError } from "../job";
      import { assertSupportedMajor, classifyConnectionFailure, parsePgUrl, parseProbe, pgBinary, pgEnv } from "../pg";

      describe("parsePgUrl", () => {
        it("decodes credentials and reads the supported query parameters", () => {
          const connection = parsePgUrl("postgresql://app%40corp:p%40ss%2Fw@db.internal:6543/my%20db?sslmode=require&connect_timeout=10&application_name=cellar");
          expect(connection).toEqual({
            host: "db.internal", port: 6543, user: "app@corp", password: "p@ss/w", database: "my db",
            sslmode: "require", connectTimeout: "10", applicationName: "cellar",
          });
        });

        it("defaults the port to 5432", () => {
          expect(parsePgUrl("postgres://u:p@h/d").port).toBe(5432);
        });

        it("maps to libpq env vars and omits unset options", () => {
          const env = pgEnv(parsePgUrl("postgres://u:p@h:5433/d?sslmode=disable"));
          expect(env).toEqual({ PGHOST: "h", PGPORT: "5433", PGUSER: "u", PGPASSWORD: "p", PGDATABASE: "d", PGSSLMODE: "disable" });
        });

        it("rejects bad URLs without echoing them", () => {
          for (const url of ["not a url", "mysql://u:p@h/d", "postgres://h/d", "postgres://u:hunter2@h/", "postgres://u:hunter2@h/d?options=-c%20x"]) {
            try {
              parsePgUrl(url);
              throw new Error("expected throw");
            } catch (error) {
              expect(error).toBeInstanceOf(JobError);
              expect((error as JobError).message).not.toContain("hunter2");
              expect((error as JobError).message).not.toContain(url);
            }
          }
        });
      });

      describe("server probe", () => {
        it("parses version, size, and the read-all role flag", () => {
          expect(parseProbe("140010|14.10 (Debian 14.10-1.pgdg120+1)|8388608|true\n")).toEqual({
            major: 14, pgServerVersion: "14.10", dbSizeBytes: 8388608, hasReadAllData: true,
          });
          expect(parseProbe("170002|17.2|1|false").hasReadAllData).toBe(false);
        });

        it("reports hasReadAllData null on PostgreSQL 13, where the role does not exist", () => {
          expect(parseProbe("130023|13.23|1024|")).toMatchObject({ major: 13, hasReadAllData: null });
        });

        it("rejects garbage output", () => {
          expect(() => parseProbe("psql: error")).toThrow(JobError);
        });

        it("selects the binary by major and enforces 13-18", () => {
          expect(pgBinary(16, "pg_dump")).toBe("/usr/lib/postgresql/16/bin/pg_dump");
          expect(() => assertSupportedMajor(12)).toThrow("not supported");
          expect(() => assertSupportedMajor(19)).toThrow("not supported");
          expect(() => assertSupportedMajor(13)).not.toThrow();
          expect(() => assertSupportedMajor(18)).not.toThrow();
        });
      });

      describe("classifyConnectionFailure", () => {
        it("separates auth failures from tunnel connection failures", () => {
          expect(classifyConnectionFailure('FATAL:  password authentication failed for user "app"')).toBe("AUTH_FAILED");
          expect(classifyConnectionFailure("connection to server at \"127.0.0.1\", port 15432 failed: server closed the connection unexpectedly")).toBe("TUNNEL_FAILED");
          expect(classifyConnectionFailure("connection to server at \"127.0.0.1\", port 15432 failed: Connection refused")).toBe("TUNNEL_FAILED");
          expect(classifyConnectionFailure("syntax error at or near")).toBeNull();
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/pg.test.ts && bun run typecheck` - Expected: `Tests  9 passed (9)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/pg.ts container/test/pg.test.ts && git commit -m "feat(container): add postgres url parsing, env mapping, version probe parsing"`

---

### Task 6: Secret scrubbing for the runner

**Files:**
- Create: `container/redact.ts`, `container/test/redact.test.ts`

**Interfaces:**
- Consumes: `redactSecrets`, `REDACTED` from `src/worker/lib/redact.ts` (Phase 1); `Job`, `parseJob` (Task 4); `parsePgUrl` (Task 5).
- Produces:
  ```ts
  export function createScrubber(secrets: string[]): (text: string) => string; // regex masks from Phase 1 plus exact-value masking (values shorter than 4 characters are ignored)
  export function jobSecrets(job: Job): string[]; // jobKey, db password (raw and URL-encoded), tunnel tokenId and tokenSecret, r2 accessKeyId and secretAccessKey
  ```

**Gotcha:** exact-value masking is the second line of defence after the URL regexes: tool output may echo a token that is not inside a URL. Values shorter than 4 characters are skipped so a weak password like `ab` cannot turn all text into `***`.

**Steps:**
- [ ] Step 1: Create `container/redact.ts`:
      ```ts
      import { REDACTED, redactSecrets } from "../src/worker/lib/redact";
      import type { Job } from "./job";
      import { parsePgUrl } from "./pg";

      const MIN_SECRET_LENGTH = 4;

      /** Returns a function that masks URL passwords, password pairs, and every exact secret value. */
      export function createScrubber(secrets: string[]): (text: string) => string {
        const exact = [...new Set(secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH))].sort(
          (a, b) => b.length - a.length,
        );
        return (text) => exact.reduce((out, secret) => out.split(secret).join(REDACTED), redactSecrets(text));
      }

      /** Every secret value carried by a job, including the URL-encoded form of the database password. */
      export function jobSecrets(job: Job): string[] {
        const secrets = [job.jobKey];
        try {
          const { password } = parsePgUrl(job.db.url);
          secrets.push(password, encodeURIComponent(password));
        } catch {
          // An unparsable URL fails later with its own error; the URL regex in redactSecrets still covers it.
        }
        secrets.push(job.tunnel.tokenId, job.tunnel.tokenSecret);
        if (job.r2) secrets.push(job.r2.accessKeyId, job.r2.secretAccessKey);
        return secrets;
      }
      ```
- [ ] Step 2: Create `container/test/redact.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { createScrubber, jobSecrets } from "../redact";
      import { parseJob } from "../job";

      describe("createScrubber", () => {
        it("masks exact secret values anywhere in the text", () => {
          const scrub = createScrubber(["tok-secret-value", "AKIA1234"]);
          expect(scrub("auth failed for tok-secret-value (key AKIA1234)")).toBe("auth failed for *** (key ***)");
        });

        it("still masks URL passwords", () => {
          expect(createScrubber([])("connect postgres://app:pw1234@db/shop failed")).toBe("connect postgres://app:***@db/shop failed");
        });

        it("ignores secrets shorter than 4 characters instead of mangling the text", () => {
          expect(createScrubber(["ab"])("table abstract")).toBe("table abstract");
        });

        it("masks the longer secret first when one contains the other", () => {
          expect(createScrubber(["pass", "pass-longer"])("x pass-longer y")).toBe("x *** y");
        });
      });

      describe("jobSecrets", () => {
        it("collects the key, db password in both forms, tunnel secrets, and r2 credentials", () => {
          const job = parseJob(JSON.stringify({
            jobId: "j", type: "backup", callbackUrl: "http://x/cb", jobKey: "a2V5a2V5", deadlineAt: "2026-10-24T04:00:00Z",
            db: { url: "postgres://app:p%40ss@db:5432/shop", name: "shop" },
            tunnel: { hostname: "h.example.com", tokenId: "tid-1234", tokenSecret: "tsecret-1", localPort: 15432 },
            r2: { endpoint: "http://s3", bucket: "b", accessKeyId: "akid-1", secretAccessKey: "sak-12345", key: "k", partSizeBytes: 5242880 },
          }));
          expect(jobSecrets(job)).toEqual(expect.arrayContaining(["a2V5a2V5", "p@ss", "p%40ss", "tid-1234", "tsecret-1", "akid-1", "sak-12345"]));
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/redact.test.ts && bun run typecheck` - Expected: `Tests  5 passed (5)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/redact.ts container/test/redact.test.ts && git commit -m "feat(container): scrub job secrets from tool output and errors"`

---

### Task 7: Child process helpers

**Files:**
- Create: `container/process.ts`, `container/test/process.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function childEnv(extra: Record<string, string>): Record<string, string>; // PATH HOME LANG SSL_CERT_FILE SSL_CERT_DIR from this process, plus extra; nothing else
  export interface ExitInfo { code: number | null; signal: NodeJS.Signals | null; spawnError?: Error }
  export interface Child { stdin: Writable; stdout: Readable; stderrTail(): string; exit: Promise<ExitInfo>; kill(): void }
  export interface StartOptions { env: Record<string, string>; signal?: AbortSignal; killGraceMs?: number }
  export function startChild(command: string, args: string[], options: StartOptions): Child; // abort: SIGTERM, then SIGKILL after killGraceMs (default 5000)
  export function runCapture(command: string, args: string[], options: StartOptions): Promise<{ exit: ExitInfo; stdout: string; stderr: string }>
  ```

**Gotcha:** the runner's own environment may hold unrelated secrets (the job itself arrives on stdin, never in env). `childEnv` is an allowlist so no child (`psql`, `pg_dump`, `cloudflared`) inherits it. `stderrTail()` is NOT redacted; callers scrub before logging or sending. In the test, the stderr child sets `process.exitCode` instead of calling `process.exit`, because `process.exit` can truncate piped output on macOS.

**Steps:**
- [ ] Step 1: Create `container/process.ts`:
      ```ts
      import { spawn } from "node:child_process";
      import type { Readable, Writable } from "node:stream";

      const STDERR_TAIL_BYTES = 4096;
      const INHERITED_ENV = ["PATH", "HOME", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR"];

      /** Child processes get an explicit environment, never the runner's own (it may hold the job JSON). */
      export function childEnv(extra: Record<string, string>): Record<string, string> {
        const env: Record<string, string> = {};
        for (const name of INHERITED_ENV) {
          const value = process.env[name];
          if (value !== undefined) env[name] = value;
        }
        return { ...env, ...extra };
      }

      export interface ExitInfo {
        code: number | null;
        signal: NodeJS.Signals | null;
        spawnError?: Error;
      }

      export interface Child {
        stdin: Writable;
        stdout: Readable;
        /** The last few KiB of stderr. Unredacted: callers must scrub before logging or sending. */
        stderrTail(): string;
        /** Resolves after the process exited and its stdio closed. Never rejects. */
        exit: Promise<ExitInfo>;
        kill(): void;
      }

      export interface StartOptions {
        env: Record<string, string>;
        signal?: AbortSignal;
        killGraceMs?: number;
      }

      /** Starts a process. On abort it sends SIGTERM, then SIGKILL after the grace period. */
      export function startChild(command: string, args: string[], options: StartOptions): Child {
        const child = spawn(command, args, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
        let tail = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
          tail = (tail + chunk).slice(-STDERR_TAIL_BYTES);
        });
        // A process that exits early closes stdin; writers see EPIPE through the exit code instead.
        child.stdin.on("error", () => {});

        const exit = new Promise<ExitInfo>((resolve) => {
          child.once("error", (spawnError) => resolve({ code: null, signal: null, spawnError }));
          child.once("close", (code, signal) => resolve({ code, signal }));
        });

        const kill = () => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), options.killGraceMs ?? 5000).unref();
        };
        if (options.signal?.aborted) kill();
        else options.signal?.addEventListener("abort", kill, { once: true });

        return { stdin: child.stdin, stdout: child.stdout, stderrTail: () => tail, exit, kill };
      }

      /** Runs a short process to completion and returns its stdout (capped) and stderr tail. */
      export async function runCapture(command: string, args: string[], options: StartOptions) {
        const child = startChild(command, args, options);
        child.stdin.end();
        let stdout = "";
        child.stdout.setEncoding("utf8");
        for await (const chunk of child.stdout) {
          if (stdout.length < 65536) stdout += chunk;
        }
        const exit = await child.exit;
        return { exit, stdout, stderr: child.stderrTail() };
      }
      ```
- [ ] Step 2: Create `container/test/process.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest";
      import { childEnv, runCapture, startChild } from "../process";

      const node = process.execPath;

      describe("process helpers", () => {
        it("passes only the explicit environment to children", async () => {
          process.env.CELLAR_SECRET_PROBE = "super-secret-value";
          const env = childEnv({ PGPASSWORD: "pw" });
          const result = await runCapture(node, ["-e", "console.log(JSON.stringify([process.env.CELLAR_SECRET_PROBE ?? null, process.env.PGPASSWORD ?? null]))"], { env });
          delete process.env.CELLAR_SECRET_PROBE;
          expect(JSON.parse(result.stdout)).toEqual([null, "pw"]);
        });

        it("reports exit code and keeps only a bounded stderr tail", async () => {
          const result = await runCapture(node, ["-e", "process.stderr.write('x'.repeat(100000) + 'END'); process.exitCode = 3"], { env: childEnv({}) });
          expect(result.exit.code).toBe(3);
          expect(result.stderr.length).toBe(4096);
          expect(result.stderr.endsWith("END")).toBe(true);
        });

        it("reports a missing binary as a spawn error instead of throwing", async () => {
          const child = startChild("/nonexistent/binary", [], { env: {} });
          const exit = await child.exit;
          expect(exit.spawnError?.message).toContain("ENOENT");
        });

        it("terminates a running child on abort", async () => {
          const controller = new AbortController();
          const child = startChild(node, ["-e", "setInterval(() => {}, 1000)"], { env: childEnv({}), signal: controller.signal });
          controller.abort();
          expect((await child.exit).signal).toBe("SIGTERM");
        });

        it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
          const controller = new AbortController();
          const child = startChild(node, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], {
            env: childEnv({}),
            signal: controller.signal,
            killGraceMs: 100,
          });
          await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
          controller.abort();
          expect((await child.exit).signal).toBe("SIGKILL");
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/process.test.ts && bun run typecheck` - Expected: `Tests  5 passed (5)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/process.ts container/test/process.test.ts && git commit -m "feat(container): add child process helpers with env allowlist and kill escalation"`

---

### Task 8: S3 client: SigV4 signing and multipart upload

**Files:**
- Create: `container/s3.ts`, `container/test/helpers/fake-s3.ts`, `container/test/s3.test.ts`

**Interfaces:**
- Consumes: nothing (WebCrypto, `fetch`, `node:crypto`).
- Produces:
  ```ts
  export interface S3Config { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string }
  export class S3Error extends Error { constructor(status: number, code: string, message: string); readonly status: number; readonly code: string }
  export interface SignInput { method: string; url: URL; headers?: Record<string, string>; payloadSha256: string; region: string; accessKeyId: string; secretAccessKey: string; now: Date }
  export function signRequest(input: SignInput): Promise<Record<string, string>>;
  export interface CompletedPart { partNumber: number; etag: string }
  export class S3Client {
    constructor(config: S3Config, sleep?: (ms: number) => Promise<void>);
    send(input: { method: string; key?: string; query?: Record<string, string>; body?: Uint8Array<ArrayBuffer>; signal?: AbortSignal }): Promise<Response>; // key omitted = the bucket itself
    createMultipart(key: string, signal?: AbortSignal): Promise<string>;
    uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<CompletedPart>;
    completeMultipart(key: string, uploadId: string, parts: CompletedPart[], signal?: AbortSignal): Promise<void>;
    abortMultipart(key: string, uploadId: string): Promise<void>;
    getObject(key: string, signal?: AbortSignal): Promise<Response>;
  }
  ```

**Gotcha:**
- Path-style URLs (`{endpoint}/{bucket}/{key}`), which R2 and S3-compatible stand-ins accept. Each key segment is RFC 3986 encoded, so `:` in the ISO timestamp key becomes `%3A`.
- Every request signs the SHA-256 of its body (`x-amz-content-sha256`), so no `UNSIGNED-PAYLOAD` assumption is made about R2 or the stand-in.
- Retries: create, upload part, and complete retry on network errors, 429, and 5xx (waits 0.5 s then 2 s, three tries). 4xx errors do not retry. A 200 response with an `<Error>` body to `CompleteMultipartUpload` is a failure (S3 can do this).
- `abortMultipart` takes no signal on purpose: it must still work after the job deadline aborted everything else.
- Vectors: the two signatures in the test are the AWS documentation examples for GET Object with `Range` and GET Bucket with a query; the credentials are AWS's public example values.

**Steps:**
- [ ] Step 1: Create `container/s3.ts`:
      ```ts
      import { createHash } from "node:crypto";

      export interface S3Config {
        endpoint: string;
        bucket: string;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
      }

      export class S3Error extends Error {
        constructor(
          readonly status: number,
          readonly code: string,
          message: string,
        ) {
          super(message);
          this.name = "S3Error";
        }
      }

      const encoder = new TextEncoder();
      const EMPTY_SHA256 = createHash("sha256").digest("hex");

      function hex(bytes: ArrayBuffer): string {
        return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
      }

      async function hmac(key: Uint8Array<ArrayBuffer> | string, data: string): Promise<Uint8Array<ArrayBuffer>> {
        const raw = typeof key === "string" ? encoder.encode(key) : key;
        const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
      }

      /** RFC 3986 percent-encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
      function encodeRfc3986(value: string): string {
        return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      }

      export interface SignInput {
        method: string;
        url: URL;
        headers?: Record<string, string>;
        payloadSha256: string;
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        now: Date;
      }

      /** Returns the request headers to send, including host, x-amz-date, x-amz-content-sha256 and Authorization. */
      export async function signRequest(input: SignInput): Promise<Record<string, string>> {
        const amzDate = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
        const dateStamp = amzDate.slice(0, 8);
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value.trim();
        headers.host = input.url.host;
        headers["x-amz-date"] = amzDate;
        headers["x-amz-content-sha256"] = input.payloadSha256;

        const names = Object.keys(headers).sort();
        const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
        const signedHeaders = names.join(";");
        const canonicalQuery = [...input.url.searchParams]
          .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
          .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
          .map(([key, value]) => `${key}=${value}`)
          .join("&");
        const canonicalRequest = [input.method, input.url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, input.payloadSha256].join("\n");

        const scope = `${dateStamp}/${input.region}/s3/aws4_request`;
        const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");
        const kDate = await hmac(`AWS4${input.secretAccessKey}`, dateStamp);
        const kRegion = await hmac(kDate, input.region);
        const kService = await hmac(kRegion, "s3");
        const kSigning = await hmac(kService, "aws4_request");
        const signature = hex((await hmac(kSigning, stringToSign)).buffer);

        headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
        return headers;
      }

      export interface CompletedPart {
        partNumber: number;
        etag: string;
      }

      interface SendInput {
        method: string;
        key?: string;
        query?: Record<string, string>;
        body?: Uint8Array<ArrayBuffer>;
        signal?: AbortSignal;
      }

      const RETRY_DELAYS_MS = [500, 2000];

      function isRetryable(error: unknown): boolean {
        if (error instanceof S3Error) return error.status === 429 || error.status >= 500;
        return !(error instanceof DOMException && error.name === "AbortError");
      }

      /** Minimal path-style S3 client for R2 and S3-compatible stand-ins: multipart upload and streaming GET. */
      export class S3Client {
        constructor(
          private readonly config: S3Config,
          private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        ) {}

        private objectUrl(key?: string, query: Record<string, string> = {}): URL {
          const base = this.config.endpoint.replace(/\/+$/, "");
          const path = key === undefined ? "" : `/${key.split("/").map(encodeRfc3986).join("/")}`;
          const url = new URL(`${base}/${encodeRfc3986(this.config.bucket)}${path}`);
          for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
          return url;
        }

        /** One signed request. Non-2xx responses and 200 responses carrying an <Error> body throw S3Error. */
        async send(input: SendInput): Promise<Response> {
          const url = this.objectUrl(input.key, input.query);
          const payloadSha256 = input.body ? createHash("sha256").update(input.body).digest("hex") : EMPTY_SHA256;
          const headers = await signRequest({
            method: input.method,
            url,
            payloadSha256,
            region: this.config.region,
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
            now: new Date(),
          });
          const response = await fetch(url, { method: input.method, headers, body: input.body, signal: input.signal });
          if (!response.ok) throw await toS3Error(response);
          return response;
        }

        private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
          for (let attempt = 0; ; attempt++) {
            try {
              return await operation();
            } catch (error) {
              const delay = RETRY_DELAYS_MS[attempt];
              if (delay === undefined || !isRetryable(error)) throw error;
              await this.sleep(delay);
            }
          }
        }

        async createMultipart(key: string, signal?: AbortSignal): Promise<string> {
          return this.withRetry(async () => {
            const text = await (await this.send({ method: "POST", key, query: { uploads: "" }, signal })).text();
            const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(text)?.[1];
            if (!uploadId) throw new S3Error(200, "InvalidResponse", "CreateMultipartUpload returned no UploadId");
            return uploadId;
          });
        }

        async uploadPart(key: string, uploadId: string, partNumber: number, body: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<CompletedPart> {
          return this.withRetry(async () => {
            const response = await this.send({ method: "PUT", key, query: { partNumber: String(partNumber), uploadId }, body, signal });
            const etag = response.headers.get("etag");
            if (!etag) throw new S3Error(200, "InvalidResponse", `UploadPart ${partNumber} returned no ETag`);
            return { partNumber, etag };
          });
        }

        async completeMultipart(key: string, uploadId: string, parts: CompletedPart[], signal?: AbortSignal): Promise<void> {
          const xml =
            "<CompleteMultipartUpload>" +
            parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`).join("") +
            "</CompleteMultipartUpload>";
          await this.withRetry(async () => {
            const text = await (await this.send({ method: "POST", key, query: { uploadId }, body: encoder.encode(xml), signal })).text();
            if (/<Error>/.test(text)) throw new S3Error(200, errorCode(text), "CompleteMultipartUpload failed");
          });
        }

        /** Best effort: callers pass no signal so an aborted job can still clean up. */
        async abortMultipart(key: string, uploadId: string): Promise<void> {
          await this.send({ method: "DELETE", key, query: { uploadId } });
        }

        async getObject(key: string, signal?: AbortSignal): Promise<Response> {
          return this.send({ method: "GET", key, signal });
        }
      }

      function errorCode(text: string): string {
        return /<Code>([^<]*)<\/Code>/.exec(text)?.[1] ?? "Unknown";
      }

      async function toS3Error(response: Response): Promise<S3Error> {
        const text = await response.text().catch(() => "");
        const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1] ?? response.statusText;
        return new S3Error(response.status, errorCode(text), `S3 ${response.status} ${errorCode(text)}: ${message}`);
      }
      ```
- [ ] Step 2: Create `container/test/helpers/fake-s3.ts` (in-memory multipart endpoint; the helper is not a test file, so Vitest does not collect it):
      ```ts
      import { createServer, type IncomingMessage, type Server } from "node:http";
      import type { AddressInfo } from "node:net";

      export interface RecordedRequest {
        method: string;
        path: string;
        query: URLSearchParams;
        headers: IncomingMessage["headers"];
        bodyBytes: number;
        body: Buffer;
      }

      export interface FakeS3 {
        endpoint: string;
        requests: RecordedRequest[];
        /** Return an HTTP status (error XML body) or "ok-with-error" (200 with an error XML body) to override a request. */
        failWith: (match: (request: RecordedRequest) => number | "ok-with-error" | null) => void;
        close: () => Promise<void>;
      }

      /** In-memory S3 multipart endpoint. Keeps part bodies so tests can reassemble the object. */
      export async function startFakeS3(): Promise<FakeS3> {
        const requests: RecordedRequest[] = [];
        const parts = new Map<string, Buffer>();
        let override: (request: RecordedRequest) => number | "ok-with-error" | null = () => null;
        let uploads = 0;

        const server: Server = createServer((req, res) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk: Buffer) => chunks.push(chunk));
          req.on("end", () => {
            const url = new URL(req.url ?? "/", "http://localhost");
            const body = Buffer.concat(chunks);
            const request: RecordedRequest = { method: req.method ?? "", path: url.pathname, query: url.searchParams, headers: req.headers, bodyBytes: body.length, body };
            requests.push(request);
            const status = override(request);
            if (status !== null) {
              res.writeHead(status === "ok-with-error" ? 200 : status, { "content-type": "application/xml" });
              res.end(`<Error><Code>Injected${status === "ok-with-error" ? "Error" : status}</Code><Message>injected failure</Message></Error>`);
              return;
            }
            if (req.method === "POST" && url.searchParams.has("uploads")) {
              res.end(`<InitiateMultipartUploadResult><UploadId>upload-${++uploads}</UploadId></InitiateMultipartUploadResult>`);
            } else if (req.method === "PUT" && url.searchParams.has("partNumber")) {
              parts.set(`${url.searchParams.get("uploadId")}#${url.searchParams.get("partNumber")}`, body);
              res.writeHead(200, { etag: `"etag-${url.searchParams.get("partNumber")}"` });
              res.end();
            } else if (req.method === "POST" && url.searchParams.has("uploadId")) {
              res.end("<CompleteMultipartUploadResult><ETag>\"final\"</ETag></CompleteMultipartUploadResult>");
            } else if (req.method === "DELETE") {
              res.writeHead(204);
              res.end();
            } else if (req.method === "GET") {
              res.writeHead(200, { "content-type": "application/octet-stream" });
              res.end(Buffer.from("object-bytes"));
            } else {
              res.writeHead(400);
              res.end();
            }
          });
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as AddressInfo;
        return {
          endpoint: `http://127.0.0.1:${port}`,
          requests,
          failWith: (match) => {
            override = match;
          },
          close: () => new Promise<void>((resolve) => server.close(() => resolve())),
        };
      }
      ```
- [ ] Step 3: Create `container/test/s3.test.ts`:
      ```ts
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { S3Client, S3Error, signRequest } from "../s3";
      import { startFakeS3, type FakeS3 } from "./helpers/fake-s3";

      // AWS documentation example credentials (public test vectors, not secrets).
      const vector = { region: "us-east-1", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") };
      const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      describe("signRequest (AWS SigV4 for S3 test vectors)", () => {
        it("signs GET Object with a Range header", async () => {
          const headers = await signRequest({ ...vector, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"), headers: { Range: "bytes=0-9" }, payloadSha256: EMPTY });
          expect(headers.authorization).toBe(
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
          );
        });

        it("signs GET Bucket (List Objects) with sorted query parameters", async () => {
          const headers = await signRequest({ ...vector, method: "GET", url: new URL("https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2"), payloadSha256: EMPTY });
          expect(headers.authorization).toContain("Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
        });
      });

      describe("S3Client multipart", () => {
        let s3: FakeS3;
        let client: S3Client;
        const noSleep = async () => {};

        beforeEach(async () => {
          s3 = await startFakeS3();
          client = new S3Client({ endpoint: s3.endpoint, bucket: "cellar", region: "auto", accessKeyId: "AKIATEST", secretAccessKey: "secret-key" }, noSleep);
        });
        afterEach(() => s3.close());

        it("creates, uploads, and completes with ordered parts and the part payload hash", async () => {
          const key = "backups/t1/2026/10/24/2026-10-24T02:00:00.000Z_shop.dump";
          const uploadId = await client.createMultipart(key);
          const part = await client.uploadPart(key, uploadId, 1, new Uint8Array(1024).fill(1));
          await client.completeMultipart(key, uploadId, [part]);

          const [create, put, complete] = s3.requests;
          expect(create?.path).toBe("/cellar/backups/t1/2026/10/24/2026-10-24T02%3A00%3A00.000Z_shop.dump");
          expect(create?.query.has("uploads")).toBe(true);
          expect(put?.query.get("partNumber")).toBe("1");
          expect(put?.bodyBytes).toBe(1024);
          expect(put?.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
          expect(put?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/auto\/s3\/aws4_request/);
          expect(complete?.body.toString()).toBe('<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"etag-1"</ETag></Part></CompleteMultipartUpload>');
        });

        it("retries a 503 on a part and then succeeds", async () => {
          const uploadId = await client.createMultipart("k");
          let failures = 1;
          s3.failWith((request) => (request.method === "PUT" && failures-- > 0 ? 503 : null));
          await expect(client.uploadPart("k", uploadId, 1, new Uint8Array(8))).resolves.toEqual({ partNumber: 1, etag: '"etag-1"' });
          expect(s3.requests.filter((request) => request.method === "PUT")).toHaveLength(2);
        });

        it("does not retry a 403 and surfaces the S3 error code without secrets", async () => {
          s3.failWith(() => 403);
          const error = await client.createMultipart("k").catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(S3Error);
          expect((error as S3Error).status).toBe(403);
          expect((error as S3Error).message).not.toContain("secret-key");
          expect(s3.requests).toHaveLength(1);
        });

        it("gives up after three attempts on persistent 500s", async () => {
          s3.failWith(() => 500);
          await expect(client.createMultipart("k")).rejects.toBeInstanceOf(S3Error);
          expect(s3.requests).toHaveLength(3);
        });

        it("treats a 200 response with an <Error> body on Complete as a failure", async () => {
          const uploadId = await client.createMultipart("k");
          s3.failWith((request) => (request.method === "POST" && request.query.has("uploadId") ? "ok-with-error" : null));
          await expect(client.completeMultipart("k", uploadId, [{ partNumber: 1, etag: '"e"' }])).rejects.toMatchObject({ code: "InjectedError" });
        });

        it("aborts with DELETE ?uploadId and streams GET objects", async () => {
          await client.abortMultipart("k", "upload-9");
          expect(s3.requests[0]).toMatchObject({ method: "DELETE" });
          expect(s3.requests[0]?.query.get("uploadId")).toBe("upload-9");
          expect(await (await client.getObject("k")).text()).toBe("object-bytes");
        });
      });
      ```
- [ ] Step 4: Verify - Run: `bunx vitest run container/test/s3.test.ts && bun run typecheck` - Expected: `Tests  8 passed (8)`; typecheck exits 0
- [ ] Step 5: Commit - `git add container/s3.ts container/test/helpers/fake-s3.ts container/test/s3.test.ts && git commit -m "feat(container): add SigV4 s3 client with multipart upload, abort, and streaming get"`

---

### Task 9: Streaming multipart uploader and part sizing

**Files:**
- Create: `container/upload.ts`, `container/test/upload.test.ts`

**Interfaces:**
- Consumes: `S3Client`, `CompletedPart` (Task 8); `JobError` (Task 4); `startFakeS3` helper (Task 8).
- Produces:
  ```ts
  export const MIN_PART_BYTES: number; // 5 MiB
  export const MAX_PART_BYTES: number; // 128 MiB
  export function choosePartSize(requestedBytes: number, dbSizeBytes: number): number; // JobError("UPLOAD_FAILED") when the size would exceed MAX_PART_BYTES
  export interface UploadResult { sizeBytes: number; sha256: string; partCount: number }
  export interface UploadOptions { signal?: AbortSignal; beforeComplete?: () => Promise<void> }
  export function uploadStream(source: AsyncIterable<Uint8Array>, s3: S3Client, key: string, partSize: number, options?: UploadOptions): Promise<UploadResult>
  ```

**Gotcha:**
- Memory: one part buffer (`new Uint8Array(partSize)`), one request in flight. `fetch` copies the part body, so real peak is about 2x the part size plus the runtime. This is why owner answer 12 set 32 MiB parts for the 256 MB limit. Do not "fix" it by sending several parts at once.
- `beforeComplete` runs after the source ends and before the last part is sent. The backup job uses it to wait for `pg_dump`'s exit code, so a failed dump aborts the upload instead of completing a truncated object.
- The test "splits into equal parts" feeds 10 MiB through a 4 MiB part size. It takes about 1 s.

**Steps:**
- [ ] Step 1: Create `container/upload.ts`:
      ```ts
      import { createHash } from "node:crypto";
      import { JobError } from "./job";
      import type { CompletedPart, S3Client } from "./s3";

      const MiB = 1024 * 1024;
      export const MIN_PART_BYTES = 5 * MiB;
      export const MAX_PART_BYTES = 128 * MiB;
      const MAX_PARTS = 10_000;

      /**
       * Part size for a database of the given size. The request (32 MiB by default) wins unless the
       * dump could need more than ~9,500 parts. The 1.25 factor covers a dump bigger than the database.
       */
      export function choosePartSize(requestedBytes: number, dbSizeBytes: number): number {
        const needed = Math.ceil((dbSizeBytes * 1.25) / (MAX_PARTS * 0.95) / MiB) * MiB;
        const size = Math.max(requestedBytes, MIN_PART_BYTES, needed);
        if (size > MAX_PART_BYTES) {
          throw new JobError("UPLOAD_FAILED", "Database is too large: the part size would exceed 128 MiB (about 1.2 TiB at 10,000 parts), the most the container memory can buffer");
        }
        return size;
      }

      export interface UploadResult {
        sizeBytes: number;
        sha256: string;
        partCount: number;
      }

      export interface UploadOptions {
        signal?: AbortSignal;
        /** Awaited after the source ends and before the last part is sent. Throw to abort the upload. */
        beforeComplete?: () => Promise<void>;
      }

      /**
       * Streams `source` to S3 as a multipart upload with one part buffer and one request in flight.
       * Peak memory is about one part. A failure at any point aborts the multipart upload.
       */
      export async function uploadStream(
        source: AsyncIterable<Uint8Array>,
        s3: S3Client,
        key: string,
        partSize: number,
        options: UploadOptions = {},
      ): Promise<UploadResult> {
        const hash = createHash("sha256");
        const parts: CompletedPart[] = [];
        const buffer = new Uint8Array(partSize);
        let filled = 0;
        let total = 0;
        const uploadId = await s3.createMultipart(key, options.signal);

        const sendPart = async () => {
          parts.push(await s3.uploadPart(key, uploadId, parts.length + 1, buffer.subarray(0, filled), options.signal));
          filled = 0;
        };

        try {
          for await (const chunk of source) {
            hash.update(chunk);
            total += chunk.length;
            for (let offset = 0; offset < chunk.length; ) {
              const take = Math.min(partSize - filled, chunk.length - offset);
              buffer.set(chunk.subarray(offset, offset + take), filled);
              filled += take;
              offset += take;
              if (filled === partSize) await sendPart();
            }
          }
          await options.beforeComplete?.();
          if (total === 0) throw new JobError("DUMP_FAILED", "The dump produced no data");
          if (filled > 0) await sendPart();
          await s3.completeMultipart(key, uploadId, parts, options.signal);
        } catch (error) {
          // Best effort. R2 also aborts incomplete uploads after 7 days by default.
          await s3.abortMultipart(key, uploadId).catch(() => undefined);
          throw error;
        }
        return { sizeBytes: total, sha256: hash.digest("hex"), partCount: parts.length };
      }
      ```
- [ ] Step 2: Create `container/test/upload.test.ts`:
      ```ts
      import { createHash } from "node:crypto";
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { JobError } from "../job";
      import { S3Client } from "../s3";
      import { choosePartSize, MAX_PART_BYTES, MIN_PART_BYTES, uploadStream } from "../upload";
      import { startFakeS3, type FakeS3 } from "./helpers/fake-s3";

      const MiB = 1024 * 1024;

      async function* chunks(totalBytes: number, chunkBytes: number): AsyncGenerator<Uint8Array> {
        let sent = 0;
        while (sent < totalBytes) {
          const size = Math.min(chunkBytes, totalBytes - sent);
          yield Uint8Array.from({ length: size }, (_, i) => (sent + i) % 251);
          sent += size;
        }
      }

      describe("choosePartSize", () => {
        it("keeps the requested 32 MiB for databases up to about 237 GiB", () => {
          expect(choosePartSize(32 * MiB, 0)).toBe(32 * MiB);
          expect(choosePartSize(32 * MiB, 1024 ** 3)).toBe(32 * MiB);
          expect(choosePartSize(32 * MiB, 200 * 1024 ** 3)).toBe(32 * MiB);
        });

        it("grows the part size so the dump needs fewer than 10,000 parts", () => {
          const size = choosePartSize(32 * MiB, 800 * 1024 ** 3);
          expect(size).toBeGreaterThan(32 * MiB);
          expect(size % MiB).toBe(0);
          expect(Math.ceil((800 * 1024 ** 3 * 1.25) / size)).toBeLessThan(10_000);
        });

        it("never goes below the S3 minimum, and refuses sizes the container cannot buffer", () => {
          expect(choosePartSize(1, 0)).toBe(MIN_PART_BYTES);
          expect(() => choosePartSize(32 * MiB, 5 * 1024 ** 4)).toThrow(JobError);
          expect(MAX_PART_BYTES).toBe(128 * MiB);
        });
      });

      describe("uploadStream", () => {
        let s3: FakeS3;
        let client: S3Client;

        beforeEach(async () => {
          s3 = await startFakeS3();
          client = new S3Client({ endpoint: s3.endpoint, bucket: "cellar", region: "auto", accessKeyId: "AKIATEST", secretAccessKey: "secret-key" }, async () => {});
        });
        afterEach(() => s3.close());

        const puts = () => s3.requests.filter((request) => request.method === "PUT");

        it("splits into equal parts, reports size, sha256 and part count, and uploads sequentially", async () => {
          const total = 10 * MiB + 123;
          const result = await uploadStream(chunks(total, 300_000), client, "k", 4 * MiB);
          const expected = createHash("sha256");
          for await (const chunk of chunks(total, 300_000)) expected.update(chunk);

          expect(result).toEqual({ sizeBytes: total, sha256: expected.digest("hex"), partCount: 3 });
          expect(puts().map((request) => request.bodyBytes)).toEqual([4 * MiB, 4 * MiB, 2 * MiB + 123]);
          expect(s3.requests.map((request) => request.method)).toEqual(["POST", "PUT", "PUT", "PUT", "POST"]);
        });

        it("handles a source whose chunks are larger than a part and an exact multiple of the part size", async () => {
          const result = await uploadStream(chunks(8 * MiB, 6 * MiB), client, "k", 4 * MiB);
          expect(result.partCount).toBe(2);
          expect(puts().map((request) => request.bodyBytes)).toEqual([4 * MiB, 4 * MiB]);
        });

        it("aborts and never completes when the source fails midway", async () => {
          async function* failing() {
            yield new Uint8Array(5 * MiB);
            throw new Error("pipe broke");
          }
          await expect(uploadStream(failing(), client, "k", 4 * MiB)).rejects.toThrow("pipe broke");
          const methods = s3.requests.map((request) => request.method);
          expect(methods).toContain("DELETE");
          expect(s3.requests.some((request) => request.method === "POST" && request.query.has("uploadId"))).toBe(false);
        });

        it("aborts when beforeComplete throws, before the last part is sent", async () => {
          const failure = new JobError("DUMP_FAILED", "pg_dump exited with code 1");
          await expect(
            uploadStream(chunks(5 * MiB, MiB), client, "k", 4 * MiB, { beforeComplete: async () => { throw failure; } }),
          ).rejects.toBe(failure);
          expect(puts()).toHaveLength(1);
          expect(s3.requests.at(-1)?.method).toBe("DELETE");
        });

        it("aborts an empty dump", async () => {
          await expect(uploadStream(chunks(0, 1), client, "k", 4 * MiB)).rejects.toThrow("no data");
          expect(s3.requests.at(-1)?.method).toBe("DELETE");
        });

        it("aborts when a part upload fails permanently and keeps the original error", async () => {
          s3.failWith((request) => (request.method === "PUT" ? 403 : null));
          await expect(uploadStream(chunks(5 * MiB, MiB), client, "k", 4 * MiB)).rejects.toMatchObject({ status: 403 });
          expect(s3.requests.at(-1)?.method).toBe("DELETE");
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/upload.test.ts && bun run typecheck` - Expected: `Tests  9 passed (9)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/upload.ts container/test/upload.test.ts && git commit -m "feat(container): stream a dump to multipart upload with sha256 and abort on failure"`

---

### Task 10: Tunnel: cloudflared process and readiness wait

**Files:**
- Create: `container/tunnel.ts`, `container/test/tunnel.test.ts`

**Interfaces:**
- Consumes: `JobError`, `TunnelInput` (Task 4); `classifyConnectionFailure` (Task 5); `startChild`, `childEnv`, `Child`, `StartOptions` (Task 7); `createScrubber` (Task 6, test only).
- Produces:
  ```ts
  export interface Tunnel { stop(): Promise<void> }
  export interface TunnelOptions { signal?: AbortSignal; readyTimeoutMs?: number; scrub: (text: string) => string; start?: (command: string, args: string[], options: StartOptions) => Child }
  export function waitForPort(port: number, options: { host?: string; timeoutMs: number; intervalMs?: number; failFast?: () => Error | null }): Promise<void>;
  export function startTunnel(input: TunnelInput, options: TunnelOptions): Promise<Tunnel> // throws JobError("TUNNEL_FAILED" | "AUTH_FAILED")
  ```

**Gotcha:**
- Readiness is "the local port accepts TCP". `cloudflared access tcp` listens locally before it authenticates to the edge, so a refused token shows up when the first Postgres connection is made, not here. The Postgres tools then fail with a connection error, which `classifyConnectionFailure` maps to `TUNNEL_FAILED` in tunnel mode. [uncertain] the exact `cloudflared` log text for a refused token; the pattern list in `pg.ts` (`401`, `403`, `forbidden`, `unauthorized`) comes from common wording. Task 2 shows the real text; if it differs, add the real phrase to `AUTH_PATTERN` in `pg.ts` and one assertion in `pg.test.ts` in the same commit.
- The tests replace `cloudflared` with `node -e` scripts through the `start` option, and assert the token is only in `options.env`.

**Steps:**
- [ ] Step 1: Create `container/tunnel.ts`:
      ```ts
      import net from "node:net";
      import { JobError, type TunnelInput } from "./job";
      import { classifyConnectionFailure } from "./pg";
      import { childEnv, startChild, type Child, type StartOptions } from "./process";

      export interface Tunnel {
        stop(): Promise<void>;
      }

      export interface TunnelOptions {
        signal?: AbortSignal;
        readyTimeoutMs?: number;
        scrub: (text: string) => string;
        /** Replaceable in tests. */
        start?: (command: string, args: string[], options: StartOptions) => Child;
      }

      interface WaitOptions {
        host?: string;
        timeoutMs: number;
        intervalMs?: number;
        /** Return an error to stop waiting early, for example when the tunnel process already exited. */
        failFast?: () => Error | null;
      }

      function canConnect(host: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
          const socket = net.connect({ host, port });
          socket.once("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.once("error", () => {
            socket.destroy();
            resolve(false);
          });
        });
      }

      /** Resolves when something accepts TCP connections on host:port; rejects on timeout or failFast. */
      export async function waitForPort(port: number, options: WaitOptions): Promise<void> {
        const host = options.host ?? "127.0.0.1";
        const deadline = Date.now() + options.timeoutMs;
        for (;;) {
          const early = options.failFast?.();
          if (early) throw early;
          if (await canConnect(host, port)) return;
          if (Date.now() >= deadline) throw new Error(`port ${port} did not open within ${options.timeoutMs} ms`);
          await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 200));
        }
      }

      /**
       * Starts `cloudflared access tcp` for the job. The service token goes in the environment
       * (TUNNEL_SERVICE_TOKEN_ID / TUNNEL_SERVICE_TOKEN_SECRET), never in argv.
       */
      export async function startTunnel(input: TunnelInput, options: TunnelOptions): Promise<Tunnel> {
        const start = options.start ?? startChild;
        const child = start("cloudflared", ["access", "tcp", "--hostname", input.hostname, "--url", `127.0.0.1:${input.localPort}`, "--loglevel", "info"], {
          env: childEnv({ TUNNEL_SERVICE_TOKEN_ID: input.tokenId, TUNNEL_SERVICE_TOKEN_SECRET: input.tokenSecret }),
          signal: options.signal,
        });
        let exited: string | null = null;
        void child.exit.then((exit) => {
          exited = exit.spawnError ? `could not start cloudflared (${exit.spawnError.message})` : `cloudflared exited with code ${exit.code ?? exit.signal}`;
        });

        const stop = async () => {
          child.kill();
          await child.exit;
        };

        try {
          await waitForPort(input.localPort, {
            timeoutMs: options.readyTimeoutMs ?? 30_000,
            failFast: () => (exited ? new Error(exited) : null),
          });
        } catch (error) {
          await stop();
          const tail = options.scrub(child.stderrTail());
          const auth = classifyConnectionFailure(tail) === "AUTH_FAILED";
          const reason = error instanceof Error ? error.message : "unknown";
          throw new JobError(auth ? "AUTH_FAILED" : "TUNNEL_FAILED", `Tunnel failed: ${reason}. ${tail.slice(-600)}`.trim());
        }
        return { stop };
      }
      ```
- [ ] Step 2: Create `container/test/tunnel.test.ts`:
      ```ts
      import { createServer } from "node:net";
      import { describe, expect, it } from "vitest";
      import { JobError } from "../job";
      import { childEnv, startChild, type StartOptions } from "../process";
      import { createScrubber } from "../redact";
      import { startTunnel, waitForPort } from "../tunnel";

      async function freePort(): Promise<number> {
        const server = createServer();
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address() as { port: number };
        await new Promise<void>((resolve) => server.close(() => resolve()));
        return port;
      }

      const input = (localPort: number) => ({ hostname: "db.example.com", tokenId: "tid-12345", tokenSecret: "tsecret-6789", localPort });
      const scrub = createScrubber(["tid-12345", "tsecret-6789"]);

      /** Runs `script` with node in place of cloudflared and records what the tunnel passed to it. */
      function fakeCloudflared(script: string) {
        const calls: { command: string; args: string[]; options: StartOptions }[] = [];
        const start = (command: string, args: string[], options: StartOptions) => {
          calls.push({ command, args, options });
          return startChild(process.execPath, ["-e", script], { ...options, env: childEnv({}) });
        };
        return { calls, start };
      }

      describe("waitForPort", () => {
        it("resolves once the port opens", async () => {
          const port = await freePort();
          const server = createServer();
          setTimeout(() => server.listen(port, "127.0.0.1"), 250);
          await waitForPort(port, { timeoutMs: 5000, intervalMs: 50 });
          await new Promise<void>((resolve) => server.close(() => resolve()));
        });

        it("rejects on timeout", async () => {
          await expect(waitForPort(await freePort(), { timeoutMs: 200, intervalMs: 50 })).rejects.toThrow("did not open within 200 ms");
        });

        it("stops early when failFast returns an error", async () => {
          const started = Date.now();
          await expect(waitForPort(await freePort(), { timeoutMs: 10_000, intervalMs: 50, failFast: () => new Error("tunnel died") })).rejects.toThrow("tunnel died");
          expect(Date.now() - started).toBeLessThan(2000);
        });
      });

      describe("startTunnel", () => {
        it("passes the token in env only, and is ready when the local port accepts connections", async () => {
          const port = await freePort();
          const fake = fakeCloudflared(`require('net').createServer().listen(${port}, '127.0.0.1'); setInterval(() => {}, 1000)`);
          const tunnel = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 5000 });
          const call = fake.calls[0];
          expect(call?.command).toBe("cloudflared");
          expect(call?.args).toEqual(["access", "tcp", "--hostname", "db.example.com", "--url", `127.0.0.1:${port}`, "--loglevel", "info"]);
          expect(call?.args.join(" ")).not.toMatch(/tid-12345|tsecret-6789/);
          expect(call?.options.env).toMatchObject({ TUNNEL_SERVICE_TOKEN_ID: "tid-12345", TUNNEL_SERVICE_TOKEN_SECRET: "tsecret-6789" });
          await tunnel.stop();
        });

        it("fails fast with TUNNEL_FAILED and a scrubbed log when cloudflared exits", async () => {
          const port = await freePort();
          const fake = fakeCloudflared(`console.error('ERR failed to connect with tsecret-6789'); process.exitCode = 1`);
          const error = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 5000 }).catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(JobError);
          expect((error as JobError).code).toBe("TUNNEL_FAILED");
          expect((error as JobError).message).toContain("cloudflared exited with code 1");
          expect((error as JobError).message).not.toContain("tsecret-6789");
        });

        it("reports AUTH_FAILED when the log shows the token was refused", async () => {
          const port = await freePort();
          const fake = fakeCloudflared(`console.error('failed to connect to origin: 403 Forbidden'); process.exitCode = 1`);
          const error = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 5000 }).catch((caught: unknown) => caught);
          expect((error as JobError).code).toBe("AUTH_FAILED");
        });

        it("times out, kills the process, and reports TUNNEL_FAILED when the port never opens", async () => {
          const port = await freePort();
          const fake = fakeCloudflared(`setInterval(() => {}, 1000)`);
          const error = await startTunnel(input(port), { scrub, start: fake.start, readyTimeoutMs: 300 }).catch((caught: unknown) => caught);
          expect((error as JobError).code).toBe("TUNNEL_FAILED");
          expect((error as JobError).message).toContain("did not open");
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/tunnel.test.ts && bun run typecheck` - Expected: `Tests  7 passed (7)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/tunnel.ts container/test/tunnel.test.ts && git commit -m "feat(container): start cloudflared access tcp and wait for the local port"`

---

### Task 11: Callback client and heartbeat

**Files:**
- Create: `container/callback.ts`, `container/test/callback.test.ts`

**Interfaces:**
- Consumes: `signCallback`, `verifyCallback`, `TIMESTAMP_HEADER`, `SIGNATURE_HEADER` (Task 3); `ErrorCode` (Task 4).
- Produces:
  ```ts
  export type CallbackEvent = "started" | "progress" | "succeeded" | "failed";
  export interface CallbackExtra { result?: Record<string, unknown>; error?: { code: ErrorCode; message: string } }
  export interface CallbackClientOptions { url: string; jobId: string; jobKeyBase64: string; fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }
  export class CallbackClient { constructor(options: CallbackClientOptions); send(event: CallbackEvent, extra?: CallbackExtra): Promise<boolean> }
  export function startHeartbeat(client: CallbackClient, intervalMs?: number): () => void // default 30000; returns stop()
  ```

**Gotcha:** `send` assigns `seq` when called and delivers through one promise chain, so events leave in call order even when a heartbeat overlaps a terminal event. See Decision 9 for the retry rules. The unreachable-Worker test targets port 1 on loopback and expects `false`.

**Steps:**
- [ ] Step 1: Create `container/callback.ts`:
      ```ts
      import { SIGNATURE_HEADER, signCallback, TIMESTAMP_HEADER } from "./hmac";
      import type { ErrorCode } from "./job";

      export type CallbackEvent = "started" | "progress" | "succeeded" | "failed";

      export interface CallbackExtra {
        result?: Record<string, unknown>;
        error?: { code: ErrorCode; message: string };
      }

      export interface CallbackClientOptions {
        url: string;
        jobId: string;
        jobKeyBase64: string;
        fetchFn?: typeof fetch;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
      }

      const TERMINAL_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
      const OTHER_RETRY_DELAYS_MS = [1000];

      /**
       * Sends signed job events. Events go out one at a time in call order, so `seq` is always increasing.
       * A retry resends the same body (same seq) with a fresh timestamp and signature.
       */
      export class CallbackClient {
        private seq = 0;
        private tail: Promise<unknown> = Promise.resolve();
        private readonly fetchFn: typeof fetch;
        private readonly sleep: (ms: number) => Promise<void>;
        private readonly now: () => number;

        constructor(private readonly options: CallbackClientOptions) {
          this.fetchFn = options.fetchFn ?? fetch;
          this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
          this.now = options.now ?? Date.now;
        }

        /** Resolves true when the Worker accepted the event, false when it was rejected or retries ran out. */
        send(event: CallbackEvent, extra: CallbackExtra = {}): Promise<boolean> {
          const seq = ++this.seq;
          const body = JSON.stringify({ jobId: this.options.jobId, event, at: new Date(this.now()).toISOString(), seq, ...extra });
          const delays = event === "succeeded" || event === "failed" ? TERMINAL_RETRY_DELAYS_MS : OTHER_RETRY_DELAYS_MS;
          const delivery = this.tail.then(() => this.deliver(body, delays));
          this.tail = delivery;
          return delivery;
        }

        private async deliver(body: string, retryDelays: number[]): Promise<boolean> {
          for (let attempt = 0; ; attempt++) {
            const timestamp = String(Math.floor(this.now() / 1000));
            const signature = await signCallback(this.options.jobKeyBase64, timestamp, this.options.jobId, body);
            try {
              const response = await this.fetchFn(this.options.url, {
                method: "POST",
                headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature },
                body,
              });
              if (response.ok) return true;
              const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
              if (!retryable) return false;
            } catch {
              // Network error: retry below.
            }
            const delay = retryDelays[attempt];
            if (delay === undefined) return false;
            await this.sleep(delay);
          }
        }
      }

      /** Sends a `progress` event every `intervalMs` (30 s). Returns a function that stops it. */
      export function startHeartbeat(client: CallbackClient, intervalMs = 30_000): () => void {
        const timer = setInterval(() => void client.send("progress"), intervalMs);
        return () => clearInterval(timer);
      }
      ```
- [ ] Step 2: Create `container/test/callback.test.ts` (the local server verifies each request with `verifyCallback`, as the Worker will):
      ```ts
      import { createServer, type Server } from "node:http";
      import type { AddressInfo } from "node:net";
      import { afterEach, beforeEach, describe, expect, it } from "vitest";
      import { CallbackClient, startHeartbeat } from "../callback";
      import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyCallback } from "../hmac";

      const jobKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

      interface Received {
        body: string;
        timestamp: string;
        signature: string;
        verdict: string;
      }

      describe("CallbackClient", () => {
        let server: Server;
        let url: string;
        let received: Received[];
        let statuses: number[];

        beforeEach(async () => {
          received = [];
          statuses = [];
          server = createServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", async () => {
              const body = Buffer.concat(chunks).toString();
              const timestamp = String(req.headers[TIMESTAMP_HEADER.toLowerCase()]);
              const signature = String(req.headers[SIGNATURE_HEADER.toLowerCase()]);
              const verdict = await verifyCallback({ jobKeyBase64: jobKey, timestamp, signatureHex: signature, jobId: "job-1", rawBody: body, nowSeconds: Math.floor(Date.now() / 1000) });
              received.push({ body, timestamp, signature, verdict });
              res.writeHead(statuses.shift() ?? 200);
              res.end();
            });
          });
          await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
          url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/jobs/callback`;
        });
        afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

        const client = () => new CallbackClient({ url, jobId: "job-1", jobKeyBase64: jobKey, sleep: async () => {} });

        it("sends signed events in call order with increasing seq", async () => {
          const c = client();
          await Promise.all([c.send("started"), c.send("progress"), c.send("succeeded", { result: { sizeBytes: 5 } })]);
          const bodies = received.map((r) => JSON.parse(r.body));
          expect(bodies.map((b) => [b.event, b.seq])).toEqual([["started", 1], ["progress", 2], ["succeeded", 3]]);
          expect(bodies[2].result).toEqual({ sizeBytes: 5 });
          expect(received.every((r) => r.verdict === "ok")).toBe(true);
        });

        it("includes a redacted error object for failed events", async () => {
          await client().send("failed", { error: { code: "DUMP_FAILED", message: "pg_dump exited with code 1" } });
          expect(JSON.parse(received[0]?.body ?? "{}")).toMatchObject({ event: "failed", error: { code: "DUMP_FAILED" } });
        });

        it("retries 5xx with the same body and a verifiable signature", async () => {
          statuses.push(503, 502);
          expect(await client().send("succeeded")).toBe(true);
          expect(received).toHaveLength(3);
          expect(new Set(received.map((r) => r.body)).size).toBe(1);
          expect(received.every((r) => r.verdict === "ok")).toBe(true);
        });

        it("does not retry a 4xx and reports false", async () => {
          statuses.push(401);
          expect(await client().send("started")).toBe(false);
          expect(received).toHaveLength(1);
        });

        it("gives up after the retry budget: 1 try + 4 retries for terminal events, 1 + 1 for progress", async () => {
          statuses.push(500, 500, 500, 500, 500);
          expect(await client().send("failed")).toBe(false);
          expect(received).toHaveLength(5);
          received.length = 0;
          statuses.push(500, 500, 500);
          expect(await client().send("progress")).toBe(false);
          expect(received).toHaveLength(2);
        });

        it("returns false when the Worker is unreachable", async () => {
          const dead = new CallbackClient({ url: "http://127.0.0.1:1/cb", jobId: "job-1", jobKeyBase64: jobKey, sleep: async () => {} });
          expect(await dead.send("progress")).toBe(false);
        });

        it("heartbeat sends progress events until stopped", async () => {
          const c = client();
          const stop = startHeartbeat(c, 20);
          await new Promise((resolve) => setTimeout(resolve, 130));
          stop();
          await c.send("succeeded");
          const events = received.map((r) => JSON.parse(r.body).event);
          expect(events.filter((e) => e === "progress").length).toBeGreaterThanOrEqual(3);
          expect(events.at(-1)).toBe("succeeded");
          const after = received.length;
          await new Promise((resolve) => setTimeout(resolve, 80));
          expect(received.length).toBe(after);
        });
      });
      ```
- [ ] Step 3: Verify - Run: `bunx vitest run container/test/callback.test.ts && bun run typecheck` - Expected: `Tests  7 passed (7)`; typecheck exits 0
- [ ] Step 4: Commit - `git add container/callback.ts container/test/callback.test.ts && git commit -m "feat(container): send signed job events with ordered seq, retries, and heartbeat"`

---

### Task 12: Job context and the test command

**Files:**
- Create: `container/jobs/context.ts`, `container/jobs/test-connection.ts`

**Interfaces:**
- Consumes: `Job`, `JobError`, `ErrorCode` (Task 4); `parsePgUrl`, `pgEnv`, `pgBinary`, `parseProbe`, `PROBE_SQL`, `classifyConnectionFailure`, `MAX_PG_MAJOR`, `PgConnection`, `ServerProbe` (Task 5); `childEnv`, `runCapture` (Task 7); `S3Client` (Task 8).
- Produces:
  ```ts
  export interface JobContext { job: Job; signal: AbortSignal; scrub: (text: string) => string }
  export function connectionFor(job: Job): PgConnection; // always host 127.0.0.1, port tunnel.localPort
  export function s3For(job: Job): S3Client;
  export function toolFailure(ctx: JobContext, stderr: string, fallback: ErrorCode, summary: string): JobError;
  export function probeServer(ctx: JobContext, connection: PgConnection): Promise<ServerProbe>; // runs psql 18
  export function runTest(ctx: JobContext): Promise<Record<string, unknown>> // { pgServerVersion, dbSizeBytes, hasReadAllData, durationMs }
  ```

**Gotcha:** `psql` 18 is used for the probe against every server version (it is backward compatible). This is glue code over `psql`; there is no unit test. Behavior is proven by the Docker run in Task 16 (real PostgreSQL 14 and 17) and was run in scratch against a local PostgreSQL 16.

**Steps:**
- [ ] Step 1: Create `container/jobs/context.ts`:
      ```ts
      import { JobError, type ErrorCode, type Job } from "../job";
      import { classifyConnectionFailure, MAX_PG_MAJOR, parsePgUrl, parseProbe, pgBinary, pgEnv, PROBE_SQL, type PgConnection, type ServerProbe } from "../pg";
      import { childEnv, runCapture } from "../process";
      import { S3Client } from "../s3";

      export interface JobContext {
        job: Job;
        signal: AbortSignal;
        scrub: (text: string) => string;
      }

      /** Database connection for the job. The host and port are always the local tunnel listener. */
      export function connectionFor(job: Job): PgConnection {
        return { ...parsePgUrl(job.db.url), host: "127.0.0.1", port: job.tunnel.localPort };
      }

      export function s3For(job: Job): S3Client {
        if (!job.r2) throw new JobError("INVALID_JOB", "Invalid job: r2 is required");
        return new S3Client({
          endpoint: job.r2.endpoint,
          bucket: job.r2.bucket,
          region: job.r2.region,
          accessKeyId: job.r2.accessKeyId,
          secretAccessKey: job.r2.secretAccessKey,
        });
      }

      /** Builds a JobError from a failed Postgres tool: connection problems get their own code. */
      export function toolFailure(ctx: JobContext, stderr: string, fallback: ErrorCode, summary: string): JobError {
        const text = ctx.scrub(stderr).trim();
        const code = classifyConnectionFailure(text) ?? fallback;
        return new JobError(code, `${summary}: ${text.slice(-800)}`);
      }

      /** One psql round trip: server version, database size, and whether the role can read everything. */
      export async function probeServer(ctx: JobContext, connection: PgConnection): Promise<ServerProbe> {
        const result = await runCapture(
          pgBinary(MAX_PG_MAJOR, "psql"),
          ["-X", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1", "--no-password", "-c", PROBE_SQL],
          { env: childEnv(pgEnv(connection)), signal: ctx.signal },
        );
        if (result.exit.spawnError) throw new JobError("UNKNOWN", `Could not start psql: ${result.exit.spawnError.message}`);
        if (result.exit.code !== 0) throw toolFailure(ctx, result.stderr, "UNKNOWN", "Could not connect to the database");
        return parseProbe(result.stdout);
      }
      ```
- [ ] Step 2: Create `container/jobs/test-connection.ts`:
      ```ts
      import { connectionFor, probeServer, type JobContext } from "./context";

      export async function runTest(ctx: JobContext): Promise<Record<string, unknown>> {
        const startedAt = Date.now();
        const probe = await probeServer(ctx, connectionFor(ctx.job));
        return {
          pgServerVersion: probe.pgServerVersion,
          dbSizeBytes: probe.dbSizeBytes,
          hasReadAllData: probe.hasReadAllData,
          durationMs: Date.now() - startedAt,
        };
      }
      ```
- [ ] Step 3: Verify - Run: `bun run typecheck` - Expected: exits 0
- [ ] Step 4: Commit - `git add container/jobs/context.ts container/jobs/test-connection.ts && git commit -m "feat(container): add job context and the test-connection command"`

---

### Task 13: Backup and restore commands

**Files:**
- Create: `container/jobs/backup.ts`, `container/jobs/restore.ts`

**Interfaces:**
- Consumes: everything from Task 12 (`JobContext`, `connectionFor`, `probeServer`, `s3For`, `toolFailure`); `assertSupportedMajor`, `pgBinary`, `pgEnv`, `MAX_PG_MAJOR` (Task 5); `startChild`, `childEnv` (Task 7); `S3Error` (Task 8); `choosePartSize`, `uploadStream` (Task 9).
- Produces:
  ```ts
  export function runBackup(ctx: JobContext): Promise<Record<string, unknown>>; // { sizeBytes, sha256, partCount, pgServerVersion, durationMs }
  export function runRestore(ctx: JobContext): Promise<Record<string, unknown>> // { durationMs }
  ```

**Gotcha:**
- Backup runs `pg_dump --format=custom --no-password` with the binary that matches the server major (13-18), with `PG*` env vars. It writes to stdout; there is no `-f`, no temp file. `pg_dump`'s exit code is checked in `beforeComplete`, so a dump that fails midway aborts the upload.
- Restore runs `pg_restore --clean --if-exists --no-owner --no-password --dbname <db>` from `pg_restore` 18, reading the object from stdin. `--dbname` is required: without `-d`, `pg_restore` prints SQL instead of restoring. The database name is not a secret, so it is safe in argv.
- Restore error order: a download failure that is not `EPIPE` wins over `pg_restore`'s own exit code, because a cut download makes `pg_restore` fail as a side effect.

**Steps:**
- [ ] Step 1: Create `container/jobs/backup.ts`:
      ```ts
      import { JobError } from "../job";
      import { assertSupportedMajor, pgBinary, pgEnv } from "../pg";
      import { childEnv, startChild } from "../process";
      import { S3Error } from "../s3";
      import { choosePartSize, uploadStream } from "../upload";
      import { connectionFor, probeServer, s3For, toolFailure, type JobContext } from "./context";

      export async function runBackup(ctx: JobContext): Promise<Record<string, unknown>> {
        const { job, signal } = ctx;
        if (!job.r2?.key || !job.r2.partSizeBytes) throw new JobError("INVALID_JOB", "Invalid job: r2.key and r2.partSizeBytes are required");
        const startedAt = Date.now();
        const connection = connectionFor(job);

        const probe = await probeServer(ctx, connection);
        assertSupportedMajor(probe.major);
        const partSize = choosePartSize(job.r2.partSizeBytes, probe.dbSizeBytes);

        const dump = startChild(pgBinary(probe.major, "pg_dump"), ["--format=custom", "--no-password"], {
          env: childEnv(pgEnv(connection)),
          signal,
        });
        dump.stdin.end();
        try {
          const upload = await uploadStream(dump.stdout, s3For(job), job.r2.key, partSize, {
            signal,
            beforeComplete: async () => {
              const exit = await dump.exit;
              if (exit.spawnError) throw new JobError("DUMP_FAILED", `Could not start pg_dump: ${exit.spawnError.message}`);
              if (exit.code !== 0) throw toolFailure(ctx, dump.stderrTail(), "DUMP_FAILED", `pg_dump exited with code ${exit.code ?? exit.signal}`);
            },
          });
          return { ...upload, pgServerVersion: probe.pgServerVersion, durationMs: Date.now() - startedAt };
        } catch (error) {
          throw error instanceof S3Error ? new JobError("UPLOAD_FAILED", ctx.scrub(error.message)) : error;
        } finally {
          dump.kill();
        }
      }
      ```
- [ ] Step 2: Create `container/jobs/restore.ts`:
      ```ts
      import { pipeline } from "node:stream/promises";
      import { Readable } from "node:stream";
      import type { ReadableStream as WebReadableStream } from "node:stream/web";
      import { JobError } from "../job";
      import { MAX_PG_MAJOR, pgBinary, pgEnv } from "../pg";
      import { childEnv, startChild } from "../process";
      import { S3Error } from "../s3";
      import { connectionFor, s3For, toolFailure, type JobContext } from "./context";

      /**
       * Streams the dump from R2 into pg_restore. The newest pg_restore is used because it reads every
       * older archive format. The destination is the database named in the job's connection URL.
       */
      export async function runRestore(ctx: JobContext): Promise<Record<string, unknown>> {
        const { job, signal } = ctx;
        if (!job.restore) throw new JobError("INVALID_JOB", "Invalid job: restore is required");
        const startedAt = Date.now();
        const connection = connectionFor(job);

        let object: Response;
        try {
          object = await s3For(job).getObject(job.restore.sourceKey, signal);
        } catch (error) {
          throw error instanceof S3Error ? new JobError("DOWNLOAD_FAILED", ctx.scrub(error.message)) : error;
        }
        if (!object.body) throw new JobError("DOWNLOAD_FAILED", "The backup object has no body");

        const restore = startChild(
          pgBinary(MAX_PG_MAJOR, "pg_restore"),
          ["--clean", "--if-exists", "--no-owner", "--no-password", "--dbname", connection.database],
          { env: childEnv(pgEnv(connection)), signal },
        );
        const piped = pipeline(Readable.fromWeb(object.body as WebReadableStream), restore.stdin).then(
          () => null,
          (error: NodeJS.ErrnoException) => error,
        );
        const exit = await restore.exit;
        const pipeError = await piped;

        if (pipeError && pipeError.code !== "EPIPE") throw new JobError("DOWNLOAD_FAILED", ctx.scrub(`Download failed: ${pipeError.message}`));
        if (exit.spawnError) throw new JobError("RESTORE_FAILED", `Could not start pg_restore: ${exit.spawnError.message}`);
        if (exit.code !== 0) throw toolFailure(ctx, restore.stderrTail(), "RESTORE_FAILED", `pg_restore exited with code ${exit.code ?? exit.signal}`);
        return { durationMs: Date.now() - startedAt };
      }
      ```
- [ ] Step 3: Verify - Run: `bun run typecheck` - Expected: exits 0
- [ ] Step 4: Commit - `git add container/jobs/backup.ts container/jobs/restore.ts && git commit -m "feat(container): add streaming backup and restore commands"`

---

### Task 14: Entrypoint and the runner contract test

**Files:**
- Create: `container/entrypoint.ts`, `container/contract.ts`, `container/test/contract.test.ts`

**Interfaces:**
- Consumes: `CallbackClient`, `startHeartbeat` (Task 11); `runTest` (Task 12); `runBackup`, `runRestore` (Task 13); `loadJobText`, `parseJob`, `JobError`, `Job` (Task 4); `createScrubber`, `jobSecrets` (Task 6); `startTunnel` (Task 10); `connectionFor`, `JobContext` (Task 12).
- Produces: the process behavior in "Contract this phase produces": reads the job, sends `started`, heartbeats every 30 s, sends `succeeded` or `failed`, exits 0, 1, or 2. The Dockerfile `ENTRYPOINT` (Task 1) now has its file. Also `container/contract.ts` (exports `CONTRACT_ENTRYPOINT`, `SAMPLE_JOBS`, `SIGNATURE_VECTOR`, `jobShape`) and `container/test/contract.test.ts` (3 tests), see "Contract this phase produces".

**Gotcha:**
- The deadline timer is clamped to `2 ** 31 - 1` ms: a larger value makes `setTimeout` fire at once (found in scratch).
- The abort reason is a `JobError`; when the deadline or SIGTERM fires, that reason wins over the error the abort caused (`toJobError`), so a timed-out dump reports `TIMEOUT`, not `DUMP_FAILED`.
- The job is read from stdin (a file path argument only in the local e2e harness). There is no env var source.
- Logs go to stdout through the scrubber. Never log the job object.
- The file ends with a top-level `process.exit(await main())`, so nothing may import it (tests do not).

**Steps:**
- [ ] Step 1: Create `container/entrypoint.ts`:
      ```ts
      import { readFile } from "node:fs/promises";
      import { CallbackClient, startHeartbeat } from "./callback";
      import { runBackup } from "./jobs/backup";
      import { connectionFor, type JobContext } from "./jobs/context";
      import { runRestore } from "./jobs/restore";
      import { runTest } from "./jobs/test-connection";
      import { JobError, loadJobText, parseJob, type Job } from "./job";
      import { createScrubber, jobSecrets } from "./redact";
      import { startTunnel } from "./tunnel";

      const EXIT_FAILED = 1;
      const EXIT_INVALID_JOB = 2;
      const MAX_TIMER_MS = 2 ** 31 - 1;

      async function readStdin(): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
        return Buffer.concat(chunks).toString("utf8");
      }

      async function runJob(ctx: JobContext): Promise<Record<string, unknown>> {
        const { job } = ctx;
        connectionFor(job);
        const tunnel = await startTunnel(job.tunnel, { signal: ctx.signal, scrub: ctx.scrub });
        try {
          if (job.type === "test") return await runTest(ctx);
          if (job.type === "backup") return await runBackup(ctx);
          return await runRestore(ctx);
        } finally {
          await tunnel.stop();
        }
      }

      /** The deadline and SIGTERM abort the controller with a JobError; that reason wins over whatever the abort broke. */
      function toJobError(error: unknown, signal: AbortSignal, scrub: (text: string) => string): JobError {
        if (signal.aborted && signal.reason instanceof JobError) return signal.reason;
        if (error instanceof JobError) return new JobError(error.code, scrub(error.message));
        return new JobError("UNKNOWN", scrub(error instanceof Error ? error.message : String(error)));
      }

      async function main(): Promise<number> {
        let job: Job;
        try {
          const text = await loadJobText(process.argv.slice(2), { readFile: (path) => readFile(path, "utf8"), readStdin });
          job = parseJob(text);
        } catch (error) {
          console.error(error instanceof JobError ? error.message : "Invalid job: could not read the job input");
          return EXIT_INVALID_JOB;
        }

        const scrub = createScrubber(jobSecrets(job));
        const log = (message: string) => console.log(scrub(`[${new Date().toISOString()}] job ${job.jobId} ${message}`));
        const client = new CallbackClient({ url: job.callbackUrl, jobId: job.jobId, jobKeyBase64: job.jobKey });

        const controller = new AbortController();
        const deadlineTimer = setTimeout(
          () => controller.abort(new JobError("TIMEOUT", "The job passed its deadline")),
          Math.min(Math.max(0, job.deadlineAt.getTime() - Date.now()), MAX_TIMER_MS),
        );
        process.once("SIGTERM", () => controller.abort(new JobError("UNKNOWN", "The container was stopped before the job finished")));

        await client.send("started");
        const stopHeartbeat = startHeartbeat(client);
        log(`${job.type} started`);

        let exitCode = 0;
        try {
          const result = await runJob({ job, signal: controller.signal, scrub });
          stopHeartbeat();
          log(`${job.type} succeeded`);
          if (!(await client.send("succeeded", { result }))) {
            log("the success callback was not accepted");
            exitCode = EXIT_FAILED;
          }
        } catch (caught) {
          stopHeartbeat();
          const error = toJobError(caught, controller.signal, scrub);
          log(`${job.type} failed: ${error.code}: ${error.message}`);
          await client.send("failed", { error: { code: error.code, message: error.message } });
          exitCode = EXIT_FAILED;
        }
        clearTimeout(deadlineTimer);
        return exitCode;
      }

      process.exit(await main());
      ```
- [ ] Step 2: Create `container/contract.ts` (plain data, no imports, so the Worker tests in Phase 5 can import it):
      ```ts
      // The runner contract shared with the Worker (owner answer 13). Phase 5 imports this file in its own tests.
      // Change it only together with the Worker side.

      /** The image ENTRYPOINT. The job JSON arrives on stdin. */
      export const CONTRACT_ENTRYPOINT = ["bun", "run", "/app/entrypoint.ts"] as const;

      const common = {
        jobId: "0192f5a0-0000-7000-8000-000000000001",
        callbackUrl: "https://cellar.example.com/internal/jobs/callback",
        jobKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        deadlineAt: "2026-10-24T06:00:00.000Z",
        db: { url: "postgres://cellar_backup:example-pw@db.example.com:5432/shop?sslmode=disable", name: "shop" },
        tunnel: { hostname: "db.example.com", tokenId: "example-token-id", tokenSecret: "example-token-secret", localPort: 15432 },
      };
      const r2 = { endpoint: "https://example-account.r2.cloudflarestorage.com", bucket: "cellar-backups", accessKeyId: "example-access-key", secretAccessKey: "example-secret-key" };

      /** One valid stdin job per type. Field names and nesting are the contract; values are examples. */
      export const SAMPLE_JOBS = {
        test: { ...common, type: "test" },
        backup: { ...common, type: "backup", r2: { ...r2, key: "backups/0192f5a0-0000-7000-8000-0000000000aa/2026/10/24/2026-10-24T03:00:00.000Z_shop.dump", partSizeBytes: 33554432 } },
        restore: { ...common, type: "restore", r2, restore: { sourceKey: "backups/0192f5a0-0000-7000-8000-0000000000aa/2026/10/24/2026-10-24T03:00:00.000Z_shop.dump", targetDbName: "shop" } },
      } as const;

      /** Known-answer vector: hex HMAC-SHA256(base64-decoded jobKey, timestamp + "." + jobId + "." + rawBody). Computed independently (Python hmac) at planning time. */
      export const SIGNATURE_VECTOR = {
        jobKeyBase64: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
        timestamp: "1792814400",
        jobId: "0192f5a0-0000-7000-8000-000000000001",
        rawBody: '{"jobId":"0192f5a0-0000-7000-8000-000000000001","event":"started","at":"2026-10-24T03:00:00.000Z","seq":1}',
        signatureHex: "e308588ec7c6843905b822f135def5d1cedcd350bbb9e7f09f01c6bb7554c57c",
      } as const;

      /** Sorted dotted key paths of a JSON object, for comparing a built job with a sample. */
      export function jobShape(value: unknown, prefix = ""): string[] {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
        return Object.entries(value).flatMap(([key, child]) => jobShape(child, prefix ? `${prefix}.${key}` : key)).sort();
      }
      ```
- [ ] Step 3: Create `container/test/contract.test.ts`:
      ```ts
      import { readFileSync } from "node:fs";
      import { describe, expect, it } from "vitest";
      import { CONTRACT_ENTRYPOINT, jobShape, SAMPLE_JOBS, SIGNATURE_VECTOR } from "../contract";
      import { SIGNATURE_HEADER, signCallback, TIMESTAMP_HEADER, verifyCallback } from "../hmac";
      import { JobError, loadJobText, parseJob } from "../job";

      describe("runner contract", () => {
        it("accepts every sample job as stdin JSON, and requires the tunnel block", async () => {
          for (const sample of Object.values(SAMPLE_JOBS)) {
            const text = JSON.stringify(sample);
            const read = await loadJobText([], { readFile: async () => "", readStdin: async () => text });
            expect(parseJob(read).type).toBe(sample.type);
            expect(jobShape(sample)).toContain("tunnel.tokenSecret");
            expect(() => parseJob(JSON.stringify({ ...sample, tunnel: undefined }))).toThrow(JobError);
          }
        });

        it("signs callbacks in the agreed format", async () => {
          const v = SIGNATURE_VECTOR;
          expect([TIMESTAMP_HEADER, SIGNATURE_HEADER]).toEqual(["X-Cellar-Timestamp", "X-Cellar-Signature"]);
          expect(await signCallback(v.jobKeyBase64, v.timestamp, v.jobId, v.rawBody)).toBe(v.signatureHex);
          const verdict = await verifyCallback({ jobKeyBase64: v.jobKeyBase64, timestamp: v.timestamp, signatureHex: v.signatureHex, jobId: v.jobId, rawBody: v.rawBody, nowSeconds: Number(v.timestamp) });
          expect(verdict).toBe("ok");
        });

        it("starts the image with bun run /app/entrypoint.ts", () => {
          const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
          const line = dockerfile.match(/^ENTRYPOINT (.+)$/m)?.[1];
          expect(JSON.parse(line ?? "null")).toEqual([...CONTRACT_ENTRYPOINT]);
        });
      });
      ```
- [ ] Step 4: Verify - Run: `bunx vitest run container/test/contract.test.ts` - Expected: `Tests  3 passed (3)`. If the signature test fails, STOP: either `signCallback` or the planning-time vector is wrong, and Phase 5 depends on it.
- [ ] Step 5: Verify - Run: `bun run typecheck` - Expected: exits 0
- [ ] Step 6: Rebuild the image: `docker build -f container/Dockerfile -t cellar-runner:dev .`
- [ ] Step 7: Verify - Run: `echo '{"type":"explode"}' | docker run --rm -i cellar-runner:dev; echo "exit=$?"; docker run --rm --entrypoint bash cellar-runner:dev -c 'test -f /app/entrypoint.ts && test ! -d /app/test && test ! -d /app/e2e && echo trimmed'` - Expected: `Invalid job: type must be test, backup or restore` then `exit=2`, then `trimmed`
- [ ] Step 8: Commit - `git add container/entrypoint.ts container/contract.ts container/test/contract.test.ts && git commit -m "feat(container): add the runner entrypoint with deadline, heartbeat, and exit codes"`

---

### Task 15: Local test stack: Postgres 14 and 17, S3 stand-in, seed data

**Files:**
- Create: `test/docker-compose.test.yml`, `test/fixtures/seed.sql`

**Interfaces:**
- Consumes: `container/Dockerfile` (Task 1) through the `runner` service.
- Produces: compose project `cellar-test` with services `pg14`, `pg17` (user `cellar`, password `cellar-test-pw`, database `shop`, seeded), `s3` (host port 19000, access key `cellar-test-access`, secret `cellar-test-secret`), and profile-gated `runner` (image `cellar-runner:dev`, memory limit `${RUNNER_MEM_LIMIT:-256m}`, job directory mounted read-only at `/job`) plus `runner-local` (extends `runner`, puts the test-only fake `cloudflared` from Task 16 first on `PATH`; used by Tasks 16 and 17). Seed row counts: `customers` 2000, `orders` 20000, `events` 5000, view `order_totals` 2000.

**Gotcha:**
- All credentials here are throwaway local values for containers that are removed after the tests. They are the only secrets-like strings allowed in the repo.
- The `s3` service environment names (`RUSTFS_VOLUMES`, `RUSTFS_ADDRESS`, `RUSTFS_ACCESS_KEY`, `RUSTFS_SECRET_KEY`), `user: "0:0"`, and the `/health` path come from RustFS's docs and compose file and were not run here [uncertain]. RustFS's image runs as UID 10001 by default; `user: "0:0"` avoids volume permission problems. If the service does not start, read `docker compose -f test/docker-compose.test.yml logs s3`, adjust the environment minimally, and record a Deviation. If RustFS cannot work, STOP and ask (RustFS is the owner-approved stand-in, answer 8).
- `memswap_limit` equals `mem_limit` so the container cannot swap, which makes the memory proof honest.
- `runner-local` relies on `extends` merging `volumes` and `environment` with the base service [uncertain: check with `docker compose -f test/docker-compose.test.yml --profile runner config runner-local`, which must list both mounts and the `PATH`]. The fake file only exists after Task 16; the bind mount is resolved at `run` time, so Task 15's checks are not affected. The `PATH` value repeats the `oven/bun` default with `/opt/cellar-test` first [uncertain: compare with `docker run --rm --entrypoint printenv cellar-runner:dev PATH`].
- The `runner` service has a `profiles` entry, so `docker compose up` does not start it. Scripts start it with `docker compose run`.

**Rollback:** `docker compose -f test/docker-compose.test.yml down -v` removes the containers and the `s3data` volume. Nothing else is created.

**Steps:**
- [ ] Step 1: Create `test/fixtures/seed.sql`:
      ```sql
      create table customers (
        id serial primary key,
        email text not null unique,
        created_at timestamptz not null default '2026-01-01T00:00:00Z'
      );
      insert into customers (email) select 'user' || g || '@example.com' from generate_series(1, 2000) g;

      create table orders (
        id serial primary key,
        customer_id integer not null references customers (id),
        total_cents integer not null,
        note text not null
      );
      insert into orders (customer_id, total_cents, note)
        select 1 + (g % 2000), (g * 37) % 100000, md5(g::text) from generate_series(1, 20000) g;

      create table events (
        id bigserial primary key,
        payload jsonb not null
      );
      insert into events (payload) select jsonb_build_object('n', g, 'tag', 'e' || (g % 7)) from generate_series(1, 5000) g;

      create view order_totals as
        select customer_id, count(*) as orders, sum(total_cents) as total_cents from orders group by customer_id;
      ```
- [ ] Step 2: Create `test/docker-compose.test.yml`:
      ```yaml
      # Local stand-ins for the Phase 4 container tests: Postgres 14 and 17 plus an S3-compatible store for R2.
      # Used by container/e2e/*.ts. Never points at a real Cloudflare resource.
      name: cellar-test

      services:
        pg14:
          image: postgres:14
          environment: &pg-env
            POSTGRES_USER: cellar
            POSTGRES_PASSWORD: cellar-test-pw
            POSTGRES_DB: shop
          volumes:
            - ./fixtures/seed.sql:/docker-entrypoint-initdb.d/10-seed.sql:ro
          healthcheck: &pg-health
            test: ["CMD-SHELL", "pg_isready -U cellar -d shop"]
            interval: 2s
            timeout: 3s
            retries: 30

        pg17:
          image: postgres:17
          environment: *pg-env
          volumes:
            - ./fixtures/seed.sql:/docker-entrypoint-initdb.d/10-seed.sql:ro
          healthcheck: *pg-health

        # Test and dev only S3 stand-in (owner-approved RustFS), never in the production image. Override with S3_IMAGE.
        s3:
          image: ${S3_IMAGE:-rustfs/rustfs:1.0.3}
          user: "0:0"
          environment:
            RUSTFS_VOLUMES: /data
            RUSTFS_ADDRESS: 0.0.0.0:9000
            RUSTFS_ACCESS_KEY: cellar-test-access
            RUSTFS_SECRET_KEY: cellar-test-secret
          volumes:
            - s3data:/data
          ports:
            - "19000:9000"

        runner:
          profiles: ["runner"]
          image: cellar-runner:dev
          build:
            context: ..
            dockerfile: container/Dockerfile
          mem_limit: ${RUNNER_MEM_LIMIT:-256m}
          memswap_limit: ${RUNNER_MEM_LIMIT:-256m}
          extra_hosts:
            - "host.docker.internal:host-gateway"
          volumes:
            - ${JOB_DIR:-/tmp}:/job:ro

        # Local tests only: the same image with a fake cloudflared first on PATH (Task 16). Task 18 uses `runner`.
        runner-local:
          profiles: ["runner"]
          extends:
            service: runner
          environment:
            PATH: /opt/cellar-test:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
          volumes:
            - ../container/e2e/fake-cloudflared.ts:/opt/cellar-test/cloudflared:ro

      volumes:
        s3data:
      ```
- [ ] Step 3: Verify - Run: `docker compose version && docker compose -f test/docker-compose.test.yml config -q && echo config-ok` - Expected: a Compose v2 version line, then `config-ok`
- [ ] Step 4: Verify - Run: `docker compose -f test/docker-compose.test.yml up -d --wait pg14 pg17 && for s in pg14 pg17; do docker compose -f test/docker-compose.test.yml exec -T $s psql -U cellar -d shop -Atc "select (select count(*) from customers) || ',' || (select count(*) from orders) || ',' || (select count(*) from events) || ',' || (select count(*) from order_totals)"; done` - Expected: `2000,20000,5000,2000` printed twice
- [ ] Step 5: Verify - Run: `docker compose -f test/docker-compose.test.yml up -d s3 && curl -s --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null -w '%{http_code}\n' http://127.0.0.1:19000/health` - Expected: `200` [uncertain: the health path is RustFS's; any status below 500 proves the server is up]
- [ ] Step 6: Tear down: `docker compose -f test/docker-compose.test.yml down -v`
- [ ] Step 7: Commit - `git add test/docker-compose.test.yml test/fixtures/seed.sql && git commit -m "test(container): add compose stack with postgres 14 and 17 and an s3 stand-in"`

---

### Task 16: Docker end-to-end: test, backup, restore on PostgreSQL 14 and 17

**Files:**
- Create: `container/e2e/fake-cloudflared.ts`, `container/e2e/support.ts`, `container/e2e/run.ts`

**Interfaces:**
- Consumes: compose stack (Task 15); image (Tasks 1, 14); `verifyCallback` (Task 3); `S3Client` (Task 8).
- Produces (also used by Tasks 17 and 18): from `container/e2e/support.ts`:
  ```ts
  export const COMPOSE_FILE: string; export const BUCKET: string; export const S3_REGION: string; export const PG_PASSWORD: string;
  export function sh(command: string[], env?: Record<string, string>, stdin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
  export function compose(args: string[], env?: Record<string, string>, stdin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
  export function check(condition: boolean, message: string): void; // prints PASS or FAIL, sets process.exitCode = 1 on FAIL
  export function psql(service: "pg14" | "pg17", database: string, sql: string): Promise<string>;
  export function startStack(services: string[]): Promise<void>; // up -d, waits for pg_isready and the S3 stand-in, creates the bucket
  export function startCallbackListener(): { jobKey: string; callbackUrl: string; eventsFor(jobId: string): CallbackEvent[]; invalidCount(): number; stop(): void };
  export function runRunner(options: { jobId: string; job: Record<string, unknown>; containerName?: string }, env?: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }>;
  export function baseJob(listener, jobId: string, type: "test" | "backup" | "restore", dbUrl: string, extra?: Record<string, unknown>): Record<string, unknown>;
  export function r2Block(extra?: Record<string, unknown>): Record<string, unknown>;
  export function objectDigest(key: string): Promise<{ sha256: string; bytes: number }>
  ```

**Gotcha:**
- The script is meant to run from the repo root (`COMPOSE_FILE` is `test/docker-compose.test.yml`).
- The runner reaches Postgres through the fake `cloudflared` (`runner-local` service): it connects to `127.0.0.1:15432`, which forwards to `pg14` / `pg17`. It reaches the S3 stand-in at `s3:9000` through the compose network, and the host callback listener through `host.docker.internal:18080` (`extra_hosts: host-gateway` in the compose file covers Linux).
- The job JSON is written to a temp directory (mode 0600) and mounted read-only. It holds only throwaway local credentials. For the real-tunnel check (Task 18) the job goes through stdin instead.
- The script ends with `compose down -v`, which deletes the S3 data and the restore scratch databases.
- Expected PASS lines: 1 (image builds) + 9 per Postgres version x 2 + 1 (bad R2 secret) + 1 (expired deadline) + 1 (invalid job) + 1 (all callbacks verified) = 23.
- The wrong-password case relies on libpq's message `password authentication failed` (covered by `classifyConnectionFailure`); the bad-R2-secret case relies on the stand-in rejecting a wrong signature with a 4xx. If the stand-in accepts any signature, that single check fails: record it and ask (it would mean the stand-in does not verify SigV4, so the signer is then only proven by the AWS vectors).

**Rollback:** the script removes its own containers and volumes. If it crashed first: `docker compose -f test/docker-compose.test.yml --profile runner down -v`.

**Steps:**
- [ ] Step 1: Create `container/e2e/fake-cloudflared.ts` and make it executable (`chmod +x container/e2e/fake-cloudflared.ts`; git keeps mode 100755):
      ```ts
      #!/usr/bin/env bun
      // Test-only stand-in for `cloudflared access tcp`. Mounted only into the `runner-local` compose service,
      // never copied into the image (container/e2e/ is in Dockerfile.dockerignore).
      // Forwards 127.0.0.1:<port of --url> to <--hostname>:5432 on the compose network.
      import { connect, createServer } from "node:net";

      const args = process.argv.slice(2);
      const flag = (name: string) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
      };
      const hostname = flag("--hostname");
      const port = Number(flag("--url")?.split(":").pop());
      if (args[0] !== "access" || args[1] !== "tcp" || !hostname || !Number.isInteger(port)) {
        console.error("fake cloudflared: expected access tcp --hostname H --url 127.0.0.1:PORT");
        process.exit(2);
      }
      if (!process.env.TUNNEL_SERVICE_TOKEN_ID || !process.env.TUNNEL_SERVICE_TOKEN_SECRET) {
        console.error("fake cloudflared: the service token env vars are missing");
        process.exit(2);
      }

      createServer((client) => {
        const upstream = connect(5432, hostname);
        const close = () => {
          client.destroy();
          upstream.destroy();
        };
        client.on("error", close).on("close", close);
        upstream.on("error", close).on("close", close);
        client.pipe(upstream).pipe(client);
      }).listen(port, "127.0.0.1", () => console.error(`fake cloudflared: 127.0.0.1:${port} -> ${hostname}:5432`));
      ```
- [ ] Step 2: Create `container/e2e/support.ts`:
      ```ts
      import { createHash, randomBytes } from "node:crypto";
      import { mkdtemp, writeFile } from "node:fs/promises";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      import { verifyCallback } from "../hmac";
      import { S3Client } from "../s3";

      export const COMPOSE_FILE = "test/docker-compose.test.yml";
      export const BUCKET = "cellar-test";
      export const S3_REGION = process.env.S3_REGION ?? "us-east-1";
      export const PG_PASSWORD = "cellar-test-pw";
      const CALLBACK_PORT = 18080;

      export interface CommandResult {
        code: number;
        stdout: string;
        stderr: string;
      }

      export async function sh(command: string[], env: Record<string, string> = {}, stdin?: string): Promise<CommandResult> {
        const proc = Bun.spawn(command, { env: { ...process.env, ...env }, stdin: stdin === undefined ? "ignore" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { code, stdout, stderr };
      }

      export const compose = (args: string[], env: Record<string, string> = {}, stdin?: string) =>
        sh(["docker", "compose", "-f", COMPOSE_FILE, ...args], env, stdin);

      export function check(condition: boolean, message: string): void {
        console.log(`${condition ? "PASS" : "FAIL"} ${message}`);
        if (!condition) process.exitCode = 1;
      }

      /** Runs SQL in a database container as the seeded superuser and returns trimmed psql -At output. */
      export async function psql(service: "pg14" | "pg17", database: string, sql: string): Promise<string> {
        const result = await compose(["exec", "-T", service, "psql", "-U", "cellar", "-d", database, "-At", "-c", sql]);
        if (result.code !== 0) throw new Error(`psql failed on ${service}: ${result.stderr}`);
        return result.stdout.trim();
      }

      export async function waitFor(what: string, probe: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (await probe().catch(() => false)) return;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`timed out waiting for ${what}`);
      }

      export const s3Client = () =>
        new S3Client({ endpoint: "http://127.0.0.1:19000", bucket: BUCKET, region: S3_REGION, accessKeyId: "cellar-test-access", secretAccessKey: "cellar-test-secret" });

      export async function startStack(services: string[]): Promise<void> {
        const up = await compose(["up", "-d", ...services]);
        if (up.code !== 0) throw new Error(`docker compose up failed: ${up.stderr}`);
        for (const service of services.filter((name) => name.startsWith("pg"))) {
          await waitFor(`${service} to accept connections`, async () => (await compose(["exec", "-T", service, "pg_isready", "-U", "cellar", "-d", "shop"])).code === 0);
        }
        await waitFor("the S3 stand-in", async () => (await fetch("http://127.0.0.1:19000/health")).status < 500);
        try {
          await s3Client().send({ method: "PUT" });
        } catch (error) {
          if (!(error instanceof Error && /BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(error.message))) throw error;
        }
      }

      export interface CallbackEvent {
        jobId: string;
        event: "started" | "progress" | "succeeded" | "failed";
        seq: number;
        result?: Record<string, unknown>;
        error?: { code: string; message: string };
      }

      /** Local HTTP listener that verifies the HMAC of every callback, like the Worker will. */
      export function startCallbackListener() {
        const jobKey = randomBytes(32).toString("base64");
        const events: CallbackEvent[] = [];
        let invalid = 0;
        const server = Bun.serve({
          port: CALLBACK_PORT,
          hostname: "0.0.0.0",
          async fetch(request) {
            const body = await request.text();
            const parsed = JSON.parse(body) as CallbackEvent;
            const verdict = await verifyCallback({
              jobKeyBase64: jobKey,
              timestamp: request.headers.get("x-cellar-timestamp") ?? "",
              signatureHex: request.headers.get("x-cellar-signature") ?? "",
              jobId: parsed.jobId,
              rawBody: body,
              nowSeconds: Math.floor(Date.now() / 1000),
            });
            if (verdict !== "ok") {
              invalid++;
              return new Response("bad signature", { status: 401 });
            }
            events.push(parsed);
            return new Response("ok");
          },
        });
        return {
          jobKey,
          callbackUrl: `http://host.docker.internal:${CALLBACK_PORT}/internal/jobs/callback`,
          eventsFor: (jobId: string) => events.filter((event) => event.jobId === jobId),
          invalidCount: () => invalid,
          stop: () => server.stop(true),
        };
      }

      export interface RunOptions {
        jobId: string;
        job: Record<string, unknown>;
        containerName?: string;
      }

      /** Writes the job JSON to a temp dir, runs the runner image on it, and returns the exit code and output. */
      export async function runRunner(options: RunOptions, env: Record<string, string> = {}): Promise<CommandResult> {
        const dir = await mkdtemp(join(tmpdir(), "cellar-job-"));
        await writeFile(join(dir, "job.json"), JSON.stringify(options.job), { mode: 0o600 });
        const args = ["run", "-T", ...(options.containerName ? ["--name", options.containerName] : ["--rm"]), "runner-local", "/job/job.json"];
        return compose(args, { JOB_DIR: dir, ...env });
      }

      /** Every job has a tunnel block (no direct mode). Locally the fake cloudflared forwards to the URL's host. */
      export function baseJob(listener: ReturnType<typeof startCallbackListener>, jobId: string, type: "test" | "backup" | "restore", dbUrl: string, extra: Record<string, unknown> = {}) {
        const tunnel = { hostname: new URL(dbUrl).hostname, tokenId: "local-test-token-id", tokenSecret: "local-test-token-secret", localPort: 15432 };
        return {
          jobId,
          type,
          callbackUrl: listener.callbackUrl,
          jobKey: listener.jobKey,
          deadlineAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          db: { url: dbUrl, name: "shop" },
          tunnel,
          ...extra,
        };
      }

      export const r2Block = (extra: Record<string, unknown> = {}) => ({
        endpoint: "http://s3:9000",
        bucket: BUCKET,
        region: S3_REGION,
        accessKeyId: "cellar-test-access",
        secretAccessKey: "cellar-test-secret",
        ...extra,
      });

      /** sha256 and byte count of a stored object, computed by reading it back as a stream. */
      export async function objectDigest(key: string): Promise<{ sha256: string; bytes: number }> {
        const response = await s3Client().getObject(key);
        const hash = createHash("sha256");
        let bytes = 0;
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          bytes += chunk.length;
        }
        return { sha256: hash.digest("hex"), bytes };
      }
      ```
- [ ] Step 3: Create `container/e2e/run.ts`:
      ```ts
      // Functional check of the runner against Postgres 14 and 17 and an S3 stand-in. Needs Docker. Run from the repo root:
      //   bun container/e2e/run.ts
      import {
        PG_PASSWORD, baseJob, check, compose, objectDigest, psql, r2Block, runRunner, startCallbackListener, startStack, type CallbackEvent,
      } from "./support";

      const VERSIONS = [14, 17] as const;
      const TABLES = ["customers", "orders", "events", "order_totals"];

      const listener = startCallbackListener();
      const terminal = (events: CallbackEvent[]) => events.find((event) => event.event === "succeeded" || event.event === "failed");

      async function counts(service: "pg14" | "pg17", database: string): Promise<string> {
        return psql(service, database, TABLES.map((table) => `select '${table}=' || count(*) from ${table}`).join(" union all ") + " order by 1");
      }

      try {
        const build = await compose(["--profile", "runner", "build", "runner"]);
        check(build.code === 0, "runner image builds");
        await startStack(["pg14", "pg17", "s3"]);

        for (const version of VERSIONS) {
          const service = `pg${version}` as "pg14" | "pg17";
          const url = (database: string, password = PG_PASSWORD) => `postgres://cellar:${password}@${service}:5432/${database}`;
          const label = `PG${version}`;
          const key = `backups/e2e/${version}/dump.dump`;

          const testRun = await runRunner({ jobId: `test-${version}`, job: baseJob(listener, `test-${version}`, "test", url("shop")) });
          const testEvents = listener.eventsFor(`test-${version}`);
          check(testRun.code === 0 && terminal(testEvents)?.event === "succeeded", `${label} test job succeeds`);
          check(String(terminal(testEvents)?.result?.pgServerVersion).startsWith(`${version}.`), `${label} test job reports server version ${version}.x`);
          check(Number(terminal(testEvents)?.result?.dbSizeBytes) > 0, `${label} test job reports the database size`);

          const backupRun = await runRunner({ jobId: `backup-${version}`, job: baseJob(listener, `backup-${version}`, "backup", url("shop"), { r2: r2Block({ key, partSizeBytes: 5 * 1024 * 1024 }) }) });
          const backupResult = terminal(listener.eventsFor(`backup-${version}`));
          check(backupRun.code === 0 && backupResult?.event === "succeeded", `${label} backup job succeeds`);
          const stored = await objectDigest(key);
          check(backupResult?.result?.sha256 === stored.sha256 && backupResult?.result?.sizeBytes === stored.bytes, `${label} callback sha256 and size match the stored object`);

          await psql(service, "postgres", "drop database if exists restore_check");
          await psql(service, "postgres", "create database restore_check");
          const restoreRun = await runRunner({ jobId: `restore-${version}`, job: baseJob(listener, `restore-${version}`, "restore", url("restore_check"), { r2: r2Block(), restore: { sourceKey: key, targetDbName: "restore_check" } }) });
          check(restoreRun.code === 0 && terminal(listener.eventsFor(`restore-${version}`))?.event === "succeeded", `${label} restore job succeeds`);
          const [source, restored] = [await counts(service, "shop"), await counts(service, "restore_check")];
          check(source === restored && source.includes("orders=20000"), `${label} restored row counts equal the source (${source.replaceAll("\n", ", ")})`);

          const badPassword = "wrong-password-xyz";
          const authRun = await runRunner({ jobId: `auth-${version}`, job: baseJob(listener, `auth-${version}`, "test", url("shop", badPassword)) });
          const authResult = terminal(listener.eventsFor(`auth-${version}`));
          check(authRun.code === 1 && authResult?.error?.code === "AUTH_FAILED", `${label} wrong password fails with AUTH_FAILED and exit code 1`);
          check(!JSON.stringify(authResult).includes(badPassword) && !authRun.stdout.includes(badPassword) && !authRun.stderr.includes(badPassword), `${label} wrong password never appears in the callback or output`);
        }

        const badKeyRun = await runRunner({
          jobId: "s3-bad",
          job: baseJob(listener, "s3-bad", "backup", `postgres://cellar:${PG_PASSWORD}@pg17:5432/shop`, { r2: r2Block({ key: "backups/e2e/bad.dump", partSizeBytes: 5 * 1024 * 1024, secretAccessKey: "not-the-real-secret" }) }),
        });
        const badKey = terminal(listener.eventsFor("s3-bad"));
        check(badKeyRun.code === 1 && badKey?.error?.code === "UPLOAD_FAILED" && !JSON.stringify(badKey).includes("not-the-real-secret"), "bad R2 secret fails with UPLOAD_FAILED, redacted");

        const expiredRun = await runRunner({
          jobId: "expired",
          job: { ...baseJob(listener, "expired", "test", `postgres://cellar:${PG_PASSWORD}@pg17:5432/shop`), deadlineAt: new Date(Date.now() - 1000).toISOString() },
        });
        check(expiredRun.code === 1 && terminal(listener.eventsFor("expired"))?.error?.code === "TIMEOUT", "a job past its deadline fails with TIMEOUT");

        const invalidRun = await runRunner({ jobId: "invalid", job: { type: "explode" } });
        check(invalidRun.code === 2 && invalidRun.stderr.includes("Invalid job"), "an invalid job exits with code 2");

        const seqs = ["test-14", "backup-17"].flatMap((id) => listener.eventsFor(id).map((event) => event.seq));
        check(seqs.length > 0 && listener.invalidCount() === 0, `every callback carried a valid HMAC (${seqs.length} events checked, ${listener.invalidCount()} rejected)`);
      } finally {
        listener.stop();
        await compose(["--profile", "runner", "down", "-v"]);
      }
      ```
- [ ] Step 4: Verify - Run (bash): `bun run typecheck && bun container/e2e/run.ts | tee /tmp/cellar-e2e-run.log; echo "exit=${PIPESTATUS[0]}"; grep -c '^PASS' /tmp/cellar-e2e-run.log; grep -c '^FAIL' /tmp/cellar-e2e-run.log` - Expected: typecheck exits 0; `exit=0`; `23`; `0`. The log includes lines like `PASS PG14 restored row counts equal the source (customers=2000, events=5000, order_totals=2000, orders=20000)`
- [ ] Step 5: Commit - `git add container/e2e/fake-cloudflared.ts container/e2e/support.ts container/e2e/run.ts && git commit -m "test(container): add docker end-to-end for test, backup, restore on postgres 14 and 17"`

---

### Task 17: Docker end-to-end: memory proof with a ~2 GB database

**Files:**
- Create: `container/e2e/large.ts`

**Interfaces:**
- Consumes: `container/e2e/support.ts` (Task 16), compose stack (Task 15), image (Tasks 1, 14).
- Produces: a measured peak container memory for a 2 GB backup, and the go / no-go for 32 MiB parts under the 256 MB limit.

**Gotcha:**
- Needs about 10 GB free disk and several minutes: generating the data (about 14 million rows, about 2.5 GB), the dump (about 1.2 GB compressed), and the upload.
- Defaults follow owner answer 12: `PART_MIB=32`, `RUNNER_MEM_LIMIT=256m`. The scratch uploader peak at 32 MiB was 174 MiB of RSS, which leaves about 80 MiB for `pg_dump` inside the same cgroup; Linux numbers may differ [uncertain].
- **STOP rule (register):** if the runner is OOM-killed or the peak check fails with the default settings, STOP and report the printed numbers. Do not change the code, the part size, or the limit to make it pass without the owner's answer (options then: a larger limit, smaller parts, or spooling a part to disk, which PLAN.md forbids today). The script prints `peak container memory: N MiB of M MiB (part size P MiB), OOMKilled=...` for the report.
- The memory is sampled once per second with `docker stats`, so the printed peak can be slightly low. The kernel kill (`OOMKilled`) is the hard evidence.
- The dump must be larger than the memory limit, which proves the dump is streamed and not held in memory.

**Rollback:** the script removes its containers and volumes (`down -v`). If it crashed first: `docker rm -f cellar-test-large-runner; docker compose -f test/docker-compose.test.yml --profile runner down -v` (frees the 2.5 GB database).

**Steps:**
- [ ] Step 1: Create `container/e2e/large.ts`:
      ```ts
      // Memory proof: back up a ~2 GB database with the runner limited to RUNNER_MEM_LIMIT (default 256m). Needs Docker and ~10 GB free disk.
      //   bun container/e2e/large.ts
      // Overrides (diagnosis only, not the proof): RUNNER_MEM_LIMIT=512m, PART_MIB=16
      import { baseJob, check, compose, objectDigest, psql, r2Block, runRunner, sh, startCallbackListener, startStack } from "./support";

      const memLimit = process.env.RUNNER_MEM_LIMIT ?? "256m";
      const partMiB = Number(process.env.PART_MIB ?? 32);
      const limitMiB = Number.parseInt(memLimit, 10);
      const container = "cellar-test-large-runner";

      const listener = startCallbackListener();
      try {
        await compose(["--profile", "runner", "build", "runner"]);
        await startStack(["pg17", "s3"]);

        console.log("generating about 2 GB of data (this takes a few minutes)...");
        await psql("pg17", "shop", "drop table if exists big");
        await psql("pg17", "shop", "create table big as select g as id, md5(random()::text) || md5(random()::text) || md5(random()::text) || md5(random()::text) as filler from generate_series(1, 14000000) g");
        const size = Number(await psql("pg17", "shop", "select pg_database_size('shop')"));
        check(size > 1.9 * 1024 ** 3, `database is ${(size / 1024 ** 3).toFixed(2)} GiB (needs more than 1.9 GiB)`);

        let peakMiB = 0;
        const sampler = setInterval(async () => {
          const stats = await sh(["docker", "stats", "--no-stream", "--format", "{{.MemUsage}}", container]);
          const used = /([\d.]+)(MiB|GiB)/.exec(stats.stdout);
          if (used) peakMiB = Math.max(peakMiB, Number(used[1]) * (used[2] === "GiB" ? 1024 : 1));
        }, 1000);

        const key = "backups/e2e/large/dump.dump";
        const run = await runRunner(
          { jobId: "large", containerName: container, job: baseJob(listener, "large", "backup", "postgres://cellar:cellar-test-pw@pg17:5432/shop", { r2: r2Block({ key, partSizeBytes: partMiB * 1024 * 1024 }) }) },
          { RUNNER_MEM_LIMIT: memLimit },
        );
        clearInterval(sampler);
        const oom = (await sh(["docker", "inspect", "-f", "{{.State.OOMKilled}}", container])).stdout.trim();
        await sh(["docker", "rm", "-f", container]);

        const result = listener.eventsFor("large").find((event) => event.event === "succeeded");
        console.log(`peak container memory: ${peakMiB.toFixed(0)} MiB of ${limitMiB} MiB (part size ${partMiB} MiB), OOMKilled=${oom}`);
        check(oom === "false", "the runner was not killed for running out of memory");
        check(run.code === 0 && result !== undefined, "the large backup succeeds");
        check(Number(result?.result?.sizeBytes) > limitMiB * 1024 * 1024, "the dump is larger than the memory limit, so it cannot have been buffered");
        check(peakMiB > 0 && peakMiB < limitMiB, `peak memory ${peakMiB.toFixed(0)} MiB stays under the ${limitMiB} MiB limit`);
        const stored = await objectDigest(key);
        check(stored.sha256 === result?.result?.sha256 && stored.bytes === result?.result?.sizeBytes, "stored object sha256 and size match the callback");
      } finally {
        listener.stop();
        await compose(["--profile", "runner", "down", "-v"]);
      }
      ```
- [ ] Step 2: Verify - Run (bash): `bun run typecheck && bun container/e2e/large.ts | tee /tmp/cellar-e2e-large.log; echo "exit=${PIPESTATUS[0]}"; grep -c '^PASS' /tmp/cellar-e2e-large.log; grep -c '^FAIL' /tmp/cellar-e2e-large.log; grep 'peak container memory' /tmp/cellar-e2e-large.log` - Expected: typecheck exits 0; `exit=0`; `6`; `0`; and a `peak container memory: N MiB of 256 MiB ...` line with N below 256. If not, apply the STOP rule above.
- [ ] Step 3: Commit - `git add container/e2e/large.ts && git commit -m "test(container): add memory proof for a 2 GB backup under a memory limit"`

---

### Task 18: Runner through the real tunnel (Human gate, recommended)

**Files:**
- Create: `container/e2e/tunnel.ts`

**Interfaces:**
- Consumes: `container/e2e/support.ts` (Task 16), image (Task 14), the owner's tunnel (Task 2).
- Produces: evidence that the whole runner (not only the spike script) works through a real tunnel: `cloudflared` start, readiness wait, `psql` probe, optional `pg_dump` upload to the LOCAL S3 stand-in.

**Gotcha:**
- Credentials come from the environment and reach the runner on stdin (`docker compose run -T runner` with the job JSON piped in): no file, no argv, no `ps` exposure.
- The backup option writes to the local stand-in, never to R2. A large real database would fill the local volume; the owner chooses the database.
- This task is recommended, not blocking: Task 2 already decided go or no-go. If the owner cannot run it now, record "awaiting human" in the summary.

**Steps:**
- [ ] Step 1: Create `container/e2e/tunnel.ts`:
      ```ts
      // Runs the runner's `test` job (and optionally a backup) through a REAL Cloudflare tunnel. Needs the owner's Access app and service token.
      // Credentials come from the environment and reach the container on stdin: no file, no argv.
      //   SPIKE_HOSTNAME=... TUNNEL_SERVICE_TOKEN_ID=... TUNNEL_SERVICE_TOKEN_SECRET=... PGUSER=... PGPASSWORD=... PGDATABASE=... bun container/e2e/tunnel.ts
      // Set TUNNEL_E2E_BACKUP=1 to also back the database up into the local S3 stand-in.
      import { baseJob, check, compose, r2Block, startCallbackListener, startStack, type CallbackEvent } from "./support";

      function need(name: string): string {
        const value = process.env[name];
        if (!value) throw new Error(`missing env var: ${name}`);
        return value;
      }

      const tunnel = {
        hostname: need("SPIKE_HOSTNAME"),
        tokenId: need("TUNNEL_SERVICE_TOKEN_ID"),
        tokenSecret: need("TUNNEL_SERVICE_TOKEN_SECRET"),
        localPort: 15432,
      };
      // The host in the URL is ignored in tunnel mode: the runner always connects to the local tunnel port.
      const dbUrl = `postgres://${encodeURIComponent(need("PGUSER"))}:${encodeURIComponent(need("PGPASSWORD"))}@127.0.0.1:15432/${encodeURIComponent(need("PGDATABASE"))}`;

      const listener = startCallbackListener();
      const terminal = (events: CallbackEvent[]) => events.find((event) => event.event === "succeeded" || event.event === "failed");

      async function run(jobId: string, type: "test" | "backup", extra: Record<string, unknown> = {}) {
        const job = baseJob(listener, jobId, type, dbUrl, { tunnel, ...extra });
        const result = await compose(["run", "-T", "--rm", "runner"], {}, JSON.stringify(job));
        return { code: result.code, event: terminal(listener.eventsFor(jobId)) };
      }

      try {
        await compose(["--profile", "runner", "build", "runner"]);
        const test = await run("tunnel-test", "test");
        console.log(`result: ${JSON.stringify(test.event?.result ?? test.event?.error)}`);
        check(test.code === 0 && test.event?.event === "succeeded", "test job through the real tunnel succeeds");

        if (process.env.TUNNEL_E2E_BACKUP === "1") {
          await startStack(["s3"]);
          const backup = await run("tunnel-backup", "backup", { r2: r2Block({ key: "backups/e2e/tunnel/dump.dump", partSizeBytes: 5 * 1024 * 1024 }) });
          console.log(`result: ${JSON.stringify(backup.event?.result ?? backup.event?.error)}`);
          check(backup.code === 0 && backup.event?.event === "succeeded", "backup job through the real tunnel succeeds");
        }
      } finally {
        listener.stop();
        await compose(["--profile", "runner", "down", "-v"]);
      }
      ```
- [ ] Step 2: Verify - Run: `bun run typecheck` - Expected: exits 0
- [ ] 👤 Step 3: Verify - Human: owner runs `bun container/e2e/tunnel.ts` with the six Task 2 variables exported (add `TUNNEL_E2E_BACKUP=1` to also run a backup into the local stand-in) - Expected: a `result:` line with `pgServerVersion`, `dbSizeBytes`, `hasReadAllData`, then `PASS test job through the real tunnel succeeds` (and `PASS backup job through the real tunnel succeeds` with the flag) - Proxy: Task 16 `bun container/e2e/run.ts` (the same runner code path through the test-only fake `cloudflared`, 23 PASS) plus Task 10 unit tests (the `cloudflared` arguments carry no secret and the token is in env)
- [ ] Step 4: Commit - `git add container/e2e/tunnel.ts && git commit -m "test(container): add runner check through a real tunnel"`

---

### Task 19: Update docs/PLAN.md and finish the phase

**Files:**
- Modify: `docs/PLAN.md` (anchors listed in Step 1)

**Interfaces:**
- Consumes: the results of Tasks 2, 16, 17, 18 (spike outcome, memory numbers).
- Produces: `docs/PLAN.md` consistent with what was built.

**Gotcha:** every `old` string below occurs once in `docs/PLAN.md` as of base commit `5f7ddc8` plus the Phase 1 edits (Task 6 of the Phase 1 plan). The owner's round 2 edits already rewrote parts of section 5 (stdin input, `bun run /app/entrypoint.ts`, tunnel only, 32MiB parts, the lifecycle rule); items 3, 4, 6, and 9 must not undo them. If one no longer matches (Phase 5 may have edited the same area), grep the anchor and apply the same intent. Do not rewrite unrelated text.

**Steps:**
- [ ] Step 1: Apply these replacements in `docs/PLAN.md`:
  1. Section 2, the `container/` block. Old (three lines): `  container/                   image build context` / `    Dockerfile (FROM oven/bun:1.3.9-slim)  entrypoint.ts  jobs/ test-connection.ts backup.ts restore.ts` / `    tunnel.ts  multipart.ts  hmac.ts`. New: `  container/                   runner source; image built from the repo root with container/Dockerfile` / `    Dockerfile  Dockerfile.dockerignore  tsconfig.json  entrypoint.ts  job.ts  pg.ts  redact.ts  process.ts` / `    s3.ts  upload.ts  tunnel.ts  callback.ts  hmac.ts  jobs/ context.ts test-connection.ts backup.ts restore.ts` / `    scripts/ tunnel-spike.sh   test/ (Vitest unit tests)   e2e/ (Docker scripts)`.
  2. Section 2 notes. Old: ``- `src/worker/lib/hmac.ts` and `container/hmac.ts` share one small implementation (single source, imported by both).`` (if Phase 1 has not edited it, the old text starts with `src/lib/hmac.ts`). New: ``- `container/hmac.ts` is the single HMAC implementation (WebCrypto only). The Worker imports it by relative path.`` Add a second bullet: ``- The image build context is the repo root. The runner shares `src/worker/lib/redact.ts` with the Worker.``
  3. Section 5. Old: `Passed as env vars and one JSON file or stdin, never in command-line args:` New: `Passed as one JSON document on stdin (secrets never in env vars or command-line args):`
  4. Section 5, after the line starting ``` `r2` is used by backup and restore only ``` add this paragraph: `` `r2.region` is optional (default `auto`). The `tunnel` block is always required (there is no direct mode). The host and port of `db.url` are ignored: the runner connects to `127.0.0.1:tunnel.localPort`. `restore.targetDbName` is informational; the database comes from `db.url`. Exit codes: 0 success, 1 failed or timed out, 2 invalid job input (no callback is possible). ``
  5. Section 5 container steps. Old: `- test: open tunnel, `SELECT version()`, check role has `pg_read_all_data`, report.` New: `- test: open tunnel, one `psql` query for server version, database size, and `pg_read_all_data` membership (`hasReadAllData` is `null` on PostgreSQL 13), report `{ pgServerVersion, dbSizeBytes, hasReadAllData, durationMs }`.` Old: the `backup:` bullet ending ``On any failure, `AbortMultipartUpload`.`` New: append: ` Parts are equal size except the last, uploaded one at a time. A non-zero `pg_dump` exit aborts the upload. Result: `{ sizeBytes, sha256, partCount, pgServerVersion, durationMs }`.` Old: `- restore: stream the R2 object into `pg_restore` over the tunnel using the restore URL.` New: `- restore: stream the R2 object into `pg_restore --clean --if-exists --no-owner` (newest `pg_restore`, 18) over the tunnel using the restore URL. Any non-zero exit is a failure. Result: `{ durationMs }`.`
  6. Section 5 memory bullet (owner round 2 text). Old: the bullet beginning `- Memory: part size is a config value (`partSizeBytes`, default 32MiB).` New: keep it and add the measured result from Task 17 before "No local disk for the dump": the part size and limit used (32 MiB, 256m), the `peak container memory` printed by the script, and that a part costs about 2x its size because `fetch` copies the body (scratch table in "Closed by owner (round 2)").
  7. Section 5 callback payload. Old: `"error": { "code": "TUNNEL_FAILED | AUTH_FAILED | DUMP_FAILED | UPLOAD_FAILED | TIMEOUT | UNKNOWN", "message": "redacted" }` New: `"error": { "code": "TUNNEL_FAILED | AUTH_FAILED | DUMP_FAILED | UPLOAD_FAILED | DOWNLOAD_FAILED | RESTORE_FAILED | TIMEOUT | INVALID_JOB | UNKNOWN", "message": "redacted" }`. Then, under the callback payload block, add: `Retries resend the same body and `seq` with a fresh timestamp. The Worker must answer 2xx for a `seq` it already applied.`
  8. Section 7. Old: the bullet beginning `- The `--service-token-id/--service-token-secret` flags were verified in the cloudflared repo` New: `- The flags exist in `cloudflared access tcp --help` (2026.10.3), which also reads `TUNNEL_SERVICE_TOKEN_ID` and `TUNNEL_SERVICE_TOKEN_SECRET`; the runner passes the token through these env vars, never argv. Spike result (write the real date and outcome from Task 2): <date>, <passed or failed>.`
  9. Section 8 table, row `Container memory`. After ``One multipart part buffered (32MiB by default).`` add the Task 17 measurement (real numbers, 32 MiB parts at 256m).
  10. Section 10 risk 1. Old: `1. Container-to-tunnel path depends on `cloudflared access tcp` with service-token flags that are not in the docs. Mitigated by the phase 4 spike.` New: `1. Container-to-tunnel path depends on `cloudflared access tcp` with a service token. The Phase 4 spike result is recorded in section 7.`
- [ ] Step 2: Verify - Run: `grep -c 'DOWNLOAD_FAILED' docs/PLAN.md; grep -c 'TUNNEL_SERVICE_TOKEN_ID' docs/PLAN.md; grep -c $'\xe2\x80\x94' docs/PLAN.md; grep -n '<date>' docs/PLAN.md | wc -l` - Expected: `1` or more, `1` or more, `0`, `0` (the `<date>` placeholder was replaced by the real spike date and outcome)
- [ ] Step 3: Verify - Run: `bun run test && bun run typecheck` - Expected: both exit 0; the test count is the Phase gate count plus 66 (10 new files)
- [ ] Step 4: Commit - `git add docs/PLAN.md && git commit -m "docs: update PLAN.md with the phase 4 runner contract, tunnel result, and memory result"`
- [ ] Step 5: Finish with the AGENTS.md phase summary (see the last section).

---

## Failure handling summary

- **Docker is missing or not running** - Detect: `docker info` fails. Respond: STOP and ask for Docker before Task 1. Do not skip the Docker verifies.
- **The tunnel spike fails (Task 2)** - Detect: no `SPIKE OK`. Respond: STOP and report the redacted output. Do not write a Worker-side proxy or a VM-side agent and do not continue to Task 3 without the owner's decision.
- **The S3 stand-in does not start or rejects valid requests (Tasks 15-17)** - Detect: `logs s3` shows a startup error, or `SignatureDoesNotMatch` with the correct key and secret. Respond: adjust the stand-in's environment minimally (up to 3 tries), then STOP and report. The signer itself is proven by the AWS vectors in Task 8, so suspect the region, path-style addressing, or the stand-in first.
- **The memory proof fails or the runner is OOM-killed (Task 17)** - Detect: the script prints `OOMKilled=true`, or a `FAIL` on the peak-memory line. Respond: STOP and report the printed numbers. Do not change the part size, the limit, or the code. The owner decides the next step (scratch table under "Closed by owner (round 2)").
- **A timing-based unit test fails once (Tasks 10, 11)** - Detect: a test using real timers fails on the first run. Respond: re-run that file once. If it fails again, report it; do not raise timeouts to hide a real ordering bug.
- **A download in the image build fails (Task 1)** - Detect: `curl` error or `sha256sum -c` mismatch. Respond: a checksum mismatch means STOP (the pinned binary changed); a network error means re-run once, then STOP.

## End-to-end verification

Run after Task 19, on the integrated tree. Docker is required.

- [ ] Run: `bun run test && bun run typecheck` - Expected: both exit 0; `bunx vitest run container/test` alone reports `Test Files  10 passed (10)` and `Tests  66 passed (66)`
- [ ] Run (bash): `docker build -f container/Dockerfile -t cellar-runner:dev . && bun container/e2e/run.ts | tee /tmp/cellar-e2e-final.log; echo "exit=${PIPESTATUS[0]}"; grep -c '^PASS' /tmp/cellar-e2e-final.log; grep -c '^FAIL' /tmp/cellar-e2e-final.log` - Expected: `exit=0`, `23`, `0` (test, backup, restore on PostgreSQL 14 and 17 with equal row counts, wrong password, bad R2 secret, expired deadline, invalid job, every callback HMAC-verified)
- [ ] Run (bash): `bun container/e2e/large.ts | tee /tmp/cellar-e2e-large-final.log; echo "exit=${PIPESTATUS[0]}"; grep -c '^PASS' /tmp/cellar-e2e-large-final.log; grep 'peak container memory' /tmp/cellar-e2e-large-final.log` - Expected: `exit=0`, `6`, and a peak line under 256 MiB with part size 32 MiB (owner answer 12). If this fails, the STOP rule from Task 17 still applies.
- [ ] Manual: `docker run --rm --entrypoint bash cellar-runner:dev -c 'env | grep -ciE "secret|password|token|access_key" || true'` - Expected: `0` (the image holds no credentials)
- [ ] Manual: `docker history --no-trunc cellar-runner:dev | grep -ciE 'cellar-test|rustfsadmin|AKIA' || true` - Expected: `0`
- [ ] Manual: `git diff --name-only <integration-branch>...phase-4-container | grep -vE '^(container/|test/docker-compose\.test\.yml$|test/fixtures/seed\.sql$|package\.json$|bun\.lock$|vitest\.config\.ts$|docs/PLAN\.md$|docs/plans/2026-10-24-phase-4-)' || echo scope-ok` - Expected: `scope-ok` (replace `<integration-branch>` with the branch Task 0 started from)
- [ ] Manual: `grep -rn $'\xe2\x80\x94' container test docs/PLAN.md docs/plans/2026-10-24-phase-4-container-image-job-runner.md | wc -l` - Expected: `0`
- [ ] 👤 Human: the owner confirms the Task 2 spike result (`SPIKE OK` through their real tunnel) and, if run, the Task 18 result - Expected: both recorded in the phase summary - Proxy: the 23-PASS Docker run above (same runner code through the test-only fake `cloudflared`) and the Task 10 unit tests (tunnel arguments and env)

When all boxes are ticked, end with the phase summary required by `AGENTS.md`:

- ✅ Completed: the image, the runner (`test`, `backup`, `restore`), the signed callbacks, the local stack, and the measured results.
- 🧪 Tests and results: `bun run test` and `bun run typecheck` counts; 66 container unit tests (including the 3 contract tests); the 23-PASS Docker run; the 2 GB memory run with its printed peak; the spike outcome with its date.
- ⚠️ Open issues and decisions needed. Include at least:
  - The Task 17 peak at 32 MiB parts under 256m, with the measured numbers (owner answer 12).
  - Reminder for Phase 10 docs: the R2 bucket lifecycle rule that aborts incomplete multipart uploads after 1 day is documented, never created by code.
  - For Phase 5: the Worker must answer 2xx for a `seq` it already applied; the job arrives on stdin only (`container.exec` with stdin `"pipe"`, see Decision 5); Phase 5 reuses `container/contract.ts` and `container/test/contract.test.ts` (owner answer 13); `image_build_context` must be the repo root; confirm that Wrangler honors `container/Dockerfile.dockerignore` or add a root `.dockerignore`; the job key is base64 and is the HMAC key after decoding.
  - `pg_restore` without `--single-transaction`: a failed restore can leave a half-restored database. Consider adding the flag (it makes a restore all or nothing but stops at the first error).
  - Not verified here: R2 itself (equal part sizes, SigV4 with region `auto`), the real `cloudflared` refusal text (`AUTH_PATTERN` in `container/pg.ts`), the `linux/amd64` image build, and Linux memory numbers.
