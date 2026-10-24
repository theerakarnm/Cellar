# Phase 2: Targets CRUD API + audit log

Read AGENTS.md and docs/PLAN.md. Phase 1 is complete (Access middleware, crypto, redact, schema exist). Reuse them, do not rewrite them.

## Build
1. Zod schemas in src/shared for target create/update: name, project tag, connection_url, restore_connection_url (optional), connection_mode (tunnel | direct), tunnel_hostname, tunnel service token id/secret, cron expression (validate it), timezone (validate IANA), retention policy fields, enabled, alert channel ids.
2. Routes: GET /api/targets, GET /api/targets/:id, POST /api/targets, PATCH /api/targets/:id, DELETE /api/targets/:id (soft delete, keeps backups).
3. Secrets encrypted before insert. Responses return only masked fields (host, port, db name, user). PATCH keeps existing secrets when the field is omitted.
4. Compute and store `next_run_at` from cron + timezone on create/update.
5. Audit log entry for every create/update/delete with actorEmail. GET /api/audit-logs (paginated).

## Tests
- Validation rejects bad cron, bad timezone, bad URL, missing tunnel fields in tunnel mode
- No response body ever contains the plaintext URL or token (assert on full JSON)
- PATCH without secrets keeps the old encrypted values
- next_run_at is correct for Asia/Bangkok and UTC examples
- Audit rows are written with the right actor

## Out of scope
No "Test connection" yet (needs the container). No UI.

## Done when
Tests and typecheck pass. Output the phase summary and stop.
