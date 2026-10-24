# Phase 4: Container image and job runner (standalone, tested locally)

Read AGENTS.md and docs/PLAN.md (especially the container job contract and the Tunnel approach). This phase touches ONLY /container and a local test compose file.

## Build
1. /container/Dockerfile: Debian slim, postgresql-client 13 through 18, cloudflared, and a small runner (TypeScript on Bun, or a shell script if PLAN.md chose that).
2. Runner commands, input as JSON per the contract in PLAN.md:
   - `test`: connect, return server version + DB size
   - `backup`: detect server major version, pick matching pg_dump, stream `pg_dump -Fc` into R2 multipart upload, compute sha256 + byte count while streaming
   - `restore`: download from R2 and pipe into `pg_restore --clean --if-exists --no-owner`
   - Tunnel mode: start the access method chosen in PLAN.md, wait until the local port is ready (with timeout), then run the command
3. After each command, POST the result to the callback URL with an HMAC-SHA256 signature header. Errors are redacted before sending.
4. Hard timeout per job. Non-zero exit on failure.

## Local verification
- Add test/docker-compose.test.yml with Postgres 14 and 17 seeded with sample data, plus MinIO as a local S3 stand-in for R2.
- Run test, backup, and restore against both versions. Restore into a scratch DB and compare row counts.
- Generate a ~2 GB DB and back it up while limiting container memory to 256 MB, to prove streaming.

## Stop and ask before
Using a real R2 bucket or any Cloudflare account resource.

## Done when
All local verifications pass and you show the commands + results. Output the phase summary and stop.
