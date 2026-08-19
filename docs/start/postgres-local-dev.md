---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Postgres local development

Postgres is **the** server data backend — workflows, processes, agent runs,
events, tasks and secrets all live here (ADR-0001). There is no Firestore data
layer, and auth moved off Firebase to NextAuth (ADR-0002). `pnpm dev` starts
Postgres and auto-runs migrations; these are the devloop notes for everything
past that.

Command lookup: [dev-quickref.md](dev-quickref.md). Migration strategy and
rules: [PLAN-0001 §8.5](../archive/PLAN-0001.md#85-ongoing-migrations).

## Reset

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev
```

`-v` drops the persistent `mediforce-dev-pgdata` volume; `pnpm dev` recreates the
container and re-applies all migrations.

## Generate a migration

Edit a schema file under `packages/platform-infra/src/postgres/schema/`, then
`pnpm db:generate`. Commit the new `NNNN_description.sql` plus the journal entry,
and `pnpm db:migrate` to apply locally. Branch-collision rename rule:
[PLAN-0001 §10.1](../archive/PLAN-0001.md#101-migration-filename-rule).

## Inspect migration state

Drizzle's ledger is `drizzle.__drizzle_migrations` (two underscores):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres \
  psql -U mediforce -d mediforce \
  -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations;'
```

Compare against `packages/platform-infra/src/postgres/migrations/meta/_journal.json`
if you suspect drift.

## Run parity tests against a real Postgres

```bash
TEST_DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce \
  pnpm --filter @mediforce/platform-infra exec vitest run src/postgres
```

CI runs the same suite (job `postgres-repository-tests`) plus an L3 API E2E job
(`e2e-tests-postgres`) exercising the route handler → repo → DB trip.

## Troubleshooting

- **`relation "..." does not exist`** — run `pnpm db:migrate`.
- **Migration applied but table missing** — duplicate `idx` in `_journal.json`
  from a rebase. See [PLAN-0001 §10.1](../archive/PLAN-0001.md#101-migration-filename-rule).
- **Too many connections** — raise `POOL_MAX` in
  `packages/platform-infra/src/postgres/client.ts` or Postgres `max_connections`.
  The pool is shared per process via `getSharedPostgresClient()`.

`DATABASE_URL` errors and other boot-time symptoms:
[dev-quickref.md](dev-quickref.md#troubleshooting).
