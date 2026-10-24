import { useState } from "react";
import { api } from "../api/client";
import { pollUntil } from "../api/poll";
import type { Backup, RestoreRun, TargetSummary } from "../api/types";
import { canSubmitRestore, restoreRequest } from "../lib/restore";
import { isTerminalStatus } from "../lib/status";
import { Dialog, ErrorNote, Field } from "./ui";

export function RestoreDialog({ backup, targets, onClose }: { backup: Backup | undefined; targets: TargetSummary[]; onClose: () => void }) {
  return (
    <Dialog open={backup !== undefined} title="Restore backup" onClose={onClose}>
      {backup ? <RestoreForm key={backup.id} backup={backup} targets={targets} onClose={onClose} /> : null}
    </Dialog>
  );
}

function RestoreForm({ backup, targets, onClose }: { backup: Backup; targets: TargetSummary[]; onClose: () => void }) {
  const [destinationId, setDestinationId] = useState("");
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | undefined>();
  const [run, setRun] = useState<RestoreRun | undefined>();

  const destination = targets.find((t) => t.id === destinationId);
  const sameDatabase = destination !== undefined && destination.id === backup.targetId;
  const ready = canSubmitRestore({ typedName, destinationName: destination?.name ?? "", sameDatabase, acknowledged });

  async function submit() {
    if (!destination) return;
    setBusy(true);
    setError(undefined);
    try {
      const { restoreId } = await api<{ restoreId: string }>("POST", `/api/backups/${backup.id}/restore`, restoreRequest(destination.id, typedName, sameDatabase));
      await pollUntil(() => api<RestoreRun>("GET", `/api/restores/${restoreId}`), (r) => isTerminalStatus(r.status), {
        intervalMs: 2000,
        maxAttempts: 900,
        onUpdate: setRun,
      });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
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
      <div className="actions">
        <button type="submit" className="danger" disabled={!ready || busy}>
          {busy ? "Restoring..." : "Restore"}
        </button>
        <button type="button" onClick={onClose}>
          {run && isTerminalStatus(run.status) ? "Close" : "Cancel"}
        </button>
      </div>
    </form>
  );
}
