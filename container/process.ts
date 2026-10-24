import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

const STDERR_TAIL_BYTES = 4096;
const INHERITED_ENV = ["PATH", "HOME", "LANG", "SSL_CERT_FILE", "SSL_CERT_DIR"];

/** Child processes get an explicit environment, never the runner's own (it may hold the job JSON). */
export function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

export interface Child {
  stdin: Writable;
  stdout: Readable;
  /** The last few KiB of stderr. Unredacted: callers must scrub before logging or sending. */
  stderrTail(): string;
  /** Resolves after the process exited and its stdio closed. Never rejects. */
  exit: Promise<ExitInfo>;
  kill(): void;
}

export interface StartOptions {
  env: Record<string, string>;
  signal?: AbortSignal;
  killGraceMs?: number;
}

/** Starts a process. On abort it sends SIGTERM, then SIGKILL after the grace period. */
export function startChild(command: string, args: string[], options: StartOptions): Child {
  const child = spawn(command, args, { env: options.env, stdio: ["pipe", "pipe", "pipe"] });
  let tail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    tail = (tail + chunk).slice(-STDERR_TAIL_BYTES);
  });
  // A process that exits early closes stdin; writers see EPIPE through the exit code instead.
  child.stdin.on("error", () => {});

  const exit = new Promise<ExitInfo>((resolve) => {
    child.once("error", (spawnError) => resolve({ code: null, signal: null, spawnError }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), options.killGraceMs ?? 5000).unref();
  };
  if (options.signal?.aborted) kill();
  else options.signal?.addEventListener("abort", kill, { once: true });

  return { stdin: child.stdin, stdout: child.stdout, stderrTail: () => tail, exit, kill };
}

/** Runs a short process to completion and returns its stdout (capped) and stderr tail. */
export async function runCapture(command: string, args: string[], options: StartOptions) {
  const child = startChild(command, args, options);
  child.stdin.end();
  let stdout = "";
  child.stdout.setEncoding("utf8");
  for await (const chunk of child.stdout) {
    if (stdout.length < 65536) stdout += chunk;
  }
  const exit = await child.exit;
  return { exit, stdout, stderr: child.stderrTail() };
}
