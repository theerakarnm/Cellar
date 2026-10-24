# Phase 6: Wire retention to R2 and D1

Read AGENTS.md. Use the pure function from src/worker/retention/ unchanged. If you think it needs a change, stop and ask.

## Build
1. `runRetention(targetId)`: load success backups, call selectBackupsToDelete, for each deletion: delete R2 object, then soft-delete the D1 row (status deleted, deleted_at, reason). Write an audit row per deletion (actor = "system").
2. If an R2 delete fails, keep the D1 row unchanged and continue with the next. Report failures.
3. Trigger after every successful backup callback, and once daily from the cron for all targets.
4. GET /api/targets/:id/retention-preview -> what would be deleted now, with reasons. No side effects.
5. Settings flag `retention_dry_run` (default true until I turn it off): logs decisions without deleting.

## Tests
- Integration test with local R2 binding + local D1: correct objects removed, rows soft-deleted
- R2 failure leaves D1 consistent
- Dry run deletes nothing
- Preview matches what the runner would do

## Done when
Tests and typecheck pass. Output the phase summary and stop.
