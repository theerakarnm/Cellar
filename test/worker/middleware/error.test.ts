import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiError, conflict, notFound, validationError } from "../../../src/worker/lib/api-error";
import type { AppEnv } from "../../../src/worker/middleware/access";
import { errorHandler, notFoundHandler } from "../../../src/worker/middleware/error";

const app = new Hono<AppEnv>();
app.onError(errorHandler);
app.notFound(notFoundHandler);
app.get("/api-error", () => {
  throw new ApiError(400, "bad_thing", "Bad thing", { field: "x" });
});
app.get("/not-found", () => {
  throw notFound("Target");
});
app.get("/conflict", () => {
  throw conflict("Name taken");
});
app.get("/validation", () => {
  throw validationError("tunnel.hostname", "Required");
});
app.get("/boom", () => {
  throw new Error("connect failed for postgres://admin:hunter2@db.example.com:5432/app");
});

async function get(path: string) {
  const response = await app.request(path);
  return { status: response.status, body: (await response.json()) as { error: { code: string } } };
}

describe("errorHandler", () => {
  it("maps ApiError to { error: { code, message, details } }", async () => {
    expect(await get("/api-error")).toEqual({
      status: 400,
      body: { error: { code: "bad_thing", message: "Bad thing", details: { field: "x" } } },
    });
  });

  it("omits details when there are none", async () => {
    expect(await get("/conflict")).toEqual({ status: 409, body: { error: { code: "conflict", message: "Name taken" } } });
    expect(await get("/not-found")).toEqual({ status: 404, body: { error: { code: "not_found", message: "Target not found" } } });
  });

  it("builds validation errors with a field path", async () => {
    expect(await get("/validation")).toEqual({
      status: 400,
      body: { error: { code: "validation_error", message: "Invalid request", details: [{ path: "tunnel.hostname", message: "Required" }] } },
    });
  });

  it("turns unknown errors into a redacted 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await get("/boom");
    expect(status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("hunter2");
    spy.mockRestore();
  });

  it("returns a JSON 404 for unknown routes", async () => {
    expect(await get("/nope")).toEqual({ status: 404, body: { error: { code: "not_found", message: "Not found" } } });
  });
});
