#!/usr/bin/env bash
# Tunnel spike: proves that cloudflared + a service token reaches a real Postgres from inside the image.
# Run it inside the image (see Task 2). All credentials come from the environment, never from a file or argv.
# Required env: SPIKE_HOSTNAME, TUNNEL_SERVICE_TOKEN_ID, TUNNEL_SERVICE_TOKEN_SECRET, PGUSER, PGPASSWORD, PGDATABASE
set -euo pipefail

for name in SPIKE_HOSTNAME TUNNEL_SERVICE_TOKEN_ID TUNNEL_SERVICE_TOKEN_SECRET PGUSER PGPASSWORD PGDATABASE; do
  if [ -z "${!name:-}" ]; then echo "missing env var: $name" >&2; exit 2; fi
done

PORT="${SPIKE_LOCAL_PORT:-15432}"
LOG="$(mktemp)"
redact() { sed -e "s/${TUNNEL_SERVICE_TOKEN_SECRET}/***/g" -e "s/${PGPASSWORD}/***/g"; }

cloudflared access tcp --hostname "$SPIKE_HOSTNAME" --url "127.0.0.1:${PORT}" --loglevel info >"$LOG" 2>&1 &
CF_PID=$!
trap 'kill "$CF_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if (echo > "/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then break; fi
  if ! kill -0 "$CF_PID" 2>/dev/null; then echo "cloudflared exited early:" >&2; redact <"$LOG" >&2; exit 1; fi
  sleep 0.5
done

export PGHOST=127.0.0.1 PGPORT="$PORT"
PG18=/usr/lib/postgresql/18/bin
if ! "$PG18/psql" -X -At --no-password -c "select version()"; then
  echo "psql failed. cloudflared log:" >&2; redact <"$LOG" >&2; exit 1
fi
BYTES="$("$PG18/pg_dump" --format=custom --schema-only --no-password | wc -c)"
echo "schema-only pg_dump streamed ${BYTES} bytes through the tunnel"
if [ "$BYTES" -le 0 ]; then echo "pg_dump produced no data" >&2; exit 1; fi
echo "SPIKE OK"
