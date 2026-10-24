# Phase 9: React UI

Read AGENTS.md and docs/PLAN.md. The API is complete. Build only UI against the existing API. Do not change API behavior; if an endpoint is missing, stop and ask.

## Pages
1. Dashboard: all targets with last status, last success time, next run, total R2 size. Failing or stale targets highlighted red.
2. Targets list + create/edit form with inline validation and a Test connection button.
3. Target detail: backup history table, Backup now, download, restore dialog (type the name to confirm, extra warning when same DB), retention preview.
4. Settings: alert channels (with Test), global concurrency, retention dry-run toggle, audit log viewer.

## Rules
- Times shown in the target's timezone.
- Secrets fields are write-only: show "set" / "not set", never values.
- Works at 375px and 1440px widths.
- Minimal dependencies: React, React Router, a fetch wrapper. Ask before adding a UI kit.

## Done when
`bun run dev` serves the UI, every page works against local data, typecheck passes. Output the phase summary and stop.
