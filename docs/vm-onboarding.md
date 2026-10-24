# VM onboarding

Do this once for each VM that hosts a Postgres database you want Cellar to back up.
Cellar never needs an open Postgres port.
It reaches the database through Cloudflare Tunnel.

You will:

1. Add a tunnel to the VM's docker-compose stack.
2. Protect the tunnel hostname with Cloudflare Access and a service token.
3. Create a read-only backup role.
4. Prepare a restore role.
5. Register the database in Cellar and test it.

> **To verify at first deploy.** Cellar has been tested against local stand-ins for the tunnel, the container, and storage.
> The path through a real Cloudflare Tunnel with a real Access application and a real service token has not been exercised yet.
> Register your first database, run the connection test, and only then rely on scheduled backups.

## 1. Create a tunnel and add `cloudflared` to the compose stack

In Cloudflare Zero Trust, go to **Networks > Tunnels** and create a tunnel.
Copy the tunnel token.
Add a public hostname of type **TCP**, for example `db-shop.example.com`, that points to `postgres:5432`.
The name `postgres` must match the Postgres service name in your compose file.

Add `cloudflared` next to Postgres:

```yaml
services:
  postgres:
    image: postgres:16
    # No "ports:" section. Keep Postgres private.
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

Put `CLOUDFLARE_TUNNEL_TOKEN` in the `.env` file next to the compose file, then start it:

```bash
docker compose up -d cloudflared
```

`latest` is fine for a first try.
For production, pin `cloudflared` to a release tag you have tested.

## 2. Protect the hostname with Access and a service token

Cellar's container logs in to the tunnel hostname with a service token.
No person signs in.

1. Go to **Access > Service Auth > Service Tokens** and create a token for Cellar.
   Copy the **Client ID** and **Client Secret**.
   The secret is shown only once.
2. Go to **Access > Applications > Add an application > Self-hosted**.
   Set the application domain to the tunnel hostname, for example `db-shop.example.com`.
3. Add one policy with action **Service Auth**.
   Include only the Cellar service token.
   Do not add an identity provider rule.

Dashboard menu names change from time to time.
See the Cloudflare docs on [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) and [arbitrary TCP applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/cloudflared-authentication/arbitrary-tcp/) if a screen looks different.

## 3. Create the backup role

The backup role is read-only.
Cellar supports PostgreSQL 13 to 18.
Run the SQL as a superuser or the database owner, connected to the database you are backing up (here `shop`).
Replace the password.

### PostgreSQL 14 and newer

```sql pg14
CREATE ROLE cellar_backup WITH LOGIN PASSWORD 'use-a-strong-password';
GRANT CONNECT ON DATABASE shop TO cellar_backup;
GRANT pg_read_all_data TO cellar_backup;
```

### PostgreSQL 13

The role `pg_read_all_data` does not exist before PostgreSQL 14.
Grant read access on every schema explicitly instead:

```sql pg13
CREATE ROLE cellar_backup WITH LOGIN PASSWORD 'use-a-strong-password';
GRANT CONNECT ON DATABASE shop TO cellar_backup;

DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace
           WHERE nspname NOT IN ('pg_catalog', 'information_schema')
             AND nspname NOT LIKE 'pg\_%' ESCAPE '\'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO cellar_backup', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO cellar_backup', s);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO cellar_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO cellar_backup', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON SEQUENCES TO cellar_backup', s);
  END LOOP;
END
$$;
```

Notes for PostgreSQL 13:

- `ALTER DEFAULT PRIVILEGES` only covers objects created later by the role that runs it.
  If your app creates tables as another role, also run `ALTER DEFAULT PRIVILEGES FOR ROLE <app_owner> IN SCHEMA <schema> GRANT SELECT ON TABLES TO cellar_backup;` (and the same for `SEQUENCES`).
- Run the block again after you add a new schema.
- If the database uses large objects, `pg_dump` also needs `SELECT` on them.
  The Cellar project has not tested this case.

### Check the backup role

From the VM, run both commands:

```bash
docker compose exec -T postgres pg_dump -U cellar_backup -d shop -Fc > /dev/null && echo dump-ok
docker compose exec -T postgres psql -U cellar_backup -d shop -Atc "SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'cellar_backup' AND privilege_type <> 'SELECT'"
```

The first command prints `dump-ok` when the role can read everything.
The second prints `0` when the role holds no write privilege on any table.

PostgreSQL 14 and older let every role create objects in the schema `public` by default.
That is a Postgres default and not a Cellar setting.

## 4. Restore role

Cellar restores with a separate connection URL, the **restore URL**, that you enter when you register the database.
The backup role cannot be used for restore.
A database without a restore URL cannot be a restore destination.

Cellar runs `pg_restore --clean --if-exists --no-owner`.
This drops and recreates every object in the dump.
With `--no-owner`, restored objects belong to the role that connects.
Cellar picks the `pg_restore` binary that matches the destination server's major version (PostgreSQL 13 to 18).

Use these roles:

- **Scratch database (recommended for practice).**
  Create a role and a database it owns.
  The role then has all the rights a restore needs.

  ```sql restore
  CREATE ROLE cellar_restore WITH LOGIN PASSWORD 'use-a-strong-password';
  CREATE DATABASE shop_restore_test OWNER cellar_restore;
  ```

- **Real database.**
  Use the role that owns the objects, normally your app's owner role.
  Then the restored objects keep the right owner and your app still works after the restore.
  Do not use a superuser unless you must.
- **Extensions.**
  `pg_restore` re-creates extensions.
  A role that is not a superuser can do this only for trusted extensions.
  Create other extensions in the destination database first.

Cellar never creates databases.
The database named in the restore URL is the database Cellar restores into.
The destination database must already exist.

When you start a restore, Cellar always asks you to type the destination target's name.
If the destination is the database the backup came from, you must also confirm the overwrite.
The step-by-step restore procedure lives in `docs/restore-runbook.md`.

## 5. Register the database in Cellar

In the dashboard, select **New target** and fill in:

- **Name** and an optional **project tag**
- **Connection URL**, for example `postgresql://cellar_backup:use-a-strong-password@db-shop.example.com:5432/shop` (the host is the tunnel hostname, Cellar swaps it for the local tunnel port at run time)
- **Restore connection URL** (optional, needed to restore into this database)
- **Tunnel hostname** and the service token ID and secret (all required)
- **Schedule**, for example `0 2 * * *` (every day at 02:00), and the time zone (default Asia/Bangkok)
- **Retention policy** (keep last, daily, weekly, monthly, and an optional max age in days)
- **Alert channels**, the failure threshold, and an optional staleness limit

Cellar tests a database only after it is saved.
The form therefore saves the database as **disabled** first.
Then:

1. Click **Test connection** on the target's page.
   Cellar shows the server version and whether the backup role can read all data.
2. When the test passes, select **Enable target**.
   Scheduled backups start only after that.

A disabled database never runs scheduled backups.

Retention deletes expired backups only after the owner turns the retention dry run off in Settings.
The dry run is ON by default: Cellar only logs what it would delete.
When deletion runs, Cellar removes at most 50 backups per run and never the newest successful backup of a target.

Cellar sends alerts to the LINE and Discord channels you link to the database.
Delivery to real LINE and Discord accounts has not been tested yet, so send a test message after you add a channel.
