# Phase 3: GFS retention decision function (pure, no I/O)

Read AGENTS.md. This phase touches ONLY src/worker/retention/ and its tests.

## Build
`selectBackupsToDelete(backups, policy, now, tz): { keep: Backup[], delete: Backup[], reasons: Record<id, string[]> }`
- Inputs: list of backups (id, status, created_at), policy { keep_last, daily, weekly, monthly, max_age_days? }, now, IANA timezone.
- Only `success` backups are candidates. Ignore failed/running ones entirely (never delete them here).
- Daily/weekly/monthly buckets use the target timezone. Within a bucket keep the NEWEST backup. Weeks start Monday (ISO week).
- A backup is kept if ANY rule keeps it. `reasons` lists which rules kept it.
- max_age_days removes anything older, EXCEPT the safety rule.
- Safety rule: the most recent success backup is ALWAYS kept, even if every rule is 0.
- Pure and deterministic. No Date.now() inside.

## Tests (must all exist)
- Empty list; one backup with all-zero policy -> kept
- Multiple backups same day -> newest kept for daily
- Gaps in history (missing days/weeks)
- Day boundary differs between UTC and Asia/Bangkok
- Week and month boundaries, year rollover
- max_age_days older than everything -> only latest kept
- failed backups never appear in delete list
- Example from README: keep_last=3, daily=7, weekly=4, monthly=6 over 200 days of daily backups -> assert exact kept count

## Done when
Tests and typecheck pass. Output the phase summary and stop.
