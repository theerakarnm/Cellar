# Security policy

Cellar is in early development.
Only the latest commit on `main` receives security fixes.

## Report a vulnerability

Please do not open a public issue, pull request, or discussion for a security problem.

Use GitHub Security Advisories instead:

1. Open the **Security** tab of this repository.
2. Select **Report a vulnerability**.
3. Describe the problem, the steps to reproduce it, and the impact.

Only you and the maintainers can see the report.
We will confirm that we received it, work on a fix with you, and publish an advisory when the fix is released.

Never put a real connection string, token, key, or password in a report.
Replace secrets with placeholders.

## What counts as a vulnerability

- A way to call the API without a valid Cloudflare Access token.
- A way to forge or replay a container callback.
- Any path that shows a connection URL, tunnel token, alert credential, or R2 credential in plaintext after it is saved, in a log, in an error, or in an alert.
- Deleting or overwriting a backup or a database without the confirmation the product requires.
- A weakness in the encryption of stored secrets.
