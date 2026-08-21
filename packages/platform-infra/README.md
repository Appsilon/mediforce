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

## Testing

`src/**/__tests__/` covers repository CRUD, versioning constraints, auth flows,
and the secrets cipher against a real Postgres — these are the tests that prove
the storage backend, so they need `DATABASE_URL` pointed at a local database.
See [`docs/start/postgres-local-dev.md`](../../docs/start/postgres-local-dev.md).
