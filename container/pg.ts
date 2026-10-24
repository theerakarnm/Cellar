import { JobError } from "./job";

export const PG_BIN_ROOT = "/usr/lib/postgresql";
export const MIN_PG_MAJOR = 13;
export const MAX_PG_MAJOR = 18;

export interface PgConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
  connectTimeout?: string;
  applicationName?: string;
}

const PARAMS = { sslmode: "sslmode", connect_timeout: "connectTimeout", application_name: "applicationName" } as const;

/** Parses postgres:// or postgresql:// URLs. Error messages never contain the URL. */
export function parsePgUrl(value: string): PgConnection {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new JobError("INVALID_JOB", "Invalid connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new JobError("INVALID_JOB", "Connection URL must start with postgres:// or postgresql://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !url.username || !database) {
    throw new JobError("INVALID_JOB", "Connection URL needs a host, a user, and a database name");
  }
  const connection: PgConnection = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
  for (const [name, paramValue] of url.searchParams) {
    const field = PARAMS[name as keyof typeof PARAMS];
    if (!field) throw new JobError("INVALID_JOB", `Unsupported connection URL parameter: ${name}`);
    connection[field] = paramValue;
  }
  return connection;
}

/** libpq environment for a child process. Secrets travel in env, never in argv. */
export function pgEnv(connection: PgConnection): Record<string, string> {
  const env: Record<string, string> = {
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
  };
  if (connection.sslmode) env.PGSSLMODE = connection.sslmode;
  if (connection.connectTimeout) env.PGCONNECT_TIMEOUT = connection.connectTimeout;
  if (connection.applicationName) env.PGAPPNAME = connection.applicationName;
  return env;
}

export function pgBinary(major: number, tool: "psql" | "pg_dump" | "pg_restore"): string {
  return `${PG_BIN_ROOT}/${major}/bin/${tool}`;
}

export interface ServerProbe {
  major: number;
  pgServerVersion: string;
  dbSizeBytes: number;
  hasReadAllData: boolean | null;
}

export const PROBE_SQL =
  "select current_setting('server_version_num'), current_setting('server_version'), " +
  "pg_database_size(current_database()), " +
  "case when to_regrole('pg_read_all_data') is null then '' else pg_has_role(current_user, 'pg_read_all_data', 'member')::text end";

/** Parses the one `|`-separated row printed by psql -At -F '|' for PROBE_SQL. */
export function parseProbe(output: string): ServerProbe {
  const [versionNum, serverVersion, size, readAll] = output.trim().split("|");
  const num = Number(versionNum);
  const dbSizeBytes = Number(size);
  if (!Number.isInteger(num) || !serverVersion || !Number.isFinite(dbSizeBytes)) {
    throw new JobError("UNKNOWN", "Unexpected server version output");
  }
  return {
    major: Math.floor(num / 10000),
    pgServerVersion: serverVersion.split(" ")[0] ?? serverVersion,
    dbSizeBytes,
    hasReadAllData: readAll === "true" ? true : readAll === "false" ? false : null,
  };
}

export function assertSupportedMajor(major: number): void {
  if (major < MIN_PG_MAJOR || major > MAX_PG_MAJOR) {
    throw new JobError("DUMP_FAILED", `PostgreSQL ${major} is not supported (supported: ${MIN_PG_MAJOR}-${MAX_PG_MAJOR})`);
  }
}

const AUTH_PATTERN = /password authentication failed|authentication failed|no pg_hba\.conf entry|role ".*" does not exist|permission denied|\b(401|403)\b|forbidden|unauthori[sz]ed/i;

/** Maps psql / pg_dump / pg_restore connection failures to an error code. */
export function classifyConnectionFailure(stderr: string): "AUTH_FAILED" | "TUNNEL_FAILED" | null {
  if (AUTH_PATTERN.test(stderr)) return "AUTH_FAILED";
  // Every connection goes through the local cloudflared listener, so a connection problem is a tunnel problem.
  if (/could not (translate host name|connect to server)|connection refused|connection timed out|timeout expired|server closed the connection|connection reset|no route to host/i.test(stderr)) {
    return "TUNNEL_FAILED";
  }
  return null;
}
