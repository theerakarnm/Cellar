# Cellar

> Every Postgres, aged and cellart safe.

**Cellar** is an open source, Cloudflare-native platform that backs up all your self-hosted PostgreSQL databases to Cloudflare R2 from one place. Register a connection, pick a schedule and a retention policy, and Cellar handles the rest: scheduled dumps, automatic cleanup of expired backups, one-click restore, and alerts when something breaks.

> **Status:** early development. APIs, schema, and configuration may change before v1.0.

---

## Why Cellar?

A common setup for small teams and freelancers looks like this:

```
VM 1: docker-compose -> web + api + postgres
VM 2: docker-compose -> web + api + postgres
VM 3: docker-compose -> web + api + postgres
...
```

Each database lives inside its own compose stack, and nobody backs them up because setting up cron + pg_dump + upload + cleanup on every VM is tedious and easy to forget. When a disk dies, the data is gone.

Cellar moves backup into a single control plane:

- **One dashboard** for every database across every VM
- **No open Postgres ports**, databases are reached through Cloudflare Tunnel
- **No servers to run** for the platform itself, it runs on Workers, D1, R2, Queues, and Containers
- **No custom login**, Cloudflare Zero Trust (Access) protects the app

## Features

- **Scheduled backups** - cron expression per database, timezone aware
- **Backup now** - trigger an on-demand backup from the UI
- **Streaming dumps** - `pg_dump -Fc` is streamed straight to R2 via multipart upload, no full buffering on disk or in memory
- **Automatic version matching** - picks a `pg_dump` client that matches your server's major version (PostgreSQL 13 to 18)
- **GFS retention** - keep last N, plus daily, weekly, and monthly tiers, with optional max age
- **Automatic cleanup** - expired backups are deleted from R2 automatically
- **Safety guard** - the most recent successful backup of a database is never deleted
- **Restore** - restore any backup into any registered database, with typed-name confirmation
- **Download** - short-lived presigned links (15 minutes max)
- **Alerts** - LINE and Discord notifications on failure, repeated failures, or "no successful backup in X hours"
- **Encrypted secrets** - connection URLs and tokens are encrypted at rest (AES-256-GCM) and never shown again after saving
- **Audit log** - who created, changed, downloaded, or restored what, and when

## Architecture

```mermaid
flowchart LR
    U[User] -->|Cloudflare Access| W[Worker<br/>Hono API + React UI]
    W <--> D1[(D1<br/>metadata)]
    C[Cron Trigger] --> W
    W --> Q[Queues]
    Q --> CJ[Container job<br/>pg_dump / pg_restore]
    CJ -->|Cloudflare Tunnel| DB1[(Postgres on VM 1)]
    CJ -->|Cloudflare Tunnel| DB2[(Postgres on VM 2)]
    CJ -->|multipart stream| R2[(R2<br/>backup files)]
    CJ -->|signed callback| W
    W -->|alerts| N[LINE / Discord]
```

| Component | Role |
|---|---|
| **Worker** (Hono) | REST API, Access JWT verification, scheduling, retention, alerts, serves the UI |
| **React + Vite SPA** | Dashboard, served via Workers Static Assets |
| **D1** (Drizzle ORM) | Targets, backup runs, policies, alert channels, audit log |
| **Queues** | Job dispatch with per-target and global concurrency limits |
| **Containers** | Run `pg_dump`, `pg_restore`, and connection tests (Workers cannot run these binaries) |
| **R2** | Backup storage |
| **Cloudflare Tunnel** | Private path from Cloudflare to each VM's Postgres, no inbound ports |
| **Cloudflare Access** | Authentication and authorization for the dashboard |

### How a backup runs

1. Every 5 minutes, the Cron Trigger finds databases that are due and enqueues jobs.
2. The Queue consumer starts a Container job (one running job per database at a time).
3. The container connects to Postgres through the Tunnel, detects the server version, and streams `pg_dump -Fc` to R2 while computing a sha256 checksum.
4. The container reports the result (size, checksum, duration, errors) to the Worker via a signed callback.
5. On success, retention runs for that database. On failure, alerts fire.

### Storage layout

```
backups/{targetId}/{YYYY}/{MM}/{DD}/{ISO-timestamp}_{dbname}.dump
```

Backups use the PostgreSQL custom format (`-Fc`), which is compressed and restorable with `pg_restore`.

## Requirements

- A Cloudflare account with access to Workers, D1, R2, Queues, and Containers (Containers require a Workers Paid plan)
- Cloudflare Zero Trust (the free tier is enough for small teams)
- [Bun](https://bun.sh) and [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- Docker (to build the container image locally)
- PostgreSQL 13 or newer on your VMs

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/<your-org>/cellar.git
cd cellar
bun install
```

### 2. Create Cloudflare resources

```bash
wrangler d1 create cellar-db
wrangler r2 bucket create cellar-backups
wrangler queues create cellar-jobs
```

Copy the generated IDs into `wrangler.jsonc`.

### 3. Run database migrations

```bash
bun run db:migrate:remote
```

### 4. Set secrets

```bash
wrangler secret put ENCRYPTION_KEY          # 32-byte base64 key, see below
wrangler secret put ACCESS_TEAM_DOMAIN      # e.g. yourteam.cloudflareaccess.com
wrangler secret put ACCESS_AUD              # Access application AUD tag
wrangler secret put CALLBACK_HMAC_SECRET    # random string for container callbacks
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID        # R2 API token scoped to the backup bucket
wrangler secret put R2_SECRET_ACCESS_KEY
```

Generate an encryption key:

```bash
openssl rand -base64 32
```

> **Keep `ENCRYPTION_KEY` safe.** If you lose it, stored connection URLs cannot be decrypted and every database must be re-registered. Backups in R2 are not affected.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the values.

### 5. Deploy

```bash
bun run deploy
```

### 6. Protect the app with Cloudflare Access

1. In Zero Trust, go to **Access > Applications > Add an application > Self-hosted**.
2. Set the application domain to your Cellar hostname.
3. Add a policy (for example, allow emails ending in `@yourcompany.com`).
4. Copy the **Application Audience (AUD) tag** into the `ACCESS_AUD` secret.

Cellar verifies the Access JWT on every request. Requests without a valid token are rejected with `401`.

## Connecting a database (per VM)

Do this once for each VM that hosts a database.

### 1. Create a tunnel

In Zero Trust, go to **Networks > Tunnels**, create a tunnel, and copy its token. Add a public hostname of type **TCP** (for example `db-shop.example.com`) pointing to `postgres:5432`, and protect it with an Access application that allows a **service token**.

### 2. Add `cloudflared` to the app's docker-compose

```yaml
services:
  postgres:
    image: postgres:16
    # no "ports:" section needed, keep Postgres private
    volumes:
      - pgdata:/var/lib/postgresql/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    restart: unless-stopped
    depends_on:
      - postgres

volumes:
  pgdata:
```

```bash
docker compose up -d cloudflared
```

### 3. Create a dedicated backup role

Run this inside the database (PostgreSQL 14+):

```sql
CREATE ROLE cellar_backup WITH LOGIN PASSWORD 'use-a-strong-password';
GRANT pg_read_all_data TO cellar_backup;
```

For PostgreSQL 13, grant `CONNECT`, `USAGE` on schemas, and `SELECT` on all tables and sequences instead.

> The backup role is read only. Restoring requires a role that can create and drop objects in the target database, so Cellar asks for a restore-capable connection at restore time.

### 4. Register it in Cellar

In the dashboard, select **Add database** and fill in:

- **Name** and optional **project tag**
- **Connection URL**, e.g. `postgresql://cellar_backup:***@localhost:5432/shop`
- **Connection mode**: `tunnel`, with the tunnel hostname and service token
- **Schedule**, e.g. `0 2 * * *` (every day at 02:00) and timezone
- **Retention policy**
- **Alert channels**

Click **Test connection**. Cellar shows the server version and database size if everything is reachable.

## Retention (GFS)

Each database has its own policy:

| Setting | Meaning |
|---|---|
| `keep_last` | Always keep the N most recent successful backups |
| `daily` | Keep one backup per day for the last N days |
| `weekly` | Keep one backup per week for the last N weeks |
| `monthly` | Keep one backup per month for the last N months |
| `max_age_days` | Optional hard limit, anything older is deleted |

A backup is cellart if **any** rule wants to keep it. Everything else is deleted from R2 and marked `deleted` in D1 (the record stays for the audit trail).

Example: `keep_last=3, daily=7, weekly=4, monthly=6` keeps roughly 7 to 20 backups covering six months.

Retention runs after every successful backup and once a day. The target detail page shows a **retention preview** of what will be deleted next.

**Safety rule:** the most recent successful backup of a database is never deleted, regardless of policy.

## Restoring a backup

1. Open the database, choose a backup from the history, and select **Restore**.
2. Choose the destination database (it must be registered in Cellar).
3. Type the destination name to confirm.

Cellar runs:

```bash
pg_restore --clean --if-exists --no-owner -d <destination> <backup>
```

> Restoring with `--clean` drops and recreates objects in the destination. Cellar shows an extra warning when you restore into the same database the backup came from. Test restores into a scratch database first.

To restore manually, use **Download** to get a presigned link, then:

```bash
pg_restore --clean --if-exists --no-owner -d "postgresql://..." backup.dump
```

## Alerts

Configure channels under **Settings > Alert channels**:

- **LINE** - Messaging API channel access token and target user or group ID
- **Discord** - webhook URL

Alerts fire when:

- a backup fails or times out
- a database fails N times in a row
- a database has no successful backup within X hours (staleness check)

Alert messages never include connection strings or passwords.

## Security

- **Authentication:** Cloudflare Access, with JWT signature, audience, and expiry checked on every request
- **Network:** Postgres stays private behind Cloudflare Tunnel, no public ports
- **Secrets at rest:** connection URLs, service tokens, and alert credentials are encrypted with AES-256-GCM before being stored in D1
- **Secrets in transit:** plaintext values are never returned by the API after saving, and are redacted from logs, errors, and alerts
- **Least privilege:** use a read-only role for backups and a separate, scoped R2 token for the bucket
- **Downloads:** presigned URLs expire in 15 minutes or less, and every download is logged
- **Container callbacks:** signed with HMAC so results cannot be forged

Found a vulnerability? Please do not open a public issue. See [SECURITY.md](SECURITY.md).

## Limits and considerations

- Backup speed depends on the Tunnel and the container's network throughput. Very large databases (hundreds of GB) may hit container runtime limits. Check the current [Cloudflare Containers limits](https://developers.cloudflare.com/containers/) for your plan.
- Cellar makes logical backups with `pg_dump`. It does not do point-in-time recovery (PITR) or WAL archiving. For that, look at tools like pgBackRest or WAL-G.
- R2 storage is billed by Cloudflare. Retention policies directly control your storage cost, and the dashboard shows total size per database.

## Development

```bash
bun install
bun run db:migrate:local
bun run dev           # Worker + UI with local D1 and R2
bun run test          # Vitest
bun run typecheck
```

Project layout:

```
cellar/
├── src/
│   ├── worker/       # Hono API, cron, queue consumer, retention, alerts
│   ├── ui/           # React + Vite dashboard
│   └── shared/       # Zod schemas, types
├── container/        # Dockerfile and job runner (pg_dump / pg_restore)
├── migrations/       # Drizzle migrations for D1
├── wrangler.jsonc
└── .dev.vars.example
```

The retention logic lives in a pure function, `selectBackupsToDelete(backups, policy, now, tz)`, with full unit test coverage. Any change to retention must include tests.

## Roadmap

- [ ] v0.1 - targets, scheduled backups, R2 upload, retention
- [ ] v0.2 - restore, download, alerts
- [ ] v0.3 - dashboard polish, audit log viewer
- [ ] Later - backup verification (automatic test restores), client-side encryption of dump files, per-project access rules, more alert channels

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

1. Fork the repo and create a branch
2. Make your change with tests
3. Run `bun run test` and `bun run typecheck`
4. Open a pull request describing what and why

## License

[MIT](LICENSE)
