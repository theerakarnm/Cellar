export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: { intervalMs: number; maxAttempts: number; signal?: AbortSignal; onUpdate?: (value: T) => void },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (options.signal?.aborted) throw new Error("Cancelled");
    const value = await fetchOnce();
    if (options.signal?.aborted) throw new Error("Cancelled");
    options.onUpdate?.(value);
    if (isDone(value)) return value;
    if (attempt >= options.maxAttempts) throw new Error("Timed out waiting for the result");
    await sleep(options.intervalMs, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
