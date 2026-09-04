# @mediforce/platform-infra

The implementations behind `platform-core`'s interfaces: Postgres repositories,
the NextAuth session store, email delivery, blob storage, and the model-registry
sync jobs.

`platform-core` says what a `ProcessRepository` must do; this package is the one
that talks to a database about it. Nothing here is imported for its types —
consumers depend on the interface and receive an instance.

## What lives here

| Directory | Holds |
|---|---|
| `src/postgres/repositories/` | One repository per domain entity, implementing the `platform-core` interface |
| `src/postgres/schema/` | Drizzle table definitions |
| `src/postgres/migrations/` | Numbered `NNNN_*.sql` — forward-only, applied in order |
| `src/auth/` | NextAuth session store, credentials, invites, user directory, sign-in audit |
| `src/email/` | Mailgun and SMTP clients, sender resolution |
| `src/notifications/` | Email and webhook notification services |
| `src/crypto/` | `secrets-cipher.ts` — workflow/namespace secret encryption |
| `src/storage/` | Filesystem blob store for run artefacts |
| `src/sync/` | OpenRouter model-registry sync and scheduling |

Postgres is reached through `drizzle-orm` over the `postgres` driver.

## Rules

**Constructor injection, no singletons.** A repository takes its database client
as an argument. This is what lets a handler test run against a throwaway
database and what keeps request scoping honest — a module-level connection
would quietly outlive the request that made it.

**Migrations are forward-only and immutable once merged.** Add
`NNNN_description.sql`; never edit a migration that has run anywhere. Deployed
environments replay the directory in order, so an edited file means two
databases that disagree about what schema `0037` produced.

**This package does not know about workflows.** It depends on `platform-core`
and nothing else internal — not `workflow-engine`, not `agent-runtime`. Business
logic that needs a repository belongs in a `platform-api` handler; putting it
here inverts the layering and makes it unreachable from the CLI.

## Model registry sync

`syncFromOpenRouter` reads two OpenRouter feeds: the public model catalogue
(`/api/v1/models`) for pricing and capabilities, and the rankings feed
(`/api/frontend/v1/rankings/performance`) for the request counts the catalogue
does not carry. A rankings failure is logged and skipped — the catalogue sync
still lands.

Nobody triggers it by hand. `syncRegistryIfStale` runs it whenever the registry
has gone 24h without a sync, from two places: `getPlatformServices()` once per
app process (so every deploy), and the cron heartbeat's registry sweep
(`platform-api`'s `heartbeat` handler), which is what keeps a deployment that
has not been redeployed in weeks current — on a host whose crontab posts to
`/api/cron/heartbeat` ([`scripts/setup-cron.py`](../../scripts/setup-cron.py)).
`POST /api/model-registry/sync` (`pnpm exec mediforce model sync`) forces one.

`ENABLE_MODEL_SYNC=false` turns the unattended path off — for an estate with no
outbound route to openrouter.ai, and for the E2E servers, whose registry has to
stay the seeded fixture rather than ~400 live models re-sorted by a live
popularity ranking. The forced sync above is unaffected: the flag gates the
automatic path, not an operator who explicitly asked.

## Testing

`src/**/__tests__/` covers repository CRUD, versioning constraints, auth flows,
and the secrets cipher against a real Postgres — these are the tests that prove
the storage backend, so they need `DATABASE_URL` pointed at a local database.
See [`docs/start/postgres-local-dev.md`](../../docs/start/postgres-local-dev.md).
