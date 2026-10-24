import { describe, expect, it } from "vitest";
import { redactError, redactSecrets } from "../../../src/worker/lib/redact";

describe("redactSecrets", () => {
  it("masks the password and keeps the rest of the URL", () => {
    expect(redactSecrets("postgres://app:hunter2@db.internal:5432/shop?sslmode=require")).toBe(
      "postgres://app:***@db.internal:5432/shop?sslmode=require",
    );
  });

  it("leaves URLs without a password unchanged", () => {
    for (const url of ["postgres://app@db.internal:5432/shop", "postgres://db.internal:5432/shop", "postgresql:///shop"]) {
      expect(redactSecrets(url)).toBe(url);
    }
  });

  it("masks URL-encoded passwords", () => {
    const out = redactSecrets("postgres://app:p%40ss%2Fw%3Ard@db:5432/shop");
    expect(out).toBe("postgres://app:***@db:5432/shop");
    expect(out).not.toContain("p%40ss");
  });

  it("masks passwords containing a raw @ or :", () => {
    expect(redactSecrets("postgres://app:p@ss:w0rd@db:5432/shop")).toBe("postgres://app:***@db:5432/shop");
  });

  it("masks passwords containing raw /, ? and # characters", () => {
    for (const password of ["ab/cd", "ab?cd", "ab#cd", "a/b+c==", "x@y/z"]) {
      const out = redactSecrets(`postgres://app:${password}@db:5432/shop`);
      expect(out).toBe("postgres://app:***@db:5432/shop");
    }
  });

  it("masks PGPASSWORD, spaced assignments, and JSON password fields", () => {
    expect(redactSecrets("PGPASSWORD=hunter2 pg_dump")).toBe("PGPASSWORD=*** pg_dump");
    expect(redactSecrets("password = 'my secret'")).toBe("password = ***");
    expect(redactSecrets('{"user":"app","password":"p\\"w","db":"shop"}')).toBe('{"user":"app","password":"***","db":"shop"}');
  });

  it("masks password query parameters and libpq key/value strings", () => {
    expect(redactSecrets("postgres://db/shop?user=app&password=s3cret&sslmode=require")).toBe(
      "postgres://db/shop?user=app&password=***&sslmode=require",
    );
    expect(redactSecrets("host=db user=app password='my secret' dbname=shop")).toBe(
      "host=db user=app password=*** dbname=shop",
    );
  });

  it("masks every URL inside an error message", () => {
    const message =
      'connection to "postgres://app:s3cret@db:5432/shop" failed, retrying postgres://root:t0ps3cret@other:5432/x';
    const out = redactSecrets(message);
    expect(out).toBe('connection to "postgres://app:***@db:5432/shop" failed, retrying postgres://root:***@other:5432/x');
    expect(out).not.toMatch(/s3cret|t0ps3cret/);
  });

  it("leaves plain text alone", () => {
    expect(redactSecrets("pg_dump exited with code 1")).toBe("pg_dump exited with code 1");
    expect(redactSecrets("contact ops@example.com")).toBe("contact ops@example.com");
  });
});

describe("redactError", () => {
  it("redacts Error messages and non-Error values", () => {
    expect(redactError(new Error("fail postgres://u:pw@h/db"))).toBe("fail postgres://u:***@h/db");
    expect(redactError("raw postgres://u:pw@h/db")).toBe("raw postgres://u:***@h/db");
  });
});
