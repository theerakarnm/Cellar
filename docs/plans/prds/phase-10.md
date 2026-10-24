# Phase 10: Documentation and open source files

Read AGENTS.md, docs/PLAN.md, and the existing README.md. Update README.md so every command, env var, script name, and route matches the actual code. Do not describe features that do not exist.

## Create
- LICENSE (MIT)
- CONTRIBUTING.md (setup, phase/test expectations, retention changes require tests)
- SECURITY.md (private disclosure via GitHub Security Advisories)
- docs/vm-onboarding.md (cloudflared compose snippet, backup role SQL for PG13 and PG14+, restore role guidance)
- docs/restore-runbook.md (UI restore, manual pg_restore, verifying a restore)
- .github/workflows/ci.yml (install, typecheck, test)

## Rules
No references to private infrastructure, real hostnames, or real account IDs.

## Done when
Every command in README was cross-checked against package.json and wrangler.jsonc. Output the phase summary and stop.
