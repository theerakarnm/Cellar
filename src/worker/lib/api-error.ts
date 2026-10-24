export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 500 | 503;

export class ApiError extends Error {
  constructor(
    readonly status: ApiErrorStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);

export const conflict = (message: string) => new ApiError(409, "conflict", message);

/** `path` is a dotted field path such as "tunnel.hostname". Never put a submitted value in `message`. */
export const validationError = (path: string, message: string) =>
  new ApiError(400, "validation_error", "Invalid request", [{ path, message }]);
