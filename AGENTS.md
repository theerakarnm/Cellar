# Cellar - agent instructions

Cellar is an open source (MIT), Cloudflare-native platform.
It backs up many self-hosted Postgres databases to Cloudflare R2.
Each database runs inside docker-compose on a VM, next to web and api services.
Features: schedules, GFS retention, auto-delete of expired backups, restore, download, failure alerts.

## Stack (locked)

- TypeScript everywhere.
- Bun is the package manager and test runner entry. `bun run test` runs Vitest.
- Worker: Hono on Cloudflare Workers.
- UI: React + Vite SPA, served via Workers Static Assets.
- D1 + Drizzle ORM. Migrations live in `/migrations`.
- R2 stores backup files.
- Cloudflare Queues dispatch jobs.
- Cloudflare Containers run `pg_dump`, `pg_restore`, and connection tests. Workers cannot run these binaries.
  Image: `oven/bun:1.3.9-slim` (Debian slim) with postgresql-client 13-18 and `cloudflared`. The container runs on Bun.
  Default instance type is `basic`, set by one config value.
- Zod validates every API input.
- Vitest runs tests.
- Auth: Cloudflare Access.
  The Worker verifies `Cf-Access-Jwt-Assertion` on every request except `GET /api/health` (JWKS signature, `aud`, `exp`).
  Health returns only `{ ok, version }`: nothing about targets or config.
  A `DEV_BYPASS` env var may skip this only in local dev (value exactly `"true"` and a localhost host).
- DB reachability: Cloudflare Tunnel (`cloudflared`) on each VM. Postgres ports are never public.
  Connection mode is tunnel only. There is no direct mode.
- Default timezone is Asia/Bangkok. It is configurable per target.
- Local tests use RustFS as an S3 stand-in. It is test and dev only and never in the production image.
- No UI or component tests in v1 (no jsdom, no Testing Library). Rely on API and unit tests.
- IDs are UUIDv7 from a small in-house generator (no dependency).
- Cron: one `* * * * *` trigger. `next_run_at` is computed in code per target timezone, idempotent per slot.

## Domain rules (locked)

- Connection URLs, tunnel service tokens, and alert credentials are encrypted at rest.
  Use AES-256-GCM via WebCrypto. The key comes from the `ENCRYPTION_KEY` secret.
  Never return them in plaintext after save. Never log them.
- R2 credentials are a bucket-scoped token injected per job at runtime.
  Never bake them into the image, never log them, never put them in queue messages.
- Backups use `pg_dump -Fc`, streamed to R2 via multipart upload.
  Compute sha256 while streaming.
  Never buffer the whole dump on disk or in memory.
- Multipart part size is a config value, default 32 MiB (about 335 GB max per dump at 10,000 parts).
  A bucket lifecycle rule aborts incomplete multipart uploads after 1 day. It is documented, never created by code.
- R2 key: `backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump`
- Retention is GFS: `keep_last`, `daily`, `weekly`, `monthly`, optional `max_age_days`.
  A backup is kept if ANY rule keeps it.
  The most recent successful backup of a target is NEVER deleted.
  Deletion order: delete the R2 object first, then soft-delete the D1 row.
- The backup role is read-only (`pg_read_all_data`).
  Restore uses a separate restore-capable connection URL supplied by the user.
- `max_instances` defaults to 2 and is configurable. `max_concurrent_jobs` defaults to `max_instances` - 1, so one instance stays free for a restore or test connection. Restores and tests do not count toward it.
- Cellar does logical backups only. No PITR, no WAL archiving.

## Working rules (every session)

- Only build what the current phase prompt asks. No extra features, abstractions, or files.
- Never hardcode secrets. Document every secret in `.dev.vars.example`.
- Redact connection strings and passwords from logs, errors, API responses, and alerts.
- Do not guess Cloudflare limits or APIs. Check current docs. Write [uncertain] when unsure.
- Stop and ask before:
  - creating, modifying, or deleting real Cloudflare resources
  - running `wrangler deploy` or any remote command
  - adding a dependency not listed above
  - changing a locked decision
  - any data-deleting operation
  - implementing a tunnel fallback (Worker-side TCP proxy or VM-side agent) if the Phase 4 spike fails
- Restore has no default destination.
  The typed destination target name is always required.
  Restoring into the source database also needs `acknowledgeOverwrite: true`.
  A restore returns 409 when the destination has an active backup or restore.
- Deleting a target is a soft delete. R2 data and history are kept. There is no purge in v1. A deleted target's name can be reused.
- Manual backup delete works on success backups only, ignores retention dry run, and is audited. Retention skips soft-deleted targets. Retention dry run stays on until the owner turns it off.
- Allowed Discord webhook URLs start with `https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`. Reject everything else.
- Never send plaintext secrets through the queue. Test connection runs on saved targets only.
- If the same step fails 3 times, stop and report what you tried.
- End every phase with `bun run test` and `bun run typecheck` passing, then this summary:
  - ✅ Completed
  - 🧪 Tests and results
  - ⚠️ Open issues and decisions needed
