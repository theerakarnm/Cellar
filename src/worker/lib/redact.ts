export const REDACTED = "***";

// scheme://user:password@host - the password is everything after the first ":" in the user-info,
// up to the LAST "@" in the same whitespace/quote-free run, so raw "@", "/", "?" and "#" inside a
// password are still masked. Over-masking is accepted: it fails safe.
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^\s'"]*)@/gi;
// password=value, PGPASSWORD=value, db_password = 'value' (query strings, libpq strings, env lines).
const PASSWORD_PAIR = /(\b[a-z_]*pass(?:word|wd)?\s*=\s*)('[^']*'|"[^"]*"|[^\s&;'"]+)/gi;
// "password": "value" in JSON.
const PASSWORD_JSON = /("[a-z_]*pass(?:word|wd)?"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

export function redactSecrets(input: string): string {
  return input
    .replace(URL_USERINFO, (match, scheme: string, userinfo: string) => {
      const colon = userinfo.indexOf(":");
      if (colon === -1) return match;
      return `${scheme}${userinfo.slice(0, colon)}:${REDACTED}@`;
    })
    .replace(PASSWORD_PAIR, `$1${REDACTED}`)
    .replace(PASSWORD_JSON, `$1"${REDACTED}"`);
}

export function redactError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
