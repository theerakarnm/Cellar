import { Link } from "react-router";
import { listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { TargetSummary } from "../api/types";
import { ErrorNote, HealthBadge, Loading, StatusBadge } from "../components/ui";
import { formatBytes } from "../lib/display";
import { classifyTarget, isRedHealth } from "../lib/status";
import { formatInTimeZone, formatRelative } from "../lib/time";

export function Dashboard() {
  const targets = useLoad(() => listAll<TargetSummary>("/api/targets"), [], () => 30_000);
  const now = new Date();
  const rows = (targets.data ?? []).map((target) => ({ target, health: classifyTarget(target, now) }));
  rows.sort((a, b) => Number(isRedHealth(b.health)) - Number(isRedHealth(a.health)) || a.target.name.localeCompare(b.target.name));
  const problems = rows.filter((r) => isRedHealth(r.health)).length;
  const totalBytes = rows.reduce((sum, r) => sum + r.target.stats.totalBackupBytes, 0);

  return (
    <>
      <h1>Dashboard</h1>
      <ErrorNote error={targets.error} />
      <Loading loading={targets.loading} hasData={targets.data !== undefined} />
      {targets.data ? (
        <>
          <section className="summary" aria-label="Summary">
            <div>
              <strong>{rows.length}</strong>
              <span>targets</span>
            </div>
            <div className={problems > 0 ? "summary-red" : ""}>
              <strong>{problems}</strong>
              <span>failing or stale</span>
            </div>
            <div>
              <strong>{formatBytes(totalBytes)}</strong>
              <span>in R2</span>
            </div>
          </section>
          {rows.length === 0 ? (
            <p className="muted">
              No targets yet. <Link to="/targets/new">Add the first one</Link>.
            </p>
          ) : (
            <table className="stack">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Health</th>
                  <th>Last status</th>
                  <th>Last success</th>
                  <th>Next run</th>
                  <th className="num">R2 size</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ target, health }) => (
                  <tr key={target.id} className={isRedHealth(health) ? "row-red" : ""}>
                    <td data-label="Target">
                      <Link to={`/targets/${target.id}`}>{target.name}</Link>
                      {target.projectTag ? <span className="tag">{target.projectTag}</span> : null}
                    </td>
                    <td data-label="Health">
                      <HealthBadge health={health} />
                    </td>
                    <td data-label="Last status">
                      <StatusBadge status={target.lastStatus} />
                    </td>
                    <td data-label="Last success">
                      {formatInTimeZone(target.lastBackupAt, target.timezone)}
                      <span className="muted block">{formatRelative(target.lastBackupAt, now)}</span>
                    </td>
                    <td data-label="Next run">{target.enabled ? formatInTimeZone(target.nextRunAt, target.timezone) : "-"}</td>
                    <td data-label="R2 size" className="num">
                      {formatBytes(target.stats.totalBackupBytes)}
                      <span className="muted block">{target.stats.backupCount} backups</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </>
  );
}
