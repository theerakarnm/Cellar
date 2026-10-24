import { Link } from "react-router";
import { listAll } from "../api/client";
import { useLoad } from "../api/hooks";
import type { TargetSummary } from "../api/types";
import { ErrorNote, Loading } from "../components/ui";
import { connectionLabel } from "../lib/display";

export function Targets() {
  const targets = useLoad(() => listAll<TargetSummary>("/api/targets"), []);
  return (
    <>
      <div className="page-head">
        <h1>Targets</h1>
        <Link className="button" to="/targets/new">
          New target
        </Link>
      </div>
      <ErrorNote error={targets.error} />
      <Loading loading={targets.loading} hasData={targets.data !== undefined} />
      {targets.data ? (
        <table className="stack">
          <thead>
            <tr>
              <th>Name</th>
              <th>Database</th>
              <th>Schedule</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {targets.data.map((target) => (
              <tr key={target.id}>
                <td data-label="Name">
                  <Link to={`/targets/${target.id}`}>{target.name}</Link>
                  {target.projectTag ? <span className="tag">{target.projectTag}</span> : null}
                </td>
                <td data-label="Database" className="mono">
                  {connectionLabel(target.connection)}
                </td>
                <td data-label="Schedule" className="mono">
                  {target.scheduleCron} <span className="muted">{target.timezone}</span>
                </td>
                <td data-label="Enabled">{target.enabled ? "yes" : "no"}</td>
                <td>
                  <Link to={`/targets/${target.id}/edit`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
