export async function pollUntil<T>(
  fetchOnce: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: { intervalMs: number; maxAttempts: number; signal?: AbortSignal; onUpdate?: (value: T) => void },
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const value = await fetchOnce();
    options.onUpdate?.(value);
    if (isDone(value)) return value;
    if (attempt >= options.maxAttempts) throw new Error("Timed out waiting for the result");
    if (options.signal?.aborted) throw new Error("Cancelled");
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
