import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, listAll, withQuery } from "../api/client";
import { useLoad } from "../api/hooks";
import type { Backup, Page, RetentionPreview, TargetSummary } from "../api/types";
import { RestoreDialog } from "../components/RestoreDialog";
import { TestConnection } from "../components/TestConnection";
import { ErrorNote, HealthBadge, Loading, SecretBadge, StatusBadge } from "../components/ui";
import { connectionLabel, formatBytes, formatDuration } from "../lib/display";
import { deletionRows } from "../lib/preview";
import { classifyTarget, isActiveStatus } from "../lib/status";
import { formatInTimeZone } from "../lib/time";

export function TargetDetail() {
  const { id = "" } = useParams();
  const target = useLoad(() => api<TargetSummary>("GET", `/api/targets/${id}`), [id]);
  if (target.error) return <ErrorNote error={target.error} />;
  if (!target.data) return <Loading loading hasData={false} />;
  return <TargetView target={target.data} onChanged={target.reload} />;
}

function TargetView({ target, onChanged }: { target: TargetSummary; onChanged: () => void }) {
  const tz = target.timezone;
  const first = useLoad(() => api<Page<Backup>>("GET", withQuery(`/api/targets/${target.id}/backups`, { limit: 25 })), [target.id], (page) =>
    page.items.some((b) => isActiveStatus(b.status)) ? 5000 : null,
  );
  const [more, setMore] = useState<Backup[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [loadError, setLoadError] = useState<Error | undefined>();
  const [actionError, setActionError] = useState<Error | undefined>();
  const [restoreFrom, setRestoreFrom] = useState<Backup | undefined>();
  const [preview, setPreview] = useState<RetentionPreview | undefined>();
  const allTargets = useLoad(() => listAll<TargetSummary>("/api/targets"), []);

  const backups = [...(first.data?.items ?? []), ...more];
  const nextCursor = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;
  const health = classifyTarget(target, new Date());
  const fail = (e: unknown) => setActionError(e instanceof Error ? e : new Error(String(e)));

  async function backupNow() {
    setActionError(undefined);
    try {
      await api("POST", `/api/targets/${target.id}/backup`);
      setMore([]);
      setCursor(undefined);
      first.reload();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api<Page<Backup>>("GET", withQuery(`/api/targets/${target.id}/backups`, { limit: 25, cursor: nextCursor }));
      setMore((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setLoadError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async function download(backup: Backup) {
    setActionError(undefined);
    try {
      const { url } = await api<{ url: string; expiresAt: string }>("POST", `/api/backups/${backup.id}/download-url`);
      window.location.assign(url);
    } catch (e) {
      fail(e);
    }
  }

  async function remove(backup: Backup) {
    if (!window.confirm("Delete this backup? The file is removed from R2 and cannot be recovered.")) return;
    setActionError(undefined);
    try {
      await api("DELETE", `/api/backups/${backup.id}`, { confirm: true });
      setMore([]);
      setCursor(undefined);
      first.reload();
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  async function enable() {
    setActionError(undefined);
    try {
      await api("PATCH", `/api/targets/${target.id}`, { enabled: true });
      onChanged();
    } catch (e) {
      fail(e);
    }
  }

  async function showPreview() {
    setActionError(undefined);
    try {
      setPreview(await api<RetentionPreview>("GET", `/api/targets/${target.id}/retention-preview`));
    } catch (e) {
      fail(e);
    }
  }

  const rows = preview ? deletionRows(preview, backups) : [];
  return (
    <>
      <div className="page-head">
        <h1>
          {target.name} {target.projectTag ? <span className="tag">{target.projectTag}</span> : null}
        </h1>
        <div className="actions">
          <button type="button" className="primary" onClick={backupNow}>
            Backup now
          </button>
          <Link className="button" to={`/targets/${target.id}/edit`}>
            Edit
          </Link>
        </div>
      </div>
      <ErrorNote error={actionError} />
      {target.enabled ? null : (
        <div className="note">
          <p>This target is disabled. No scheduled backups run. Run Test connection below, then enable it.</p>
          <button type="button" className="primary" onClick={enable}>
            Enable target
          </button>
        </div>
      )}

      <dl className="facts">
        <dt>Health</dt>
        <dd>
          <HealthBadge health={health} />
        </dd>
        <dt>Database</dt>
        <dd className="mono">{connectionLabel(target.connection)}</dd>
        <dt>Tunnel</dt>
        <dd className="mono">{target.tunnelHostname}</dd>
        <dt>Schedule</dt>
        <dd className="mono">
          {target.scheduleCron} <span className="muted">{tz}</span>
        </dd>
        <dt>Next run</dt>
        <dd>{target.enabled ? formatInTimeZone(target.nextRunAt, tz) : "disabled"}</dd>
        <dt>Last success</dt>
        <dd>{formatInTimeZone(target.lastBackupAt, tz)}</dd>
        <dt>Restore URL</dt>
        <dd>
          <SecretBadge isSet={target.hasRestoreUrl} />
        </dd>
        <dt>Tunnel token</dt>
        <dd>
          <SecretBadge isSet={target.hasTunnelToken} />
        </dd>
      </dl>
      <TestConnection targetId={target.id} />

      <h2>Retention</h2>
      <p>
        <button type="button" onClick={showPreview}>
          Preview what would be deleted
        </button>
      </p>
      {preview ? (
        <>
          <p>
            Keeps {preview.keep.length}, would delete {preview.delete.length}. No changes were made.
          </p>
          {rows.length > 0 ? (
            <table className="stack">
              <thead>
                <tr>
                  <th>Backup</th>
                  <th>Started</th>
                  <th>Reasons</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Backup" className="mono">
                      {row.id.slice(0, 8)}
                    </td>
                    <td data-label="Started">{row.backup ? formatInTimeZone(row.backup.startedAt ?? row.backup.queuedAt, tz) : "not on a loaded page"}</td>
                    <td data-label="Reasons">{row.reasons.join(", ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}

      <h2>Backups</h2>
      <ErrorNote error={first.error ?? loadError} />
      <Loading loading={first.loading} hasData={first.data !== undefined} />
      {first.data && backups.length === 0 ? <p className="muted">No backups yet.</p> : null}
      {backups.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>Trigger</th>
              <th className="num">Size</th>
              <th>Duration</th>
              <th>Error</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => (
              <tr key={backup.id} className={backup.status === "failed" || backup.status === "timed_out" ? "row-red" : ""}>
                <td data-label="Started">{formatInTimeZone(backup.startedAt ?? backup.queuedAt, tz)}</td>
                <td data-label="Status">
                  <StatusBadge status={backup.status} />
                </td>
                <td data-label="Trigger">{backup.trigger}</td>
                <td data-label="Size" className="num">
                  {formatBytes(backup.sizeBytes)}
                </td>
                <td data-label="Duration">{formatDuration(backup.durationMs)}</td>
                <td data-label="Error">{backup.errorMessage ?? "-"}</td>
                <td className="row-actions">
                  {backup.status === "success" ? (
                    <>
                      <button type="button" onClick={() => download(backup)}>
                        Download
                      </button>
                      <button type="button" onClick={() => setRestoreFrom(backup)}>
                        Restore
                      </button>
                      <button type="button" className="danger" onClick={() => remove(backup)}>
                        Delete
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {nextCursor ? (
        <p>
          <button type="button" onClick={loadMore}>
            Load more
          </button>
        </p>
      ) : null}

      <RestoreDialog backup={restoreFrom} targets={allTargets.data ?? []} onClose={() => setRestoreFrom(undefined)} />
    </>
  );
}
