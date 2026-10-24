# Phase 7: Restore and download

Read AGENTS.md. Reuse the container `restore` command from Phase 4.

## Build
1. POST /api/backups/:id/download-url -> presigned R2 GET URL, expiry 15 minutes max. Audit log entry.
2. POST /api/backups/:id/restore with { destinationTargetId, confirmName }.
   - confirmName must exactly equal the destination target name, else 400.
   - Destination must have a restore_connection_url, else 400 with a clear message.
   - Response flags `sameDatabase: true` when restoring into the source target.
   - Creates a restore job row (reuse job states), enqueues it, audit log entry.
3. GET /api/restores/:id for status.

## Tests
- Wrong confirmName rejected
- Missing restore URL rejected
- Presigned URL expiry <= 15 min
- Audit rows for download and restore

## Done when
Tests and typecheck pass, and a local end-to-end restore into a scratch DB succeeds with matching row counts. Output the phase summary and stop.
