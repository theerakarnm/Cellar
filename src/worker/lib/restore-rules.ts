export const MAX_DOWNLOAD_TTL_SECONDS = 900;

export function clampDownloadTtl(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return MAX_DOWNLOAD_TTL_SECONDS;
  const whole = Math.floor(raw);
  if (whole < 1) return MAX_DOWNLOAD_TTL_SECONDS;
  return Math.min(whole, MAX_DOWNLOAD_TTL_SECONDS);
}

export function destinationDbNameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
  let name: string;
  try {
    name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
  return name === "" || name.includes("/") ? null : name;
}
