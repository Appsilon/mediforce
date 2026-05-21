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
   see [ADR-0003](./0003-scoped-data-access-authorization.md) for the
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

## Considered alternatives

- **Stay on Firestore.** Rejected: blocks pharma on-prem GTM; the migration
  surface only grows as new collections accrue.
- **Supabase self-hosted stack** (Postgres + PostgREST + GoTrue + Realtime +
  Storage). Rejected: 8–10-container stack widens the customer's operational
  surface; "just Postgres" is easier to defend in a vendor review. We can
  adopt individual Supabase services later if needed; the schema is portable.
- **DB-agnostic ORM (Prisma, TypeORM).** Rejected: the existing repository
  pattern already provides the abstraction that matters (in-memory ↔ real
  database swap). Forcing the lowest-common-denominator across DBs sacrifices
  the Postgres-specific features (`jsonb` paths, RLS, partial indexes,
  `LISTEN/NOTIFY`, `pgvector`) where the real wins live.
- **Postgres + Prisma.** Considered; rejected for heavier runtime, awkward
  `jsonb` support, higher exit cost. Drizzle stays close to SQL.
- **Per-workspace dual-write cutover.** Rejected as overengineering for our
  scale and life-cycle stage. Big-bang is lower-kit-cost and matches a
  platform still being shaped, not one with a 24/7 SLA.

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
