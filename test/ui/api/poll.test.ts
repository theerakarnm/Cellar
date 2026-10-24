import { describe, expect, it } from "vitest";
import { pollUntil } from "../../../ui/src/api/poll";

describe("pollUntil", () => {
  it("polls until done and reports each value", async () => {
    const values = ["queued", "running", "success"];
    const seen: string[] = [];
    const result = await pollUntil(async () => values.shift() as string, (v) => v === "success", { intervalMs: 1, maxAttempts: 10, onUpdate: (v) => seen.push(v) });
    expect(result).toBe("success");
    expect(seen).toEqual(["queued", "running", "success"]);
  });

  it("gives up after maxAttempts", async () => {
    await expect(pollUntil(async () => "running", (v) => v === "success", { intervalMs: 1, maxAttempts: 3 })).rejects.toThrow("Timed out");
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(pollUntil(async () => "running", () => false, { intervalMs: 1, maxAttempts: 50, signal: controller.signal })).rejects.toThrow("Cancelled");
  });

  it("stops during the wait when aborted", async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 5);
    await expect(pollUntil(async () => "running", () => false, { intervalMs: 60_000, maxAttempts: 50, signal: controller.signal })).rejects.toThrow("Cancelled");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("propagates fetch errors", async () => {
    await expect(pollUntil(async () => Promise.reject(new Error("boom")), () => true, { intervalMs: 1, maxAttempts: 3 })).rejects.toThrow("boom");
  });
});
