import { SIGNATURE_HEADER, signCallback, TIMESTAMP_HEADER } from "./hmac";
import type { ErrorCode } from "./job";

export type CallbackEvent = "started" | "progress" | "succeeded" | "failed";

export interface CallbackExtra {
  result?: Record<string, unknown>;
  error?: { code: ErrorCode; message: string };
}

export interface CallbackClientOptions {
  url: string;
  jobId: string;
  jobKeyBase64: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const TERMINAL_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const OTHER_RETRY_DELAYS_MS = [1000];

/**
 * Sends signed job events. Events go out one at a time in call order, so `seq` is always increasing.
 * A retry resends the same body (same seq) with a fresh timestamp and signature.
 */
export class CallbackClient {
  private seq = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly options: CallbackClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  /** Resolves true when the Worker accepted the event, false when it was rejected or retries ran out. */
  send(event: CallbackEvent, extra: CallbackExtra = {}): Promise<boolean> {
    const seq = ++this.seq;
    const body = JSON.stringify({ jobId: this.options.jobId, event, at: new Date(this.now()).toISOString(), seq, ...extra });
    const delays = event === "succeeded" || event === "failed" ? TERMINAL_RETRY_DELAYS_MS : OTHER_RETRY_DELAYS_MS;
    const delivery = this.tail.then(() => this.deliver(body, delays));
    this.tail = delivery;
    return delivery;
  }

  private async deliver(body: string, retryDelays: number[]): Promise<boolean> {
    for (let attempt = 0; ; attempt++) {
      const timestamp = String(Math.floor(this.now() / 1000));
      const signature = await signCallback(this.options.jobKeyBase64, timestamp, this.options.jobId, body);
      try {
        const response = await this.fetchFn(this.options.url, {
          method: "POST",
          headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature },
          body,
        });
        if (response.ok) return true;
        const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
        if (!retryable) return false;
      } catch {
        // Network error: retry below.
      }
      const delay = retryDelays[attempt];
      if (delay === undefined) return false;
      await this.sleep(delay);
    }
  }
}

/** Sends a `progress` event every `intervalMs` (30 s). Returns a function that stops it. */
export function startHeartbeat(client: CallbackClient, intervalMs = 30_000): () => void {
  const timer = setInterval(() => void client.send("progress"), intervalMs);
  return () => clearInterval(timer);
}
