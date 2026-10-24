import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { pollUntil } from "../api/poll";
import type { Backup, RestoreRun, TargetSummary } from "../api/types";
import { formatBytes } from "../lib/display";
import { canSubmitRestore, restoreRequest } from "../lib/restore";
import { isTerminalStatus } from "../lib/status";
import { formatInTimeZone } from "../lib/time";
import { Dialog, ErrorNote, Field } from "./ui";

export function RestoreDialog({
  backup,
  source,
  targets,
  onClose,
}: {
  backup: Backup | undefined;
  source: TargetSummary;
  targets: TargetSummary[];
  onClose: () => void;
}) {
  return (
    <Dialog open={backup !== undefined} title="Restore backup" onClose={onClose}>
      {backup ? <RestoreForm key={backup.id} backup={backup} source={source} targets={targets} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RestoreForm({ backup, source, targets, onClose }: { backup: Backup; source: TargetSummary; targets: TargetSummary[]; onClose: () => void }) {
  const [destinationId, setDestinationId] = useState("");
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [run, setRun] = useState<RestoreRun | undefined>();
  const [restoreId, setRestoreId] = useState<string | undefined>();
  const controller = useRef<AbortController | undefined>(undefined);
  const submitting = useRef(false);

  useEffect(() => () => controller.current?.abort(), []);

  const destination = targets.find((t) => t.id === destinationId);
  const sameDatabase = destination !== undefined && destination.id === backup.targetId;
  const ready = canSubmitRestore({ typedName, destinationName: destination?.name ?? "", sameDatabase, acknowledged });

  async function submit() {
    if (!destination || submitting.current || restoreId) return;
    submitting.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(undefined);
    try {
      const started = await api<{ restoreId: string }>("POST", `/api/backups/${backup.id}/restore`, restoreRequest(destination.id, typedName, sameDatabase));
      setRestoreId(started.restoreId);
      await pollUntil(() => api<RestoreRun>("GET", `/api/restores/${started.restoreId}`), (r) => isTerminalStatus(r.status), {
        intervalMs: 2000,
        maxAttempts: 900,
        signal: abort.signal,
        onUpdate: (r) => {
          if (!abort.signal.aborted) setRun(r);
        },
      });
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      submitting.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="backup-source">
        Backup of <strong className="wrap-anywhere">{source.name}</strong> from {formatInTimeZone(backup.startedAt ?? backup.queuedAt, source.timezone)} (
        {formatBytes(backup.sizeBytes)})
      </p>
      <p>
        Restores run <code>pg_restore</code> into the database stored as the destination target&apos;s restore URL. Nothing is created. Existing objects can be overwritten.
      </p>
      <Field label="Destination target">
        <select value={destinationId} disabled={busy} onChange={(e) => setDestinationId(e.target.value)}>
          <option value="">Select a destination</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id} disabled={!t.hasRestoreUrl}>
              {t.name}
              {t.hasRestoreUrl ? "" : " (no restore URL)"}
            </option>
          ))}
        </select>
      </Field>
      {sameDatabase ? (
        <div className="note note-error" role="alert">
          <strong>This restores into the source database.</strong> Current data in the database can be overwritten and lost.
          <label className="check">
            <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(e) => setAcknowledged(e.target.checked)} />I understand this overwrites the source database
          </label>
        </div>
      ) : null}
      {destination ? (
        <Field label={`Type "${destination.name}" to confirm`}>
          <input value={typedName} disabled={busy} autoComplete="off" onChange={(e) => setTypedName(e.target.value)} />
        </Field>
      ) : null}
      <ErrorNote error={error} />
      {run ? (
        <p className={`note ${run.status === "success" ? "note-ok" : isTerminalStatus(run.status) ? "note-error" : ""}`} role="status">
          Restore {run.status.replace("_", " ")}
          {run.errorMessage ? `: ${run.errorMessage}` : ""}
        </p>
      ) : null}
      {busy || restoreId !== undefined ? (
        <p className="hint" role="status">
          The restore continues in the background if you close this dialog. This page does not show its result after you close it.
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="danger" disabled={!ready || busy || restoreId !== undefined}>
          {busy ? "Restoring..." : "Restore"}
        </button>
        <button type="button" onClick={onClose}>
          {restoreId !== undefined ? "Close" : "Cancel"}
        </button>
      </div>
    </form>
  );
}
