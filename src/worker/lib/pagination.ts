import { z } from "zod";
import { ApiError } from "./api-error";

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

/** Opaque cursor: base64url of the JSON array of the last row's sort key parts. */
export function encodeCursor(parts: string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(cursor: string, size: number): string[] {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(cursor.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))));
    if (Array.isArray(parsed) && parsed.length === size && parsed.every((part) => typeof part === "string")) return parsed;
  } catch {
    // falls through to the error below
  }
  throw new ApiError(400, "validation_error", "Invalid cursor", [{ path: "cursor", message: "Invalid cursor" }]);
}

/** `rows` must be fetched with `limit + 1`: the extra row only signals that another page exists. */
export function toPage<T>(rows: T[], limit: number, sortKey: (row: T) => string[]): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(sortKey(last)) : null };
}
