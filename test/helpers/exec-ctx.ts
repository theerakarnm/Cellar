export interface TestExecutionContext extends ExecutionContext {
  settled(): Promise<void>;
}

/** An ExecutionContext that records waitUntil promises so a test can await them. */
export function createExecutionContext(): TestExecutionContext {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    async settled() {
      await Promise.allSettled(pending);
    },
  } as unknown as TestExecutionContext;
}
