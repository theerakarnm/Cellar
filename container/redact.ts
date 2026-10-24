import { REDACTED, redactSecrets } from "../src/worker/lib/redact";
import type { Job } from "./job";
import { parsePgUrl } from "./pg";

const MIN_SECRET_LENGTH = 4;

/** Returns a function that masks URL passwords, password pairs, and every exact secret value. */
export function createScrubber(secrets: string[]): (text: string) => string {
  const exact = [...new Set(secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH))].sort(
    (a, b) => b.length - a.length,
  );
  return (text) => exact.reduce((out, secret) => out.split(secret).join(REDACTED), redactSecrets(text));
}

/** Every secret value carried by a job, including the URL-encoded form of the database password. */
export function jobSecrets(job: Job): string[] {
  const secrets = [job.jobKey];
  try {
    const { password } = parsePgUrl(job.db.url);
    secrets.push(password, encodeURIComponent(password));
  } catch {
    // An unparsable URL fails later with its own error; the URL regex in redactSecrets still covers it.
  }
  secrets.push(job.tunnel.tokenId, job.tunnel.tokenSecret);
  if (job.r2) secrets.push(job.r2.accessKeyId, job.r2.secretAccessKey);
  return secrets;
}
