import type { ErrorHandler, NotFoundHandler } from "hono";
import { ApiError } from "../lib/api-error";
import { redactError } from "../lib/redact";
import type { AppEnv } from "./access";

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  if (error instanceof ApiError) {
    const body = { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) };
    return c.json({ error: body }, error.status);
  }
  console.error(`unhandled error: ${redactError(error)}`);
  return c.json({ error: { code: "internal_error", message: redactError(error) } }, 500);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) =>
  c.json({ error: { code: "not_found", message: "Not found" } }, 404);
