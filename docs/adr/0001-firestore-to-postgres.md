# 0001 — Move primary datastore from Firestore to self-hosted Postgres

- **Status:** Proposed
- **Date:** 2026-05-19
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Implementation plan:** [PLAN-0001.md](./PLAN-0001.md)

## Context

Mediforce uses Firestore for all persistent state. Firestore is a managed Google
service and cannot be deployed on customer premises — a hard requirement for
every pharma customer Mediforce targets. The Firebase Emulator dependency also
hurts local-dev and demo-deploy onboarding.

The repository pattern is already in place across
`packages/platform-core/src/interfaces/` (contracts),
`packages/platform-infra/src/firestore/` (Firestore implementations) and
`packages/platform-core/src/testing/` (in-memory test doubles). The migration is
bounded to those surfaces plus the small number of UI hooks that bypass
repositories to read Firestore directly via `onSnapshot`.

Domain terms used below — Namespace (today's canonical scope), Workspace
(proposed canonical user-facing alias), Workflow Definition, Process Instance,
Step Execution, Agent Run, Cowork Session — are defined in
[`CONTEXT.md`](../../CONTEXT.md).

## Decision

Move the primary datastore to **self-hosted Postgres 16**, accessed via
**Drizzle ORM**, with the following architectural commitments:

1. **Datastore.** Self-hosted Postgres 16, deployable as a single container via
   `docker-compose`. The customer's IT operates it; we ship a backup recipe.
2. **Access layer.** Drizzle ORM (typed query builder, TypeScript schemas,
   `drizzle-kit` migrations). Repository interfaces in
   `packages/platform-core/src/interfaces/` stay unchanged; the in-memory test
   doubles remain the L2 path.
3. **Fail-proof repository scoping.** Every concrete repository inherits from an
   `AuthorizedRepository` base that enforces, on every default read and write
   path: (a) workspace scoping (`WHERE workspace IN $callerWorkspaces`, or
   unrestricted for `caller.kind === 'apiKey'`) and (b) soft-delete filtering
   (`WHERE deleted_at IS NULL AND archived_at IS NULL`). Crossing those
   filters requires an explicit, audit-logged opt-out method (e.g.
   `discoverPublicWorkflows()`, `includeDeleted()`, `includeArchived()`).
   A URL-driven single-workspace variant (`scopedTo(handle)`) is available
   for routes that pin to one `/{handle}/…` segment. The wrapper layer that
   consumes this base class — `CallerScope` plus per-entity
   `Authorized<Entity>Repository` types — lands ahead of the Postgres swap;
   see [ADR-0004](./0004-scoped-data-access-authorization.md) for the
   wrapper layer's design and timing.
4. **Soft-delete via timestamps.** Replace existing `deleted: boolean` and
   `archived: boolean` flags with `deleted_at timestamptz` and
   `archived_at timestamptz` columns. NULL = active. Soft-delete is **forever**
   for now; a later ADR may introduce a retention purge.
5. **Realtime swap.** All `onSnapshot` listeners are removed. Lists move to
   **SWR polling** (2–10 s interval). Live agent run logs and cowork text chat
   move to **Server-Sent Events**. No WebSockets are introduced.
6. **Cross-workspace public discovery.** `WorkflowDefinition.visibility =
   'public'` remains a live, cross-Workspace feature — teams may publish,
   platform examples ship as public. Access goes through an explicit repo
   method (`discoverPublicWorkflows()`); the default scoped `list()` never
   crosses workspaces.
7. **Domain term cleanup, storage level only.** Rename the storage field
   `namespace` → `workspace`. Rename the colliding
   `WorkflowDefinition.workspace` field (git working-tree config) to
   `gitWorkspace`. Repository/class renames (`ProcessRepository` →
   `WorkflowDefinitionRepository`, `ProcessInstance` → `WorkflowRun`) are
   **out of scope here** and land in follow-up PRs. New code uses Workflow
   / Run. "Run" is the canonical user-facing term — already in the UI, URLs
   (`/workflows/{name}/runs/{runId}`), schema comments, and neighbour
   `AgentRun` — so "Workflow Run" wins over "Workflow Instance".
8. **Cutover.** **Big-bang with planned downtime** during a low-traffic window:
   a one-shot Python script exports Firestore, transforms it, and bulk-inserts
   into Postgres; we verify counts + sample diffs, flip the application's
   datastore env, and restart. Rollback path: restore Firestore from backup,
   retry next window. Mediforce is in platform-creation phase, not 24/7
   maintenance — downtime is acceptable.

### Implementation patterns

The first repository migration (`tool_catalog_entries`,
[PR #515](https://github.com/Appsilon/mediforce/pull/515)) settled five
patterns that every subsequent Postgres repository inherits. They are
load-bearing for safety and operability, not stylistic — calling them out
here so future repos don't relitigate them.

**1. Shared per-process Postgres client.**
[`getSharedPostgresClient()`](../../packages/platform-infra/src/postgres/client.ts)
returns a process-wide singleton (`postgres-js` pool + `drizzle` wrapper).
Every PG-backed repository constructor takes the same `Database` handle.
Rationale: per-repo pools would multiply — 14 planned repos × default
`max=10` connections = 140, blowing past Postgres' default
`max_connections=100`. One pool, sized once via `DATABASE_POOL_MAX`.

**2. Validate on both read and write in every repository.**
[`PostgresToolCatalogRepository`](../../packages/platform-infra/src/postgres/repositories/tool-catalog-repository.ts)
calls `ToolCatalogEntrySchema.parse(…)` on the row coming back from `select`
and on the entry going into `upsert`. Rationale: `jsonb` cannot enforce
TypeScript shape — `args: string[]` and `env: Record<string,string>` are
opaque to Postgres, so a sibling repo, a raw-SQL fix, or a schema-drifting
migration could silently land a malformed row. This matches the Firestore
backend's behaviour. Cost is trivial for low-volume tables; high-volume
read paths (audit, agent runs) will revisit at parse-on-write +
parse-on-bulk-read granularity, but the default is "always parse".

**3. `set_updated_at()` UPDATE trigger instead of application-side bumps.**
The first migration ships a generic [trigger function](../../packages/platform-infra/src/postgres/migrations/0000_tool_catalog_entries.sql)
that every soft-mutable table installs once. Rationale: raw-SQL writers
(ops scripts, future data migrations, manual hot-fixes) get a correct
`updated_at` for free. Application code never sets `updated_at` on
`UPDATE` — the trigger owns it.

**4. Boot-time env validation in
[`instrumentation.ts`](../../packages/platform-ui/src/instrumentation.ts),
not module-top of `platform-services.ts`.**
Next.js loads route modules lazily on first request; a module-top throw
fires per-request, not at boot, which means missing env wouldn't surface
until a user hits the affected route. `instrumentation.register()` is
Next.js' real boot hook and runs once per server start. Migrations apply
*outside* the Next.js process — see Implementation pattern 6.

**6. Migrations run as a separate process before app start, not from
inside Next.js.**
Production: [`packages/platform-ui/Dockerfile`](../../packages/platform-ui/Dockerfile)
wraps the container `CMD` with
[`scripts/migrate-postgres.mjs`](../../packages/platform-ui/scripts/migrate-postgres.mjs):
the script applies pending Drizzle migrations, then exec's `server.js`.
A first attempt routed migrations through Next.js `instrumentation.ts`,
but Turbopack's instrumentation pipeline does not honour
`transpilePackages` for workspace imports, which forced `@ts-expect-error`
escapes and duplicating `postgres` / `drizzle-orm` as `platform-ui`
direct deps. The standalone-script approach drops the workarounds, keeps
the Next.js boot path clean, and lets the same script run as an
init-container if a future deployment goes multi-replica. Local dev runs
the script manually via `pnpm db:migrate` (drizzle-kit CLI directly) —
ADR-0001 keeps schema concerns explicit on the developer side, not
hidden in `next dev`.

**5. Per-repo ternary routing inside `getPlatformServices()`, no separate
backend factory.**
[`platform-services.ts`](../../packages/platform-api/src/services/platform-services.ts)
selects the backend with a one-line ternary at the repo's declaration
site:

```ts
const toolCatalogRepo: ToolCatalogRepository =
  process.env.STORAGE_BACKEND === 'postgres'
    ? new PostgresToolCatalogRepository(getSharedPostgresClient().db)
    : new FirestoreToolCatalogRepository(db);
```

Rationale: `getPlatformServices()` *is* the factory. A separate
`createBackend(flag)` abstraction would just rename it and add a layer of
indirection. The inline ternary is local, explicit, greppable, and
removable in one sweep after the cutover (§8.4).

## Considered alternatives

### Datastore engine

- **Stay on Firestore.** Rejected: blocks pharma on-prem GTM; the migration
  surface only grows as new collections accrue.
- **MySQL / MariaDB.** Considered — many pharma IT shops already operate
  one. Rejected because: weaker JSON / `jsonb` story (no native `jsonb`
  path operators and partial indexes are more limited); no native
  publish-subscribe equivalent of `LISTEN / NOTIFY`; weaker row-level
  security primitives that the future RLS ADR will rely on; the vector,
  full-text, and extension ecosystem (`pgvector`, FTS) trails Postgres.
  Postgres is the more capable target at no extra operational cost.
- **SQLite (+ Litestream for backups).** Considered — irresistibly simple.
  Rejected because: a single-writer concurrency model bottlenecks the
  workflow engine + UI + worker writing concurrently; no usable network
  protocol, so the worker and the Next.js process must share a filesystem;
  no RLS path; mediocre support for `bytea`-sized rows we'll store for
  skills and attachments (see ADR-0003). Fine as a future "tiny demo"
  side-target if we ever ship a personal-use SKU, not a fit for the main
  product.
- **MongoDB or another document store.** Rejected — it preserves the
  document-DB ergonomics that drove us off Firestore (poor joins, awkward
  multi-collection consistency, weaker SQL tooling, identical vendor-risk
  conversation in pharma reviews).
- **CockroachDB / YugabyteDB / TiDB (distributed Postgres-compatible).**
  Rejected as overkill for single-tenant pharma deployments. They solve
  multi-region HA we don't need; in exchange they add deployment
  complexity (multiple nodes, gossip, raft), operational cost, and
  occasional Postgres incompatibility (transactional ergonomics, certain
  extensions). Postgres scales vertically far past where any pharma
  customer's mediforce instance will land.
- **Supabase self-hosted stack** (Postgres + PostgREST + GoTrue + Realtime +
  Storage). Rejected: 8–10-container stack widens the customer's operational
  surface; "just Postgres" is easier to defend in a vendor review. We can
  adopt individual Supabase services later if needed; the schema is
  portable. If a customer specifically asks for Supabase, the same schema
  lights up on top of theirs.

### Access layer / ORM

- **DB-agnostic ORM (Prisma, TypeORM).** Rejected: the existing repository
  pattern already provides the abstraction that matters (in-memory ↔ real
  database swap). Forcing the lowest-common-denominator across DBs
  sacrifices the Postgres-specific features (`jsonb` paths, RLS, partial
  indexes, `LISTEN/NOTIFY`, `pgvector`) where the real wins live.
- **Postgres + Prisma.** Considered; rejected for heavier runtime, awkward
  `jsonb` support, higher exit cost. Drizzle stays close to SQL.
- **Postgres + raw `postgres.js` + Zod** (no ORM at all). Considered;
  Drizzle wins for ~20 repositories because typed query builders catch
  column-typo and join-shape bugs at compile time and keep migrations in
  one tool. We can drop Drizzle later and the hand-written SQL underneath
  stays valid — exit cost is low.

### Migration approach

- **Per-workspace dual-write cutover.** Rejected as overengineering for
  our scale and life-cycle stage. Big-bang is lower-kit-cost and matches
  a platform still being shaped, not one with a 24/7 SLA.

## Consequences

- Pharma on-prem deployment unblocked. Single new dependency every IT
  department already supports.
- Demo and local dev simplify to a single `docker-compose` container; Firebase
  Emulators retire.
- Strongly consistent reads/writes replace Firestore's eventual consistency,
  removing a class of race-condition workarounds (notably the personal-
  namespace bootstrap dance in `auth-context.tsx`).
- One-time migration effort, estimated 2 focused engineering weeks.
- ~14 UI hook sites + 3 page-component sites are rewired from `onSnapshot` to
  SWR / SSE. Mostly mechanical.
- New operational responsibility for self-hosted customers: Postgres backup.
  Standard tooling; documented as part of this migration.
- Cross-workspace public-workflow discovery is the **single permitted scope
  exception** and is funnelled through one explicit repo method, audit-logged.

## Enterprise / pharma fit

- "Your data lives in your Postgres" is a one-line answer in every IT
  vendor review.
- Future Postgres Row-Level Security (Phase 2, separate ADR) gives
  database-level Workspace isolation — the strongest possible answer to
  "tenants cannot see each other's data".
- 21 CFR Part 11-relevant features (audit triggers, point-in-time recovery,
  write-ahead log) are off-the-shelf in Postgres.
- A single `docker-compose up` for evaluators and demo-deploy operators
  replaces the current multi-piece Firebase-Emulator setup.

## Out of scope

- **Firebase Auth → NextAuth** — separate ADR (`0002`), deferred for now.
- **Firebase Storage → object storage** — separate ADR when a customer asks.
- **Vercel AI SDK for cowork streaming** — separate ADR, post-migration.
- **Postgres Row-Level Security** for namespace isolation — Phase 2, separate
  ADR; this ADR enforces scoping in the application layer via the
  fail-proof repository base class.

## Open questions for review

- **Drizzle (this ADR) vs raw `postgres.js` + Zod.** Drizzle wins for ~20
  repositories; confirm in PR review.
- **Rename `namespace` → `workspace` at the storage layer in this ADR** vs a
  separate prior PR. Confirm in PR review.
- **`type: 'organization' | 'personal'`** on Workspace — we keep
  `'organization'` (departments inside a tenant), no rename. Confirm in PR
  review.
- **`public` cross-workspace discovery** — keep as a live feature, no
  per-deployment disable flag. Confirm in PR review.
