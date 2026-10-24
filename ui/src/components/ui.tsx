import { useEffect, useRef, type ReactNode } from "react";
import type { TargetHealth } from "../lib/status";
import type { JobStatus } from "../api/types";

export function ErrorNote({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return (
    <p className="note note-error" role="alert">
      {error.message}
    </p>
  );
}

export function Loading({ loading, hasData }: { loading: boolean; hasData: boolean }) {
  return loading && !hasData ? <p className="muted">Loading...</p> : null;
}

const HEALTH_LABEL: Record<TargetHealth, string> = { failing: "Failing", stale: "Stale", ok: "Healthy", never: "No backup yet", disabled: "Disabled" };
const HEALTH_TONE: Record<TargetHealth, string> = { failing: "red", stale: "red", ok: "green", never: "grey", disabled: "grey" };

export function HealthBadge({ health }: { health: TargetHealth }) {
  return <span className={`badge badge-${HEALTH_TONE[health]}`}>{HEALTH_LABEL[health]}</span>;
}

const STATUS_TONE: Record<JobStatus, string> = { queued: "grey", running: "blue", success: "green", failed: "red", timed_out: "red" };

export function StatusBadge({ status }: { status: JobStatus | null }) {
  if (!status) return <span className="muted">-</span>;
  return <span className={`badge badge-${STATUS_TONE[status]}`}>{status.replace("_", " ")}</span>;
}

export function SecretBadge({ isSet }: { isSet: boolean }) {
  return <span className={`badge ${isSet ? "badge-green" : "badge-grey"}`}>{isSet ? "set" : "not set"}</span>;
}

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}>
      {open ? (
        <div className="dialog-body">
          <h2>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string | undefined; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
