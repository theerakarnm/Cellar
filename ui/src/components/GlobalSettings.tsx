import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useLoad } from "../api/hooks";
import type { Settings } from "../api/types";
import { ErrorNote, Field } from "./ui";

export function GlobalSettings() {
  const settings = useLoad(() => api<Settings>("GET", "/api/settings"), []);
  const [concurrency, setConcurrency] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  useEffect(() => {
    if (settings.data) {
      setConcurrency(String(settings.data.max_concurrent_jobs));
      setDryRun(settings.data.retention_dry_run);
    }
  }, [settings.data]);

  const parsed = Number(concurrency);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10;

  async function save() {
    setError(undefined);
    setSaved(false);
    try {
      await api<Settings>("PUT", "/api/settings", { max_concurrent_jobs: parsed, retention_dry_run: dryRun });
      setSaved(true);
      settings.reload();
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return (
    <section aria-labelledby="global-heading">
      <h2 id="global-heading">Global</h2>
      <ErrorNote error={settings.error ?? error} />
      <Field label="Max concurrent jobs" hint="How many backup jobs may run at once, 1 to 10" error={concurrency !== "" && !valid ? "Enter a whole number from 1 to 10" : undefined}>
        <input value={concurrency} inputMode="numeric" onChange={(e) => setConcurrency(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        Retention dry run
      </label>
      {dryRun ? (
        <p className="note note-warn">Retention dry run is ON: retention deletes nothing, it only logs what would be deleted.</p>
      ) : (
        <p className="note note-error">Retention dry run is OFF: retention deletes expired backups from R2. The newest successful backup of each target is always kept.</p>
      )}
      <div className="actions">
        <button type="button" className="primary" disabled={!valid || !settings.data} onClick={save}>
          Save
        </button>
        {saved ? <span className="note-ok-text">Saved</span> : null}
      </div>
    </section>
  );
}
