# Restore runbook

This page explains how to restore a Cellar backup.
Backups are PostgreSQL custom-format dumps (`pg_dump -Fc`).
You can restore from the dashboard or by hand with `pg_restore`.

Restoring is destructive.
Cellar runs `pg_restore --clean --if-exists --no-owner --no-password` into the destination database.
`--clean --if-exists` drops and recreates the objects that are in the dump.
Objects that are not in the dump stay as they are.
Cellar does not wrap the restore in one transaction, so a failed restore can leave the database partly restored.
Practice on a scratch database first.

## Before you start

- Pick the destination target.
  Cellar has no default destination.
- The destination target must have a **restore connection URL**.
  The database named in that URL is the database that gets restored.
  Cellar never creates databases, so that database must already exist.
- Use a restore role, not the backup role.
  See [Restore role](vm-onboarding.md#4-restore-role).
- Cellar picks `pg_restore` by the major version of the destination server.
  Cellar supports PostgreSQL 13 to 18.

## Restore from the dashboard

1. Open the source target and find the backup in the history table.
   Only backups with status `success` that are not deleted can be restored.
2. Select **Restore**.
3. Choose the destination target.
   Targets without a restore URL are disabled in the list.
4. If the destination is the source target, the dialog shows a warning and a checkbox labelled **I understand this overwrites the source database**.
   Tick the box.
   Without it, Cellar rejects the request with `400`.
5. Type the destination target name in the confirm field.
   The typed name must match the destination target name exactly.
   This is always required.
6. Select **Restore**.
   Cellar queues the restore job and returns `202`.
   If the destination already has a backup or restore that is queued or running, Cellar returns `409`.
   Wait for that job to finish and try again.
7. Watch the status in the dialog.
   The status is one of `queued`, `running`, `success`, `failed`, or `timed_out`.
   A failed restore shows a redacted error message.

Closing the dialog does not stop the restore.
The result is not shown on the page after you close the dialog.
Check the status again with `GET /api/restores/:id`.

Every restore is written to the audit log as `restore.start` with the person who started it.

### Restore request

The dashboard sends this request:

```http
POST /api/backups/:id/restore
Content-Type: application/json

{ "destinationTargetId": "<target-id>", "confirmName": "<destination target name>", "acknowledgeOverwrite": true }
```

- `destinationTargetId` and `confirmName` are always required.
- `acknowledgeOverwrite` must be `true` when `destinationTargetId` is the backup's own target.
  For another target it may be omitted.
- The response is `202` with `{ "restoreId": "...", "sameDatabase": true }`.
- Common errors are `400` (validation, or `restore_url_missing` or `restore_url_invalid` on the destination), `404` (backup or destination not found), `409` (the backup is not available, or the destination is busy), and `503` (`enqueue_failed`, try again).

## Download a backup

1. In the dashboard, select **Download** on the backup.
   The browser opens a presigned R2 link.
2. The API request is `POST /api/backups/:id/download-url`.
   It returns `{ "url": "...", "expiresAt": "..." }`.
   The response has `Cache-Control: no-store`.
3. The link expires after `download_url_ttl_seconds`, which is 900 seconds (15 minutes) at most.
   Request a new link when it expires.

The download link is never written to the audit log.
The audit log only records `backup.download` with the backup id.

## Restore by hand

Use this when the dashboard is not available or when you want to restore on your own machine.

1. Get a download link.
   See [Download a backup](#download-a-backup).
2. Download the file:

   ```bash
   curl -fL -o backup.dump "<presigned-url>"
   ```

3. Check the checksum.
   It must equal the `sha256` value of the backup.
   The API returns this value in `GET /api/targets/:id/backups`.
   Cellar does not check the checksum of the file you download.
   You must check it yourself:

   ```bash
   shasum -a 256 backup.dump
   ```

4. Check that the archive is readable:

   ```bash
   pg_restore --list backup.dump | head
   ```

5. Create an empty scratch database on the server you restore to:

   ```bash
   createdb -h <host> -U <restore-role> shop_restore_test
   ```

6. Restore:

   ```bash
   pg_restore --clean --if-exists --no-owner -h <host> -U <restore-role> -d shop_restore_test backup.dump
   ```

   `pg_restore` prints a message for each object that it cannot drop on a fresh database.
   With `--if-exists` those messages are not errors.
   Real errors stop the object they belong to.
   Read the output before you trust the result.

Use a `pg_restore` that is at least as new as the `pg_dump` that made the file.
Using the same major version as the destination server is the safest choice.

## If a restore fails

A restore can fail after it has changed some objects.
Cellar does not roll the database back.
Follow these steps:

1. Read the error code and message in the dashboard, or in `GET /api/restores/:id`.
   Common codes are RESTORE_FAILED, DOWNLOAD_FAILED, TIMEOUT, start_failed, queue_timeout, backup_unavailable, and target_unavailable.
2. Do not use the database for traffic until the restore succeeds.
   If the restore was into the live database, the data is in an unknown state.
3. Fix the cause.
   Examples are a wrong restore URL, a missing database, a `pg_restore` that is too old, or a network problem.
4. Run the restore again from the dashboard, or by hand with the same file.
   The `--clean --if-exists` flags drop and recreate the objects in the dump, so a second run replaces the partial state.
   If the database has objects that are not in the dump, remove them yourself.
5. If the destination is a scratch database, drop it and create it again.

A restore that shows `timed_out` may still be running on the container.
Cellar stops the container when the sweeper marks the restore as timed out.
Check the status again before you start a second restore.

## Verify a restore

Compare the restored database with the source, or with what you expect.

Count the rows of every table in both databases and compare the two lists:

```bash
cat > counts.sql <<'SQL'
SELECT format('SELECT %L AS table_name, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1 \gexec
SQL

psql -h <source-host> -U <role> -d shop -At -f counts.sql > source-counts.txt
psql -h <host> -U <restore-role> -d shop_restore_test -At -f counts.sql > restored-counts.txt
diff source-counts.txt restored-counts.txt && echo identical
```

Counts differ if the source took writes after the backup finished.
Compare against the backup time, not against the live source.

Then run two or three queries that your application depends on and check the answers.

When you are done with a scratch database, drop it:

```bash
dropdb -h <host> -U <restore-role> shop_restore_test
```
