# Phase 8: Alerts - LINE, Discord, staleness

Read AGENTS.md.

## Build
1. Alert channels CRUD: /api/alert-channels. Types: `line` (channel access token + to id), `discord` (webhook URL). Credentials encrypted, masked in responses. POST /api/alert-channels/:id/test sends a test message.
2. Triggers:
   - backup failed or timed_out
   - N consecutive failures (per-target setting, default 3)
   - staleness: no success within X hours (per-target setting), checked in the cron, alert once per stale episode (not every 5 minutes)
3. Message: target name, project tag, event, redacted error summary, time in target timezone, link to the target page.
4. Alert sending failures are logged but never fail the backup flow.

## Tests
- Each trigger fires exactly once per episode
- Messages never contain connection URLs or secrets (assert with real-looking secrets)
- LINE and Discord payload shapes (mock fetch)

## Done when
Tests and typecheck pass. Output the phase summary and stop.
