import { describe, expect, it } from "vitest";
import { createScrubber, jobSecrets } from "../redact";
import { parseJob } from "../job";

describe("createScrubber", () => {
  it("masks exact secret values anywhere in the text", () => {
    const scrub = createScrubber(["tok-secret-value", "AKIA1234"]);
    expect(scrub("auth failed for tok-secret-value (key AKIA1234)")).toBe("auth failed for *** (key ***)");
  });

  it("still masks URL passwords", () => {
    expect(createScrubber([])("connect postgres://app:pw1234@db/shop failed")).toBe("connect postgres://app:***@db/shop failed");
  });

  it("ignores secrets shorter than 4 characters instead of mangling the text", () => {
    expect(createScrubber(["ab"])("table abstract")).toBe("table abstract");
  });

  it("masks the longer secret first when one contains the other", () => {
    expect(createScrubber(["pass", "pass-longer"])("x pass-longer y")).toBe("x *** y");
  });
});

describe("jobSecrets", () => {
  it("collects the key, db password in both forms, tunnel secrets, and r2 credentials", () => {
    const job = parseJob(JSON.stringify({
      jobId: "j", type: "backup", callbackUrl: "http://x/cb", jobKey: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=", deadlineAt: "2026-10-24T04:00:00Z",
      db: { url: "postgres://app:p%40ss@db:5432/shop", name: "shop" },
      tunnel: { hostname: "h.example.com", tokenId: "tid-1234", tokenSecret: "tsecret-1", localPort: 15432 },
      r2: { endpoint: "http://s3", bucket: "b", accessKeyId: "akid-1", secretAccessKey: "sak-12345", key: "k", partSizeBytes: 5242880 },
    }));
    expect(jobSecrets(job)).toEqual(expect.arrayContaining(["AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=", "p@ss", "p%40ss", "tid-1234", "tsecret-1", "akid-1", "sak-12345"]));
  });
});
