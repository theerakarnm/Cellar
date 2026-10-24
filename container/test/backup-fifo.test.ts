import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFifo } from "../jobs/backup";
import { childEnv, startChild } from "../process";

const execFileAsync = promisify(execFile);
const node = process.execPath;

let dir: string;
let fifo: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backup-fifo-test-"));
  fifo = join(dir, "dump.fifo");
  await execFileAsync("mkfifo", ["-m", "600", fifo]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of source) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts);
}

describe("readFifo", () => {
  it("yields the exact bytes a writer process puts into the FIFO, then ends at EOF", async () => {
    const payload = Buffer.alloc(3 * 1024 * 1024 + 123, 0);
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) % 251;
    const never = new Promise<never>(() => {});
    const writer = startChild(node, ["-e", `process.stdin.pipe(require("node:fs").createWriteStream(${JSON.stringify(fifo)}))`], { env: childEnv({}) });
    writer.stdin.end(payload);

    const received = await collect(readFifo(fifo, never));
    expect((await writer.exit).code).toBe(0);
    expect(received.equals(payload)).toBe(true);
  });

  it("does not hang when the writer exits without ever opening the FIFO", async () => {
    const exited = Promise.resolve({ code: 1, signal: null });
    const received = await collect(readFifo(fifo, exited));
    expect(received.length).toBe(0);
  });
});
