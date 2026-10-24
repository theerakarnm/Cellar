export type PgConnectionInfo = { host: string; port: number; user: string; dbName: string };

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Reads host, port, user, and database name from a postgres:// or postgresql:// URL.
 * Returns null when the URL is unusable. Special characters in the password must be percent-encoded.
 */
export function parsePgUrl(url: string): PgConnectionInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  const user = decode(parsed.username);
  const dbName = decode(parsed.pathname.slice(1));
  if (!parsed.hostname || !user || !dbName || dbName.includes("/")) return null;
  return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 5432, user, dbName };
}

/** The value stored in `targets.db_name` and used in R2 keys: every character outside [A-Za-z0-9_-] becomes "_". */
export function sanitizeDbName(dbName: string): string {
  return dbName.replace(/[^A-Za-z0-9_-]/g, "_");
}
