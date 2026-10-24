import { useCallback, useEffect, useState } from "react";

export interface LoadState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/** Loads on mount and whenever `deps` change. `nextPollMs` returns a delay to poll again, or null to stop. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[], nextPollMs?: (data: T) => number | null): LoadState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const next = await load();
        if (cancelled) return;
        setData(next);
        setError(undefined);
        const delay = nextPollMs?.(next) ?? null;
        if (delay !== null) timer = setTimeout(run, delay);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  return { data, error, loading, reload };
}
