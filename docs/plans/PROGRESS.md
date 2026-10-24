# Cellar build progress

## Phase 1 - Foundation

Status: complete.

Tasks done: 5.
- haiku: 3 tasks (scaffold, schema, access).
- glm: 2 tasks (crypto, redact).

Sonnet review rounds: 1.
No blockers from sonnet review.
Opus verdict: PASS (round 1).

Commit style: one commit per task plus a phase commit.

Deferred MINOR items (address in later phases):
- redact misses a raw single quote inside a URL password.
- redact does not cover webhook/service-token secrets.
- malformed token a.b.c logs 'verification error' (cosmetic).

## Phase 2 - Targets CRUD API and Audit Log

Tasks done: 16 (haiku: 7, glm: 9).
Sonnet review rounds: 1 (no blockers).
Opus verdict: PASS (round 1).

Deferred MINOR items:
- Concurrent same-name POST returns 500 and leaks D1 error text. Map UNIQUE to 409 and use a generic 500 message.
- cron and timezone fields have no max length.
- parseBody accepts text/plain (possible CSRF angle, uncertain).
- A no-op PATCH with tunnel:{} is audited.
- Some validation messages echo submitted values (cron, channel ids).
- uuidv7 is not monotonic within the same millisecond, so audit order can tie.
- Name-unique race, see first item.
