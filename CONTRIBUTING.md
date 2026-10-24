# Contributing to Cellar

Thank you for helping.
This page covers setup, the checks to run before a pull request, and the rules that are strict.

## Set up

You need [Bun](https://bun.sh).
`bun run dev` also needs Docker, because the job container runs locally with it.
Running `bun run dev` with Docker has not been verified yet (see the Quick start note in the README).
Without Docker, run the tests and typecheck, and serve the API alone.
`wrangler dev` refuses to start while the built UI folder is missing, so build the UI first:

```bash
bun run build:ui
bunx wrangler dev --local --enable-containers=false
```

```bash
git clone https://github.com/theerakarnm/cellar.git
cd cellar
bun install
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run dev
```

Fill in `.dev.vars` with fake values.
Set `DEV_BYPASS=true` to skip Cloudflare Access on `localhost` only.
Never commit `.dev.vars`.

## Layout

- `src/worker/` is the Worker: the Hono API, cron, queue consumer, retention, and alerts.
- `src/shared/` is code used by both the Worker and the UI.
- `ui/` is the React and Vite dashboard.
- `container/` is the image and job runner for `pg_dump` and `pg_restore`.
- `migrations/` holds the Drizzle migrations for D1.
- `test/` holds the Vitest tests, in folders that follow the source.
- `scripts/` holds the local dev launcher and the docs check.

## Before you open a pull request

Run these commands.
CI runs the first two and the docs check.

```bash
bun run typecheck
bun run test
bun scripts/check-readme.ts
```

The docs check compares `README.md`, this file, `SECURITY.md`, `docs/vm-onboarding.md`, `docs/restore-runbook.md`, and `docs/alerts.md` with the code.
It checks scripts, environment variables, routes, resource names, and links.

Rules:

- Add tests for new behavior and for every bug fix.
- Changes to retention need tests.
  The rules live in the pure function `selectBackupsToDelete` in `src/worker/retention/gfs.ts`.
  A bug there deletes backups, so keep the tests for every rule and for the rule that the latest successful backup is never deleted.
- Change the database with a new migration: `bun run db:generate -- --name <what>`.
  Never edit a migration that has already been applied.
- Never run `wrangler deploy`, `bun run deploy`, `bun run db:migrate:remote`, or any command that changes real Cloudflare resources from a pull request.
- Never commit secrets, real hostnames, or account IDs.
  Use `example.com` placeholders.
- Never log or return connection URLs, tokens, or credentials.
  Use `redactSecrets` and `redactError` from `src/worker/lib/redact.ts`.
- Do not add a dependency without asking first.
  The stack is fixed, see `AGENTS.md`.

## How work is planned

Work is split into phases.
The phase list is in `docs/PLAN.md`, and each phase has a plan in `docs/plans/`.
Progress notes are in `docs/plans/PROGRESS.md`.
In your pull request description, say what you finished, what you tested and the result, and what is still open.

## Reporting security problems

Do not open a public issue.
See [SECURITY.md](SECURITY.md).
