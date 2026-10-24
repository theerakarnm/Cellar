import net from "node:net";
import { JobError, type TunnelInput } from "./job";
import { classifyConnectionFailure } from "./pg";
import { childEnv, startChild, type Child, type StartOptions } from "./process";

export interface Tunnel {
  stop(): Promise<void>;
}

export interface TunnelOptions {
  signal?: AbortSignal;
  readyTimeoutMs?: number;
  scrub: (text: string) => string;
  /** Replaceable in tests. */
  start?: (command: string, args: string[], options: StartOptions) => Child;
}

interface WaitOptions {
  host?: string;
  timeoutMs: number;
  intervalMs?: number;
  /** Return an error to stop waiting early, for example when the tunnel process already exited. */
  failFast?: () => Error | null;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Resolves when something accepts TCP connections on host:port; rejects on timeout or failFast. */
export async function waitForPort(port: number, options: WaitOptions): Promise<void> {
  const host = options.host ?? "127.0.0.1";
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const early = options.failFast?.();
    if (early) throw early;
    if (await canConnect(host, port)) return;
    if (Date.now() >= deadline) throw new Error(`port ${port} did not open within ${options.timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 200));
  }
}

/**
 * Starts `cloudflared access tcp` for the job. The service token goes in the environment
 * (TUNNEL_SERVICE_TOKEN_ID / TUNNEL_SERVICE_TOKEN_SECRET), never in argv.
 */
export async function startTunnel(input: TunnelInput, options: TunnelOptions): Promise<Tunnel> {
  const start = options.start ?? startChild;
  const child = start("cloudflared", ["access", "tcp", "--hostname", input.hostname, "--url", `127.0.0.1:${input.localPort}`, "--loglevel", "info"], {
    env: childEnv({ TUNNEL_SERVICE_TOKEN_ID: input.tokenId, TUNNEL_SERVICE_TOKEN_SECRET: input.tokenSecret }),
    signal: options.signal,
  });
  let exited: string | null = null;
  void child.exit.then((exit) => {
    exited = exit.spawnError ? `could not start cloudflared (${exit.spawnError.message})` : `cloudflared exited with code ${exit.code ?? exit.signal}`;
  });

  const stop = async () => {
    child.kill();
    await child.exit;
  };

  try {
    await waitForPort(input.localPort, {
      timeoutMs: options.readyTimeoutMs ?? 30_000,
      failFast: () => (exited ? new Error(exited) : null),
    });
  } catch (error) {
    await stop();
    const tail = options.scrub(child.stderrTail());
    const auth = classifyConnectionFailure(tail) === "AUTH_FAILED";
    const reason = error instanceof Error ? error.message : "unknown";
    throw new JobError(auth ? "AUTH_FAILED" : "TUNNEL_FAILED", `Tunnel failed: ${reason}. ${tail.slice(-600)}`.trim());
  }
  return { stop };
}
