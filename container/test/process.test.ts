import { describe, expect, it } from "vitest";
import { childEnv, runCapture, startChild } from "../process";

const node = process.execPath;

describe("process helpers", () => {
  it("passes only the explicit environment to children", async () => {
    process.env.CELLAR_SECRET_PROBE = "super-secret-value";
    const env = childEnv({ PGPASSWORD: "pw" });
    const result = await runCapture(node, ["-e", "console.log(JSON.stringify([process.env.CELLAR_SECRET_PROBE ?? null, process.env.PGPASSWORD ?? null]))"], { env });
    delete process.env.CELLAR_SECRET_PROBE;
    expect(JSON.parse(result.stdout)).toEqual([null, "pw"]);
  });

  it("reports exit code and keeps only a bounded stderr tail", async () => {
    const result = await runCapture(node, ["-e", "process.stderr.write('x'.repeat(100000) + 'END'); process.exitCode = 3"], { env: childEnv({}) });
    expect(result.exit.code).toBe(3);
    expect(result.stderr.length).toBe(4096);
    expect(result.stderr.endsWith("END")).toBe(true);
  });

  it("reports a missing binary as a spawn error instead of throwing", async () => {
    const child = startChild("/nonexistent/binary", [], { env: {} });
    const exit = await child.exit;
    expect(exit.spawnError?.message).toContain("ENOENT");
  });

  it("terminates a running child on abort", async () => {
    const controller = new AbortController();
    const child = startChild(node, ["-e", "setInterval(() => {}, 1000)"], { env: childEnv({}), signal: controller.signal });
    controller.abort();
    expect((await child.exit).signal).toBe("SIGTERM");
  });

  it("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const controller = new AbortController();
    const child = startChild(node, ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], {
      env: childEnv({}),
      signal: controller.signal,
      killGraceMs: 100,
    });
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    controller.abort();
    expect((await child.exit).signal).toBe("SIGKILL");
  });
});
