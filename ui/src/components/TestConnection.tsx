import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { pollUntil } from "../api/poll";
import type { ConnectionTest } from "../api/types";
import { isTerminalStatus } from "../lib/status";
import { ErrorNote } from "./ui";

export function TestConnection({ targetId }: { targetId: string }) {
  const [test, setTest] = useState<ConnectionTest | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => controller.current?.abort(), []);

  async function run() {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(undefined);
    setTest(undefined);
    try {
      const { testId } = await api<{ testId: string }>("POST", `/api/targets/${targetId}/test`);
      await pollUntil(() => api<ConnectionTest>("GET", `/api/targets/${targetId}/test/${testId}`), (t) => isTerminalStatus(t.status), {
        intervalMs: 1500,
        maxAttempts: 80,
        signal: abort.signal,
        onUpdate: (t) => {
          if (!abort.signal.aborted) setTest(t);
        },
      });
    } catch (e) {
      if (!abort.signal.aborted) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="test-connection">
      <button type="button" onClick={run} disabled={busy}>
        {busy ? "Testing..." : "Test connection"}
      </button>
      <span className="hint">Tests the saved settings.</span>
      <ErrorNote error={error} />
      {test ? (
        <p className={`note ${test.status === "success" ? "note-ok" : test.status === "failed" || test.status === "timed_out" ? "note-error" : ""}`} role="status">
          {test.status === "success"
            ? `Connected. PostgreSQL ${test.result?.pgServerVersion ?? "unknown"}. ${test.result?.hasReadAllData ? "Role can read all data." : "Role lacks pg_read_all_data."}`
            : test.status === "failed" || test.status === "timed_out"
              ? `Test ${test.status.replace("_", " ")}: ${test.error?.message ?? "no details"}`
              : `Test ${test.status}...`}
        </p>
      ) : null}
    </div>
  );
}
