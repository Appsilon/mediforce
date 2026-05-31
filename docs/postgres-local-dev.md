# Postgres local development

Postgres is **the** server data backend — all workflows, processes, agent runs,
events, tasks, and secrets live here (ADR-0001). There is no Firestore data
layer; Firebase remains only for Auth/Storage. These are the devloop notes for
working with the local DB.

Zero-to-running setup: [GETTING-STARTED.md](../GETTING-STARTED.md). Terse
command lookup: [dev-quickref.md](dev-quickref.md). `pnpm dev` starts Postgres
and auto-runs migrations. Migration strategy and rules live in
[PLAN-0001 §8.5](adr/PLAN-0001.md#85-ongoing-migrations).

## Reset

Wipe the data, restart from migrations:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev
```

`-v` drops the persistent `mediforce-dev-pgdata` volume; `pnpm dev` then
recreates the container and re-applies all migrations.

## Inspect migration state

Drizzle's ledger is `drizzle.__drizzle_migrations` (two underscores):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec postgres \
  psql -U mediforce -d mediforce \
  -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations;'
```

Compare against `packages/platform-infra/src/postgres/migrations/meta/_journal.json`
if you suspect drift.

## Generate a new migration

Edit a schema file under `packages/platform-infra/src/postgres/schema/`, then:

```bash
pnpm db:generate
```

Commit the new `NNNN_description.sql` plus the journal entry. Re-run
`pnpm db:migrate` to apply locally. See
[PLAN-0001 §10.1](adr/PLAN-0001.md#101-migration-filename-rule) for the
branch-collision rename rule.

## Run parity tests against a real Postgres

```bash
TEST_DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce \
  pnpm --filter @mediforce/platform-infra exec vitest run src/postgres
```

CI runs the same suite (job `postgres-repository-tests`) plus an L3 API E2E job
(`e2e-tests-postgres`) exercising the route handler → repo → DB trip.

## Troubleshooting

- **`relation "tool_catalog_entries" does not exist`** — run `pnpm db:migrate`.
- **`DATABASE_URL is required` at boot** — any non-mock mode needs it
  (`validateEnv` in `instrumentation-node.ts` fails fast). `pnpm dev` wires it
  automatically; for `pnpm dev:no-docker` start Postgres first or set the URL.
  `pnpm dev:mock` is the only mode that runs without it.
- **Migration applied but table missing** — duplicate `idx` in `_journal.json`
  from a rebase. See [PLAN-0001 §10.1](adr/PLAN-0001.md#101-migration-filename-rule).
- **Too many connections** — bump `POOL_MAX` in
  `packages/platform-infra/src/postgres/client.ts` or raise Postgres
  `max_connections`. The pool is shared per process via
  `getSharedPostgresClient()`.
