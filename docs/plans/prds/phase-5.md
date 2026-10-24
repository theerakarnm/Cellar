# Phase 5: Orchestration - cron, queue, container binding, callback, Backup now

Read AGENTS.md and docs/PLAN.md. Phases 1-4 are done. Reuse existing code.

## Build
1. wrangler.jsonc: Cron Trigger every 5 minutes, Queue producer/consumer, Container + Durable Object binding per PLAN.md.
2. Cron handler: find enabled targets with next_run_at <= now, create `queued` backup rows, enqueue jobs, advance next_run_at. Idempotent if the cron fires twice.
3. Queue consumer: enforce one running job per target and the global concurrency limit (settings table). Start the container with the decrypted job payload. Mark `running`.
4. POST /internal/jobs/callback: verify HMAC + timestamp (reject replays older than 5 min), update the backup row (success/failed, size, checksum, pg version, duration, redacted error). Not reachable through Access-protected UI routes.
5. POST /api/targets/:id/backup (Backup now) and POST /api/targets/:id/test (Test connection, waits for result or returns a job id to poll).
6. Stale sweeper inside the cron: running jobs older than the timeout -> timed_out.
7. GET /api/targets/:id/backups (history, paginated).

## Tests
- Cron idempotency, no double enqueue for the same slot
- Concurrency limits respected
- Callback: bad signature 401, replay rejected, valid updates row
- Stale sweeper marks only the right rows
- Decrypted secrets never appear in queue messages written to logs

## Stop and ask before
Deploying, or creating any real Queue, Container, or bucket.

## Done when
Tests and typecheck pass, and `bun run dev` can run a full Backup now against the Phase 4 local test setup. Output the phase summary and stop.
