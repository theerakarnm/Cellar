import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./api-error";

/** Only the field path and the rule message are returned. Submitted values are never echoed. */
function fail(error: z.ZodError): ApiError {
  const details = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
  return new ApiError(400, "validation_error", "Invalid request", details);
}

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "validation_error", "Body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw fail(result.error);
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw fail(result.error);
  return result.data;
}
