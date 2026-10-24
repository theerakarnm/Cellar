import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeCursor, encodeCursor, paginationQuery, toPage } from "../../../src/worker/lib/pagination";
import { parseBody, parseQuery } from "../../../src/worker/lib/validate";
import type { AppEnv } from "../../../src/worker/middleware/access";
import { errorHandler } from "../../../src/worker/middleware/error";

const bodySchema = z.object({ name: z.string().min(1), count: z.number().int() }).strict();

const app = new Hono<AppEnv>();
app.onError(errorHandler);
app.post("/body", async (c) => c.json(await parseBody(c, bodySchema)));
app.get("/query", (c) => c.json(parseQuery(c, paginationQuery)));

const post = (body: string) => app.request("/body", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("parseBody", () => {
  it("returns parsed data", async () => {
    const response = await post(JSON.stringify({ name: "a", count: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "a", count: 2 });
  });

  it("rejects invalid JSON with 400 validation_error", async () => {
    const response = await post("{nope");
    expect(response.status).toBe(400);
    expect((await response.json()) as object).toEqual({ error: { code: "validation_error", message: "Body must be valid JSON" } });
  });

  it("returns field paths and messages, never the submitted value", async () => {
    const response = await post(JSON.stringify({ name: "", count: "hunter2", extra: "hunter2" }));
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    const paths = (JSON.parse(text).error.details as { path: string }[]).map((d) => d.path).sort();
    expect(paths).toEqual(["", "count", "name"]);
  });
});

describe("parseQuery and pagination", () => {
  it("defaults limit to 50 and coerces strings", async () => {
    expect(await (await app.request("/query")).json()).toEqual({ limit: 50 });
    expect(await (await app.request("/query?limit=7&cursor=abc")).json()).toEqual({ limit: 7, cursor: "abc" });
  });

  it("rejects limit 0, 201, and non-numbers", async () => {
    for (const limit of ["0", "201", "abc", "1.5"]) {
      expect((await app.request(`/query?limit=${limit}`)).status, limit).toBe(400);
    }
  });

  it("roundtrips cursors, including non-ASCII text", () => {
    for (const parts of [["a"], ["2026-10-24T00:00:00.000Z", "id-1"], ["สำรองข้อมูล"]]) {
      expect(decodeCursor(encodeCursor(parts), parts.length)).toEqual(parts);
    }
    expect(encodeCursor(["สำรองข้อมูล"])).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects garbage cursors and cursors of the wrong size", () => {
    expect(() => decodeCursor("!!!", 1)).toThrow("Invalid cursor");
    expect(() => decodeCursor(encodeCursor(["a", "b"]), 1)).toThrow("Invalid cursor");
    expect(() => decodeCursor(btoa("[1]"), 1)).toThrow("Invalid cursor");
  });

  it("toPage drops the extra row and sets nextCursor only when more rows exist", () => {
    const rows = [{ k: "a" }, { k: "b" }, { k: "c" }];
    const first = toPage(rows, 2, (row) => [row.k]);
    expect(first.items).toEqual([{ k: "a" }, { k: "b" }]);
    expect(first.nextCursor && decodeCursor(first.nextCursor, 1)).toEqual(["b"]);
    expect(toPage(rows.slice(0, 2), 2, (row) => [row.k])).toEqual({ items: [{ k: "a" }, { k: "b" }], nextCursor: null });
    expect(toPage([], 2, (row: { k: string }) => [row.k])).toEqual({ items: [], nextCursor: null });
  });
});
