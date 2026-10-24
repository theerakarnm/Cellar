import { describe, expect, it } from "vitest";
import { parsePgUrl, sanitizeDbName } from "../../src/shared/pg-url";

describe("parsePgUrl", () => {
  it("reads host, port, user, and database", () => {
    expect(parsePgUrl("postgres://backup:s3cret@db.example.com:6543/shop")).toEqual({ host: "db.example.com", port: 6543, user: "backup", dbName: "shop" });
  });

  it("defaults the port to 5432 and accepts the postgresql scheme and query parameters", () => {
    expect(parsePgUrl("postgresql://u:p@10.0.0.5/app?sslmode=require")).toEqual({ host: "10.0.0.5", port: 5432, user: "u", dbName: "app" });
  });

  it("accepts a URL without a password", () => {
    expect(parsePgUrl("postgres://u@h/app")?.user).toBe("u");
  });

  it("percent-decodes the user and database name, and accepts a raw @ in the password", () => {
    expect(parsePgUrl("postgres://my%20user:p@ss@h/my%20db")).toEqual({ host: "h", port: 5432, user: "my user", dbName: "my db" });
  });

  it("returns null for anything unusable", () => {
    for (const url of ["", "not a url", "mysql://u:p@h/db", "http://u:p@h/db", "postgres://h/db", "postgres://u:p@/db", "postgres://u:p@h", "postgres://u:p@h/", "postgres://u:p@h/a/b", "postgres://u:p@h:99999/db", "postgres://u:p@h/%E0%A4%A"]) {
      expect(parsePgUrl(url), url).toBeNull();
    }
  });
});

describe("sanitizeDbName", () => {
  it("keeps letters, digits, underscore, and hyphen; replaces everything else with an underscore", () => {
    expect(sanitizeDbName("shop-db_2")).toBe("shop-db_2");
    expect(sanitizeDbName("my db.v2")).toBe("my_db_v2");
    expect(sanitizeDbName("../etc/passwd")).toBe("___etc_passwd");
    expect(sanitizeDbName("ฐานข้อมูล")).toBe("_________");
  });
});
