import { useState } from "react";
import { api, listAll, withQuery } from "../api/client";
import { useLoad } from "../api/hooks";
import type { AuditEntry, Page, TargetSummary } from "../api/types";
import { formatInTimeZone, timeZoneForAudit } from "../lib/time";
import { ErrorNote, Field } from "./ui";

/** The API already redacts and parses `details`; this only turns the parsed value into display text. */
function detailsText(details: unknown): string {
  return typeof details === "string" ? details : JSON.stringify(details, null, 2);
}

export function AuditLog() {
  const [entityType, setEntityType] = useState("");
  const first = useLoad(() => api<Page<AuditEntry>>("GET", withQuery("/api/audit-logs", { limit: 50, entityType })), [entityType]);
  const targets = useLoad(() => listAll<TargetSummary>("/api/targets"), []);
  const [more, setMore] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [error, setError] = useState<Error | undefined>();

  const entries = [...(first.data?.items ?? []), ...more];
  const nextCursor = cursor === undefined ? (first.data?.nextCursor ?? null) : cursor;

  async function loadMore() {
    if (!nextCursor) return;
    try {
      const page = await api<Page<AuditEntry>>("GET", withQuery("/api/audit-logs", { limit: 50, entityType, cursor: nextCursor }));
      setMore((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <section aria-labelledby="audit-heading">
      <h2 id="audit-heading">Audit log</h2>
      <Field label="Entity type" hint="Blank = all. Example: target, backup, restore.">
        <input
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value.trim());
            setMore([]);
            setCursor(undefined);
          }}
        />
      </Field>
      <ErrorNote error={first.error ?? error} />
      {first.data && entries.length === 0 ? <p className="muted">No entries.</p> : null}
      {entries.length > 0 ? (
        <table className="stack">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td data-label="When">{formatInTimeZone(entry.at, timeZoneForAudit(entry.entityType, entry.entityId, targets.data ?? []))}</td>
                <td data-label="Actor">{entry.actor}</td>
                <td data-label="Action" className="mono">
                  {entry.action}
                </td>
                <td data-label="Entity" className="mono">
                  <span title={entry.entityId ?? undefined}>
                    {entry.entityId ? `${entry.entityType} ${entry.entityId.slice(0, 8)}` : entry.entityType}
                  </span>
                </td>
                <td data-label="Details">
                  {entry.details || entry.entityId ? (
                    <details>
                      <summary>Show</summary>
                      {entry.entityId ? (
                        <p className="mono">
                          {entry.entityType} {entry.entityId}
                        </p>
                      ) : null}
                      {entry.details ? <pre>{detailsText(entry.details)}</pre> : null}
                    </details>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {nextCursor ? (
        <p>
          <button type="button" onClick={() => void loadMore()}>
            Load more
          </button>
        </p>
      ) : null}
    </section>
  );
}
