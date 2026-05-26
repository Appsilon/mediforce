# Postgres local development

Companion to [ADR-0001](adr/0001-firestore-to-postgres.md) and
[PLAN-0001](adr/PLAN-0001.md). Practical notes for running the Postgres
path locally during the implementation phase.

## Boot the database

`docker-compose.yml` ships a `postgres:16-alpine` service with a named
volume so data survives container restarts.

```bash
docker compose up postgres -d                  # Postgres only
docker compose up postgres redis -d            # Postgres + Redis (for queue mode)
```

Default credentials (local dev only — never these in any deployed env):

- user: `mediforce`
- password: `mediforce`
- database: `mediforce`
- URL: `postgresql://mediforce:mediforce@localhost:5432/mediforce`

## Wire the app

Add to `packages/platform-ui/.env.local`:

```bash
STORAGE_BACKEND=postgres
DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce
# DATABASE_POOL_MAX=10   # optional override; default 10
```

Apply migrations once (creates tables, registers them in drizzle's
`__drizzle_migrations` ledger):

```bash
pnpm db:migrate
```

Then `pnpm dev`. The dev server does NOT auto-migrate — schema is an
operator concern, not part of the app boot path. Re-run `pnpm db:migrate`
any time you pull new migrations from main (it's idempotent — already-
applied migrations are skipped via drizzle's ledger).

> Docker production deploys are different: the platform-ui container's
> CMD wraps `node packages/platform-ui/scripts/migrate-postgres.mjs && node server.js`,
> so prod auto-applies pending migrations before the app starts. Local
> dev runs outside Docker → manual `pnpm db:migrate`.

Repositories that have been migrated to Postgres (see
[PLAN-0001 §5.2](adr/PLAN-0001.md#52-build-order-postgres-implementations))
route through Postgres. Unmigrated repos still hit Firestore — the
`STORAGE_BACKEND` flag is per-repo, decided by a ternary in
`getPlatformServices()`.

## Reset the database

Drop the volume to start clean — useful when iterating on schema:

```bash
docker compose down                       # stop containers
docker compose down -v                    # stop + delete named volumes
docker compose up postgres -d             # fresh database
```

Re-run `pnpm db:migrate` to re-create the schema from scratch, then
`pnpm dev`.

## Inspect migration state

drizzle stores its ledger in `drizzle.__drizzle_migrations` (schema
`drizzle`, table `__drizzle_migrations` — two underscores, drizzle's own
convention). Inspect via the container:

```bash
docker compose exec postgres psql -U mediforce -d mediforce -c '\dt'
docker compose exec postgres \
  psql -U mediforce -d mediforce \
  -c 'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations;'
```

Each row is one applied migration file. `hash` is the SHA of the SQL;
`created_at` is when the app last applied it. If you suspect drift,
compare this list against
`packages/platform-infra/src/postgres/migrations/meta/_journal.json`.

## Generate a new migration

Edit the schema under
`packages/platform-infra/src/postgres/schema/`, then:

```bash
DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce \
  pnpm --filter @mediforce/platform-infra db:generate
```

drizzle-kit diffs schema-vs-existing-migrations and emits a new
`NNNN_description.sql` plus a journal entry. Commit both. Re-run
`pnpm db:migrate` to apply locally. See
[PLAN-0001 §10.1](adr/PLAN-0001.md#101-migration-filename-rule) for the
branch-collision rename rule.

## Migration commands (root scripts)

```bash
pnpm db:migrate     # apply pending migrations (idempotent)
pnpm db:generate    # generate a new migration from schema diffs
```

Both forward to `drizzle-kit` inside `packages/platform-infra`. Need
`DATABASE_URL` in env (or the worktree's `packages/platform-infra/.env`).

## Run the parity tests

Each Postgres repository ships a parity test that runs the same suite
against the in-memory double and the live Postgres container. With
Postgres running on the default port:

```bash
TEST_DATABASE_URL=postgresql://mediforce:mediforce@localhost:5432/mediforce \
  pnpm --filter @mediforce/platform-infra exec vitest run
```

CI runs the same suite — see `.github/workflows/ci.yml`.

## Troubleshooting

- **`DATABASE_URL is not set` at boot.** Check
  `packages/platform-ui/.env.local`. `instrumentation.ts` refuses to boot
  with `STORAGE_BACKEND=postgres` + missing `DATABASE_URL`.
- **`relation "tool_catalog_entries" does not exist".** You forgot
  `pnpm db:migrate`. Run it, then restart the dev server.
- **Migration appears applied but the table is missing.** Likely a
  duplicate `idx` in `_journal.json` from a rebase — see
  [PLAN-0001 §10.1](adr/PLAN-0001.md#101-migration-filename-rule).
- **Too many connections.** Lower `DATABASE_POOL_MAX` (default 10) or
  bump Postgres' `max_connections`. The pool is shared per process via
  `getSharedPostgresClient()`, so a single `pnpm dev` should never need
  more than the configured max.
