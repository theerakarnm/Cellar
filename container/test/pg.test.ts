import { describe, expect, it } from "vitest";
import { JobError } from "../job";
import { assertSupportedMajor, classifyConnectionFailure, parsePgUrl, parseProbe, pgBinary, pgEnv } from "../pg";

describe("parsePgUrl", () => {
  it("decodes credentials and reads the supported query parameters", () => {
    const connection = parsePgUrl("postgresql://app%40corp:p%40ss%2Fw@db.internal:6543/my%20db?sslmode=require&connect_timeout=10&application_name=cellar");
    expect(connection).toEqual({
      host: "db.internal", port: 6543, user: "app@corp", password: "p@ss/w", database: "my db",
      sslmode: "require", connectTimeout: "10", applicationName: "cellar",
    });
  });

  it("defaults the port to 5432", () => {
    expect(parsePgUrl("postgres://u:p@h/d").port).toBe(5432);
  });

  it("maps to libpq env vars and omits unset options", () => {
    const env = pgEnv(parsePgUrl("postgres://u:p@h:5433/d?sslmode=disable"));
    expect(env).toEqual({ PGHOST: "h", PGPORT: "5433", PGUSER: "u", PGPASSWORD: "p", PGDATABASE: "d", PGSSLMODE: "disable" });
  });

  it("rejects bad URLs without echoing them", () => {
    for (const url of ["not a url", "mysql://u:p@h/d", "postgres://h/d", "postgres://u:hunter2@h/", "postgres://u:hunter2@h/d?options=-c%20x"]) {
      try {
        parsePgUrl(url);
        throw new Error("expected throw");
      } catch (error) {
        expect(error).toBeInstanceOf(JobError);
        expect((error as JobError).message).not.toContain("hunter2");
        expect((error as JobError).message).not.toContain(url);
      }
    }
  });
});

describe("server probe", () => {
  it("parses version, size, and the read-all role flag", () => {
    expect(parseProbe("140010|14.10 (Debian 14.10-1.pgdg120+1)|8388608|true\n")).toEqual({
      major: 14, pgServerVersion: "14.10", dbSizeBytes: 8388608, hasReadAllData: true,
    });
    expect(parseProbe("170002|17.2|1|false").hasReadAllData).toBe(false);
  });

  it("reports hasReadAllData null on PostgreSQL 13, where the role does not exist", () => {
    expect(parseProbe("130023|13.23|1024|")).toMatchObject({ major: 13, hasReadAllData: null });
  });

  it("rejects garbage output", () => {
    expect(() => parseProbe("psql: error")).toThrow(JobError);
  });

  it("selects the binary by major and enforces 13-18", () => {
    expect(pgBinary(16, "pg_dump")).toBe("/usr/lib/postgresql/16/bin/pg_dump");
    expect(() => assertSupportedMajor(12)).toThrow("not supported");
    expect(() => assertSupportedMajor(19)).toThrow("not supported");
    expect(() => assertSupportedMajor(13)).not.toThrow();
    expect(() => assertSupportedMajor(18)).not.toThrow();
  });
});

describe("classifyConnectionFailure", () => {
  it("separates auth failures from tunnel connection failures", () => {
    expect(classifyConnectionFailure('FATAL:  password authentication failed for user "app"')).toBe("AUTH_FAILED");
    expect(classifyConnectionFailure("connection to server at \"127.0.0.1\", port 15432 failed: server closed the connection unexpectedly")).toBe("TUNNEL_FAILED");
    expect(classifyConnectionFailure("connection to server at \"127.0.0.1\", port 15432 failed: Connection refused")).toBe("TUNNEL_FAILED");
    expect(classifyConnectionFailure("syntax error at or near")).toBeNull();
  });
});
