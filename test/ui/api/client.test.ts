import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_MESSAGE, api, listAll, withQuery } from "../../../ui/src/api/client";

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("api", () => {
  it("sends JSON and returns the parsed body", async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    expect(await api("POST", "/api/x", { a: 1 })).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
  });

  it("returns undefined for 204", async () => {
    stubFetch(new Response(null, { status: 204 }));
    expect(await api("DELETE", "/api/x")).toBeUndefined();
  });

  it("turns the error envelope into an ApiError", async () => {
    stubFetch(Response.json({ error: { code: "conflict", message: "Name taken" } }, { status: 409 }));
    await expect(api("POST", "/api/x", {})).rejects.toMatchObject({ status: 409, code: "conflict", message: "Name taken" });
  });

  it("reports a failed fetch as a network error that says to reload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")));
    const error = await api("GET", "/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: "network", message: NETWORK_MESSAGE });
  });

  it("reports a non-JSON body (for example an Access login page) as bad_response", async () => {
    stubFetch(new Response("<html>login</html>", { status: 200 }));
    const error = await api("GET", "/api/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("bad_response");
  });
});

describe("withQuery", () => {
  it("skips empty values and appends to an existing query", () => {
    expect(withQuery("/api/x", { limit: 5, cursor: undefined, entityType: "" })).toBe("/api/x?limit=5");
    expect(withQuery("/api/x?a=1", { b: "2" })).toBe("/api/x?a=1&b=2");
    expect(withQuery("/api/x", {})).toBe("/api/x");
  });
});

describe("listAll", () => {
  it("follows nextCursor until it is null", async () => {
    const fetchMock = stubFetch(Response.json({ items: [1, 2], nextCursor: "c1" }), Response.json({ items: [3], nextCursor: null }));
    expect(await listAll<number>("/api/x")).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/x?limit=200", "/api/x?limit=200&cursor=c1"]);
  });
});
