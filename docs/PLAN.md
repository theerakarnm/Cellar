# Cellar - Implementation Plan

Status: decisions answered by owner (2026-10-24, two rounds). Phase 1 not started. Research facts live in [research-notes.md](./research-notes.md).
Items marked [uncertain] were not confirmed by current docs.

## 1. Architecture

```mermaid
flowchart LR
  User[Operator browser] -->|Cloudflare Access login| Worker
  subgraph CF[Cloudflare]
    Worker[Worker: Hono API + static SPA]
    D1[(D1)]
    Q[[Queue: cellar-jobs]]
    Cron[Cron Trigger]
    DO[Container DO: JobRunner]
    C[Container: pg_dump / pg_restore / cloudflared]
    R2[(R2 bucket)]
    Access[Access: JWKS + TCP app]
  end
  subgraph VM[Customer VM - docker-compose]
    PG[(Postgres)]
    CFD[cloudflared tunnel]
    Web[web + api]
  end
  Cron -->|* * * * *: due targets, sweeper, retention| Worker
  Worker <--> D1
  Worker -->|enqueue job| Q
  Q -->|consumer| Worker
  Worker -->|start + payload| DO
  DO --> C
  C -->|cloudflared access tcp, service token| Access
  Access --> CFD --> PG
  C -->|S3 multipart, sha256 while streaming| R2
  C -->|HMAC-signed callback via outbound handler| Worker
  Worker -->|alerts| Chat[LINE / Discord]
  Worker -->|presigned GET| User
```

Flow summary:
1. The single per-minute cron finds due targets (idempotent per schedule slot) and enqueues one `backup` job each.
2. The queue consumer creates the `backups` row (`queued`), then starts a container through the DO.
3. The container opens a tunnel to Postgres, runs `pg_dump -Fc`, and streams it to R2 by multipart upload.
4. The container sends a signed callback. The Worker updates D1 and fires alerts on failure.

## 2. Repo structure

```
cellar/
  AGENTS.md
  README.md  LICENSE  CONTRIBUTING.md  SECURITY.md      (OSS files in phase 10)
  package.json  bun.lock  tsconfig.json  vitest.config.ts
  wrangler.jsonc  drizzle.config.ts  .dev.vars.example
  migrations/                  drizzle-kit SQL output
  docs/  PLAN.md  research-notes.md
  src/shared/                  Code shared by Worker and UI: zod schemas, tz.ts, cron.ts
  src/worker/
    index.ts                   Worker entry: fetch, scheduled, queue
    app.ts                     Hono app: routes and middleware wiring
    env.ts                     Env type
    middleware/  access.ts  error.ts
    routes/  targets.ts  backups.ts  restores.ts  alerts.ts  settings.ts  audit-logs.ts  internal.ts
    db/  schema.ts  client.ts
    lib/  crypto.ts  redact.ts  r2-key.ts  uuidv7.ts  audit.ts  api-error.ts  validate.ts  pagination.ts  s3-presign.ts
    retention/  types.ts  gfs.ts  runner.ts
    jobs/  dispatch.ts  consumer.ts  callback.ts  sweeper.ts
    alerts/  line.ts  discord.ts  staleness.ts
    container/  job-runner.ts  (Container class)
  container/                   image build context
    Dockerfile (FROM oven/bun:1.3.9-slim)  entrypoint.ts  jobs/ test-connection.ts backup.ts restore.ts
    tunnel.ts  multipart.ts  hmac.ts
  ui/                          Vite + React SPA (built into dist/ui, served as Static Assets)
  test/                        Vitest, mirrors src/ (test/worker/, test/shared/)
```

Notes:
- The container entrypoint is TypeScript and runs on Bun.
- `src/shared/` (`tz.ts`, `cron.ts`, `pg-url.ts`, `target-schema.ts`) holds code used by both the Worker and the UI, with tests in `test/shared/`. `src/worker/services/` holds the D1 logic that routes call. `test/helpers/` holds the shared D1/R2/Queue test harness (`getPlatformProxy`).
- Audit rows are written by `src/worker/lib/audit.ts` (a helper, not middleware). Services commit the audit insert in the same `db.batch` as the change.
- Cron grammar is numeric 5-field (no names, no @macros). A wall time inside a DST gap runs just after the gap; a wall time that happens twice runs once.
- `container/hmac.ts` is the single HMAC implementation (WebCrypto only). The Worker imports it by relative path.
- `DEV_BYPASS` is honoured only when its value is exactly `"true"` and the request host is `localhost`, `127.0.0.1`, or `[::1]`.
- Cron and timezone code is in-house in `src/shared/` (no dependency). Retention imports `getZonedParts` from `src/shared/tz.ts`.
- Connection mode is tunnel only. There is no direct mode.

## 3. D1 schema (Drizzle, SQLite)

All ids are text UUIDv7, from a small in-house generator (`src/worker/lib/uuidv7.ts`, `crypto.getRandomValues`, unit-tested, no dependency). All times are UTC ISO-8601 text.
Encrypted columns store `v1:<base64 iv>:<base64 ciphertext+tag>`. `ENCRYPTION_KEY` is base64 of exactly 32 bytes.

### targets
| column | type | notes |
|---|---|---|
| id | text PK | |
| name | text NOT NULL | unique among non-deleted targets (a deleted target's name can be reused) |
| project_tag | text | optional label |
| db_name | text NOT NULL | derived from the connection URL path (not a request field); used in R2 key; sanitized `[A-Za-z0-9_-]` |
| pg_version | integer | optional hint (13-18); detected on test |
| connection_url_enc | text NOT NULL | backup role URL, host = tunnel hostname |
| restore_url_enc | text | optional restore-capable URL |
| tunnel_hostname | text NOT NULL | Access TCP app hostname |
| tunnel_token_id_enc | text NOT NULL | Access service token client id |
| tunnel_token_secret_enc | text NOT NULL | Access service token client secret |
| schedule_cron | text NOT NULL DEFAULT '0 2 * * *' | 5-field cron, evaluated in `timezone` (default: daily 02:00) |
| timezone | text NOT NULL DEFAULT 'Asia/Bangkok' | IANA name |
| enabled | integer NOT NULL DEFAULT 1 | |
| keep_last | integer DEFAULT 3 | nullable = rule off |
| keep_daily | integer DEFAULT 7 | |
| keep_weekly | integer DEFAULT 4 | |
| keep_monthly | integer DEFAULT 6 | |
| max_age_days | integer | default null (off) |
| job_deadline_minutes | integer NOT NULL DEFAULT 120 | per-target job deadline |
| stale_after_hours | integer | null = derived from schedule, see section 6 |
| alert_failure_threshold | integer NOT NULL DEFAULT 3 | alert after N consecutive failures |
| next_run_at | text | UTC, indexed; slot already enqueued is never re-enqueued |
| last_backup_at | text | last success |
| last_status | text | |
| created_at, updated_at | text NOT NULL | |
| deleted_at | text | soft delete |

Indexes: `idx_targets_next_run (enabled, next_run_at) WHERE deleted_at IS NULL`; unique `uq_targets_name (name) WHERE deleted_at IS NULL`.

### backups
| column | type | notes |
|---|---|---|
| id | text PK | |
| target_id | text NOT NULL FK targets | |
| status | text NOT NULL | queued, running, success, failed, timed_out |
| trigger | text NOT NULL | `schedule` or `manual` |
| r2_key | text | set at start |
| size_bytes | integer | |
| sha256 | text | |
| pg_version_server | text | |
| attempt | integer NOT NULL DEFAULT 0 | |
| error_code | text | includes `queue_timeout` |
| duration_ms | integer | |
| error_message | text | redacted |
| schedule_slot | text | UTC slot for `trigger=schedule`; unique per target, makes enqueue idempotent |
| queued_at | text NOT NULL | |
| started_at, finished_at | text | |
| heartbeat_at | text | updated by progress callbacks |
| expires_at | text | informational, from last retention run |
| deleted_at | text | soft delete after R2 object removed |
| deleted_reason | text | e.g. `retention`, `manual` |

Indexes: `idx_backups_target_time (target_id, started_at DESC) WHERE deleted_at IS NULL`; `idx_backups_status (status, heartbeat_at)`; unique `(r2_key)`; unique `(target_id, schedule_slot) WHERE schedule_slot IS NOT NULL`.

### restores
| column | type | notes |
|---|---|---|
| id | text PK | |
| source_backup_id | text NOT NULL FK backups | |
| destination_target_id | text NOT NULL FK targets | chosen explicitly, no default |
| destination_db_name | text NOT NULL | existing database only |
| status | text NOT NULL | queued, running, success, failed, timed_out |
| actor | text NOT NULL | Access email |
| is_source_overwrite | integer NOT NULL | 1 when destination is the source database |
| error_code, error_message | text | redacted |
| queued_at, started_at, finished_at, heartbeat_at | text | |

Indexes: `(destination_target_id, queued_at DESC)`, `(source_backup_id)`, `(status, heartbeat_at)`.
Every restore also writes an `audit_logs` entry.

### alert_channels
| column | type | notes |
|---|---|---|
| id | text PK | |
| type | text NOT NULL | `line` or `discord` |
| name | text NOT NULL | |
| credential_enc | text NOT NULL | LINE token+to, or Discord webhook URL |
| events | text NOT NULL | JSON array: `backup_failed`, `backup_stale`, `retention_failed`, `restore_finished` |
| enabled | integer NOT NULL DEFAULT 1 | |
| created_at, updated_at | text NOT NULL | |

Index: `(enabled, type)`.

### target_alert_channels
| column | type | notes |
|---|---|---|
| target_id | text NOT NULL FK targets | |
| channel_id | text NOT NULL FK alert_channels | |

Composite primary key `(target_id, channel_id)`; index on `channel_id`.
A target with no linked channel gets no alerts.

### audit_logs
| column | type | notes |
|---|---|---|
| id | text PK | |
| at | text NOT NULL | |
| actor | text NOT NULL | Access email, or `system` |
| action | text NOT NULL | e.g. `target.create`, `backup.download`, `restore.start` |
| entity_type | text NOT NULL | |
| entity_id | text | |
| details | text | JSON, redacted |
| ip | text | |

Indexes: `(at DESC)`, `(entity_type, entity_id, at DESC)`.

### settings
| column | type | notes |
|---|---|---|
| key | text PK | |
| value | text NOT NULL | JSON |
| updated_at | text NOT NULL | |

Keys: `default_timezone` (Asia/Bangkok), `default_retention` (JSON, keep_last 3 / daily 7 / weekly 4 / monthly 6 / max_age_days null), `default_schedule` (`0 2 * * *`), `download_url_ttl_seconds` (max 900), `max_concurrent_jobs` (default `max_instances` - 1, which is 1), `retention_dry_run` (default `true` until the owner turns it off).

## 4. API routes

All routes sit under `/api`, require a valid Access JWT (except `GET /api/health`), and validate input with Zod.
Errors: `{ "error": { "code": string, "message": string, "details"?: unknown } }` with redacted messages. Codes: `validation_error` (400, `details` is `{ path, message }[]`), `unauthorized` (401), `not_found` (404), `conflict` (409), `internal_error` (500).
Lists use `?limit&cursor` and return `{ items, nextCursor }`.
Secrets are write-only: responses show `connection: { host, port, dbName, user }`, `hasRestoreUrl`, and `hasTunnelToken`, never a URL, token, or `*_enc` value.

| Method + path | Request | Response |
|---|---|---|
| GET /api/me | - | `{ email }` |
| GET /api/targets | `?limit&cursor` | `{ items: Target[], nextCursor }`, sorted by name |
| POST /api/targets | `{ name, projectTag?, connectionUrl, restoreUrl?, tunnel:{hostname,tokenId,tokenSecret}, scheduleCron?, timezone?, retention?:{keepLast?,daily?,weekly?,monthly?,maxAgeDays?}, jobDeadlineMinutes?, staleAfterHours?, alertFailureThreshold?, alertChannelIds?, enabled? }` (unknown keys are rejected; `alertFailureThreshold` is 1 to 100, default 3; omitted fields take the defaults in section 3; `db_name` is derived from the connection URL) | `201 Target` |
| GET /api/targets/:id | - | `Target` |
| PATCH /api/targets/:id | partial of POST body; omitted secret fields keep their stored values; each supplied `tunnel` part replaces only that part; `restoreUrl: null` and `projectTag: null` clear; `retention` merges per field; `alertChannelIds` replaces the set when present | `Target` |
| DELETE /api/targets/:id | - | `204`, soft delete: stops the schedule, keeps R2 data and history. No purge action in v1. |
| POST /api/targets/:id/test | - | `202 { testId }`. Runs a `test` container job. Poll `GET /api/targets/:id/test/:testId` for `{ status, result?, error? }`. Works on saved targets only. The UI saves a new target with `enabled = false`, then tests, then the user enables it. |
| POST /api/targets/:id/backup | - | `202 { backupId }` ("Backup now") |
| GET /api/targets/:id/backups | `?status&limit&cursor` | `{ items: Backup[], nextCursor }` |
| GET /api/backups/:id | - | `Backup` |
| POST /api/backups/:id/download-url | - | `{ url, expiresAt }` presigned R2 GET |
| POST /api/backups/:id/restore | `{ destinationTargetId, confirmName, acknowledgeOverwrite?: boolean }` | `202 { restoreId, sameDatabase }`. No default destination. `confirmName` must equal the destination target name (always required). When the destination is the source target, `acknowledgeOverwrite: true` is also required (400 otherwise). The destination must have a restore URL (400 otherwise). `409` if the destination has an active backup or restore. Never creates databases in v1. |
| GET /api/restores, GET /api/restores/:id | `?targetId&limit&cursor` | `{ items: Restore[], nextCursor }` / `Restore` |
| DELETE /api/backups/:id | `{ confirm: true }` | `204`. Success backups only. Refuses the latest success. Ignores retention dry run (explicit human action). Deletes R2 object first, then soft-deletes in D1, then writes an audit entry. |
| GET /api/targets/:id/retention-preview | - | `{ keep: id[], delete: id[], reasons }` no side effects |
| GET /api/alert-channels, POST, PATCH /:id, DELETE /:id | channel body (credentials write-only) | channel |
| POST /api/alert-channels/:id/test | - | `{ ok }` |
| GET /api/settings, PUT /api/settings | settings object | settings object |
| GET /api/audit-logs | `?entityType&entityId&limit&cursor` | `{ items, nextCursor }` |
| GET /api/health | - | `{ ok, version }` (unauthenticated; nothing about targets or config; every other `/api` route requires Access) |
| POST /internal/jobs/callback | signed payload (jobId in body), see section 5 | `200`. Reached via the container outbound handler if the spike confirms it, otherwise via the public URL with an Access bypass for this exact path only. |

`Target` fields: id, name, projectTag, dbName, connection (`{ host, port, dbName, user }`), hasRestoreUrl, hasTunnelToken, tunnelHostname, scheduleCron, timezone, enabled, retention, jobDeadlineMinutes, staleAfterHours, alertFailureThreshold, nextRunAt, lastBackupAt, lastStatus, alertChannelIds, stats (`{ backupCount, totalBackupBytes }`, counting only non-deleted success backups), createdAt, updatedAt.

## 5. Container job contract

### Dispatch
Queue message (small, under the 128KB limit):
`{ jobId, type: "test" | "backup" | "restore", targetId, attempt }`.
The consumer loads the target, decrypts secrets in memory only, and starts the container with the payload below.

### Input payload (Worker to container)
The container runs `bun run /app/entrypoint.ts` and reads this JSON from stdin. Secrets are never passed in command-line args or env vars. Phase 4 exports `signCallback`, and a contract test pins the payload and signature format so the Worker side (Phase 5) cannot drift from it:
```json
{
  "jobId": "string",
  "type": "test | backup | restore",
  "callbackUrl": "<outbound-handler host or public Worker URL>/internal/jobs/callback",
  "jobKey": "base64 32 bytes, per job, derived HMAC(ENCRYPTION_KEY-derived signing key, jobId)",
  "deadlineAt": "ISO",
  "db": { "url": "postgres://user:pass@127.0.0.1:{localPort}/dbname", "name": "dbname" },
  "tunnel": { "hostname": "db.example.com", "tokenId": "...", "tokenSecret": "...", "localPort": 15432 },
  "r2": { "endpoint": "https://<acct>.r2.cloudflarestorage.com", "bucket": "...", "key": "backups/...", "accessKeyId": "...", "secretAccessKey": "...", "partSizeBytes": 33554432 },
  "restore": { "sourceKey": "...", "targetDbName": "..." }
}
```
`r2` is used by backup and restore only. `restore` only by restore.
The R2 S3 credentials are a bucket-scoped R2 token stored as a Worker secret. They are injected into the container per job at runtime. They are never baked into the image, never logged, and never placed in queue messages (the message carries ids only). Presigned per-part URLs are a possible future hardening step.

### Container steps
- test: open tunnel, `SELECT version()`, check role has `pg_read_all_data`, report.
- backup: open tunnel, pick the `pg_dump` binary matching the server major version, run `pg_dump -Fc`, pipe stdout through a sha256 hasher into multipart parts (bounded buffer of one part, 32MiB by default), `CompleteMultipartUpload`, report. On any failure, `AbortMultipartUpload`.
- restore: stream the R2 object into `pg_restore` over the tunnel using the restore URL.
- Always: send a heartbeat callback every 30s, redact all output before sending.
- Memory: part size is a config value (`partSizeBytes`, default 32MiB). Peak is about one part plus pg_dump and cloudflared overhead. The local memory test runs at 256MB; `basic` has 1GiB. No local disk for the dump.

### Callback payload (container to Worker)
```json
{
  "jobId": "string",
  "event": "started | progress | succeeded | failed",
  "at": "ISO",
  "seq": 1,
  "result": { "sizeBytes": 0, "sha256": "hex", "pgServerVersion": "16.3", "durationMs": 0, "partCount": 0 },
  "error": { "code": "TUNNEL_FAILED | AUTH_FAILED | DUMP_FAILED | UPLOAD_FAILED | TIMEOUT | UNKNOWN", "message": "redacted" }
}
```

### HMAC signing
- Headers: `X-Cellar-Timestamp` (unix seconds), `X-Cellar-Signature` = hex `HMAC-SHA256(jobKey, timestamp + "." + jobId + "." + rawBody)`.
- The Worker recomputes `jobKey` from jobId (nothing stored), checks the signature with constant-time compare, rejects timestamps outside a 5 minute window, and ignores callbacks for jobs not in `queued` or `running`.
- Replay protection: `seq` must be greater than the last seen, and a terminal event is applied once.
- HMAC + timestamp + replay protection apply in BOTH callback paths (outbound handler and public route).
- If the public route is used, the Access middleware bypasses `/internal/jobs/callback` only, and the Access app needs a matching bypass policy for that exact path.

## 6. Job state machine

```mermaid
stateDiagram-v2
  [*] --> queued: enqueue
  queued --> running: container "started" callback
  queued --> failed: start error after retries
  running --> success: "succeeded" callback
  running --> failed: "failed" callback
  running --> timed_out: sweeper, no heartbeat or past deadline
  queued --> failed: sweeper, queue_timeout after 1h
  failed --> queued: queue retry (attempt < max)
  success --> [*]
  failed --> [*]
  timed_out --> [*]
```

Rules:
- Only forward transitions. Terminal states never change.
- Only one `queued`/`running` backup per target at a time. A second request returns `409`.
- Heartbeat: the container sends one every 30s.
- Sweeper (every cron tick):
  - `running` with no heartbeat for 5 minutes, or past its deadline (`started_at + job_deadline_minutes`, default 2 hours), becomes `timed_out`. The sweeper also stops the container.
  - `queued` for more than 1 hour becomes `failed` with `error_code = queue_timeout`. (The diagram's `queued -> timed_out` edge is replaced by this.)
- The same rules apply to `restores`.
- Concurrency: `max_instances` is 2 (configurable). `max_concurrent_jobs` counts scheduled and manual backups only and defaults to `max_instances` - 1, so one instance stays free for a restore or a test connection.
- Staleness: a target is stale when it has no successful backup within `stale_after_hours`. Default = expected interval of `schedule_cron` + 2h (daily = 26h). The per-target `stale_after_hours` overrides it.
- On `failed` or `timed_out`, fire `backup_failed` alerts and never delete anything.
- Orphan multipart uploads are aborted on failure. The R2 default lifecycle also aborts incomplete uploads after 7 days.

## 7. Tunnel from Container: chosen approach

Chosen: run `cloudflared access tcp` inside the container, authenticated with an Access service token.

```
cloudflared access tcp --hostname db.example.com --url 127.0.0.1:15432 \
  --service-token-id $ID --service-token-secret $SECRET
```
Then `pg_dump` connects to `127.0.0.1:15432`. The image installs `cloudflared` and postgresql-client 13-18.

Setup per VM: a named Tunnel with a public hostname of type TCP (`tcp://postgres:5432`), a self-hosted Access application on that hostname, and a Service Auth policy that allows only Cellar's service token.

Reasoning:
- Workers VPC / VPC Services bindings are Worker-only. The docs show no path from a Container to them. [uncertain]
  Sources: [Containers outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/), [Workers VPC](https://developers.cloudflare.com/workers-vpc/), [VPC services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).
- A Container cannot be proxied through a Worker for a long `pg_dump` TCP session without extra machinery. Hyperdrive is query-oriented and not suited to `pg_dump`. [Hyperdrive private DB](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database/)
- `cloudflared access tcp` is the documented way to reach a TCP app behind Access from a client: [arbitrary TCP](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/), [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
- Needs outbound 443 from the container. Containers have internet egress by default. [Outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)
- The `--service-token-id/--service-token-secret` flags were verified in the cloudflared repo, not in the current docs pages. [uncertain] The first task of Phase 4 is a spike that proves this path, before the runner is built (see below).

Spike (first task of Phase 4), run with the owner's approval of any Cloudflare resources:
1. A container reaches a real Postgres through `cloudflared access tcp` with a service token, and runs `SELECT version()` and a small `pg_dump -Fc` to R2.
2. The same container calls back to the Worker through the outbound handler.
3. If step 1 fails: STOP and report. Do not build a fallback without owner approval.
4. If step 2 cannot be confirmed: use the public `/internal/jobs/callback` with an Access bypass for that path only.

Fallback options, only with owner approval (neither is started by default):
- A. Worker-side TCP proxy for the container. Likely to hit CPU and duration limits on large dumps, so it is the less preferred option.
- B. A VM-side agent in the docker-compose stack: it runs `pg_dump` next to Postgres and uploads to R2 itself, and Cellar only schedules and tracks it. This changes the architecture, because Cellar no longer owns the dump process.

Callback path: the container calls the Worker through an outbound handler (`outboundByHost`), which runs inside the Workers runtime. [Container class](https://developers.cloudflare.com/containers/api/container-class/), [Workers connections](https://developers.cloudflare.com/containers/configuration/workers-connections/). Fallback if the spike cannot confirm it: the public route `/internal/jobs/callback` with an Access bypass for that path only. HMAC, timestamp, and replay checks stay in both cases. [uncertain]

R2 path: the container writes to R2 over the S3 API with a bucket-scoped token, so the dump never passes through a Worker. [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/), [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/)

## 8. Cloudflare limits and mitigations

Values come from [research-notes.md](./research-notes.md). Re-check before each phase.

| Area | Limit | Source | Impact / mitigation |
|---|---|---|---|
| Container disk | 2GB (lite) to 20GB per instance; image size counts against it | [limits](https://developers.cloudflare.com/containers/platform/limits/) | Never write the dump to disk: stream. Use a larger `instance_type` only for the log/temp space needed. |
| Container memory | 256MiB (lite) to 12GiB | same | One multipart part buffered (32MiB by default). Default `basic` (1/4 vCPU, 1GiB, 4GB disk), set by one config value (`instance_type` in `wrangler.jsonc`). `max_instances` is 2, also a config value. |
| Container runtime | `sleepAfter` default 10m; SIGTERM then 15m grace. No hard max documented [uncertain] | [Container class](https://developers.cloudflare.com/containers/api/container-class/) | Keep the container active with heartbeat traffic; set `sleepAfter` above the longest job. Roll-outs can stop containers mid-job, so the sweeper plus retry covers it. |
| Container image storage | 50GB per account | limits | One image, pinned versions. |
| R2 multipart | parts 5MiB-5GiB, max 10,000 parts, object max 5TiB | [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) | Part size is a config value, default 32MiB (needed to stay under the 256MB local memory test). 32MiB x 10,000 parts = 320,000MiB (about 312GiB, 335GB) per dump. That is far above the largest database today (about 1GB, planned for 3 years). A larger database needs a larger part size. |
| R2 incomplete uploads | auto-abort after 7 days by default | [lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) | Also abort explicitly on failure. Recommended bucket rule, documented but never created by code: abort incomplete multipart uploads after 1 day. Failed or aborted uploads are cleaned up by this rule, not by retention. |
| Queues | batch default 10 (max 100), msg 128KB, retries default 3, DLQ per consumer | [queues limits](https://developers.cloudflare.com/queues/platform/limits/), [retries](https://developers.cloudflare.com/queues/configuration/batching-retries/) | `max_batch_size: 1`, small messages (ids only). Container work is long, so do not hold the queue handler open: consumer starts the job and returns, and the callback finishes it. |
| Cron | UTC only; 5/account Free, 250 Paid; up to 15 min config propagation | [cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/) | One cron `* * * * *` does everything. Per-target cron and timezone are computed in code into `next_run_at` (UTC). |
| D1 | 10GB per DB, 100 bound params, 30s per query, 2MB row | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | Chunk `IN (...)` lists in retention to under 100 params. Prune audit logs if needed. |
| Workers | CPU and subrequest limits per invocation | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | Retention runner handles a bounded number of deletes per tick. |
| Access JWT keys | rotate about every 6 weeks, old key valid 7 days | [validating JSON](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) | Cache JWKS with a short TTL; refetch on unknown `kid`. |

Large-database mitigations:
- Streaming only, no local disk. Part size comes from config; the job fails with a clear error if the dump would need more than 10,000 parts.
- `pg_dump -Fc` compresses; parallel `-j` is not available with stdout streaming, so one stream per dump.
- Heartbeat while uploading so the sweeper does not kill long jobs.
- Per-target `job_deadline_minutes` (default 120).
- Restore may need a local file for parallel restore. We stream into a single `pg_restore` and accept no `-j`. [uncertain: confirm `pg_restore` from stdin works for `-Fc`; it does, but without parallelism]

## 9. Cost estimate

Assumptions: `basic` instance (1/4 vCPU, 1GiB, 4GB disk), 5 minutes per job, one backup per target per day.
Prices from [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/) (CPU $0.000020 per vCPU-s with 375 vCPU-min included; memory $0.0000025 per GiB-s with 25 GiB-h included). R2 storage is $0.015 per GB-month with 10GB free [uncertain: re-check R2 pricing page].

| Item | 10 targets | 30 targets |
|---|---|---|
| Workers Paid base | $5.00 | $5.00 |
| Container compute (CPU + memory + disk, after free allowance) | $0 | about $1.38 |
| R2 storage, worst case (1GB dump, 20 retained per target) | about $2.85 | about $8.85 |
| R2 storage, if dumps compress to 300MB | about $0.75 | about $2.55 |
| Total, worst case | about $7.85 | about $15.20 |
| Total, compressed | about $5.75 | about $8.93 |

Container compute math (5 minutes per job, one job per target per day, 30 days):
- 10 targets: 300 jobs x 300s = 90,000s. CPU 22,500 vCPU-s (375 vCPU-min, exactly the free allowance). Memory 25 GiB-h (exactly the free allowance). Disk 100 GB-h. All free.
- 30 targets: 270,000s. CPU 45,000 vCPU-s over the allowance x $0.000020 = $0.90. Memory 50 GiB-h over x 3600 x $0.0000025 = $0.45. Disk about $0.03.
- Test and restore jobs add a little on top.

Decision (owner): the cost ceiling is **$10/month**, replacing the earlier $5 ceiling. Workers Paid alone is $5/month and Containers requires it.
With 10 targets the estimate is $5.75 to $7.85, inside the ceiling.
With 30 targets the worst case ($15.20) exceeds it. Revisit retention or the ceiling before growing past about 20 targets.
The estimate is rough and uses assumed run times. Real numbers come after the phase 4 spike.

## 10. Risks and open questions

Risks:
1. Container-to-tunnel path depends on `cloudflared access tcp` with service-token flags that are not in the docs. Mitigated by the phase 4 spike.
2. Containers are in beta, and limits or API may change. Pin versions; recheck docs per phase.
3. No documented hard max runtime for containers. Very long dumps could be cut by deploy rollouts.
4. R2 S3 credentials live inside the container for the job duration. Scope the token to one bucket; rotate on schedule.
5. A restore is destructive on the target DB. Needs the typed target name, an extra acknowledgement for the source database, and an audit log row.
9. 32MiB parts cap a single dump at about 335GB. Fine for today (1GB), but a much larger database needs a larger part size.
6. Dump versions: `pg_dump` must be at least the server major version. Pick the binary by detected server version.
7. Clock and timezone logic (DST) in schedule evaluation. Asia/Bangkok has no DST, other zones do.
8. Access JWT misconfiguration (wrong `aud`) would block all users or let all in. Needs tests.

Open questions for the owner: none. Items closed: cost ceiling ($10/month), restore without `pg_restore -j`, manual delete confirmed by `{ confirm: true }`, direct mode removed, name reuse after soft delete.

## 11. Phases (unchanged)

1. Scaffold, config, D1 schema, Access middleware, crypto util
2. Targets CRUD API + audit log
3. Retention pure function + tests
4. Container image + job runner (test connection, backup to R2)
5. Orchestration: cron, queue, container binding, callback, Backup now, stale sweeper
6. Retention runner wired to R2
7. Restore + download
8. Alerts (LINE, Discord, staleness)
9. UI
10. Docs + OSS files
