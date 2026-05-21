# 0003 — Authorization enforcement moves to a scoped data-access layer

- **Status:** Proposed
- **Date:** 2026-05-21
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Relates to:** Supersedes (architecturally) the handler-resident decision from
  PR #450; brings forward [ADR-0001](./0001-firestore-to-postgres.md)
  invariant 3 (`WorkspaceScopedRepository` base class) into the Firestore era
  with a minor reshape; out-of-scope role enforcement deferred to a later ADR
  alongside [ADR-0002](./0002-firebase-auth-to-nextauth.md).

## Context

PR #450 (merged) migrated 10 GET endpoints to `@mediforce/platform-api` and
established a handler-resident authorization pattern: every handler receives
`caller: CallerIdentity` as a third positional argument and calls
`callerCanAccess(caller, namespace)` inline. A static
`auth-coverage.test.ts` guard greps handler source for one of five marker
patterns or a `@public-handler` annotation, failing CI otherwise. The goal
was that an authorization regression would be "a code-level decision visible
in review, not a silent regression."

Phase 2 (12+ mutation endpoints — task claim/complete/resolve, run
create/cancel/resume, definition upsert/archive, cron heartbeat) is the next
migration in line. Implementing those handlers in the PR #450 shape means
~6 of them repeat the same four-line dance (load entity → load parent for
namespace → check → return-or-throw), and every new handler is one more
chance to write a syntactically passing but semantically broken gate (e.g.
a regex-passing `if (caller.kind === 'user') { return everything; }`).

In parallel, [ADR-0001](./0001-firestore-to-postgres.md) commits — as
invariant 3 — to a `WorkspaceScopedRepository` base class that auto-filters
every default read by workspace and soft-delete. That ADR scopes the base
class to the Postgres backend; the wrapper is intended to land with the
Drizzle implementation. If Phase 2 ships handler-resident, the codebase
acquires a pattern that gets unwound a few months later when ADR-0001's
implementation arrives. Two pattern shifts in 3–4 months is more churn than
one early pivot.

Domain terms used below — Caller, Workspace (namespace), Workflow Run
(`ProcessInstance`), Workflow Definition, Human Task, Cowork Session,
Agent Run, Audit Event, Handoff — are defined in
[`CONTEXT.md`](../../CONTEXT.md).

## Decision

Introduce a thin **authorization wrapper layer** in
`packages/platform-api/src/repositories/`. Every API handler — including the
10 GET handlers already migrated by PR #450 — accepts a single
`scope: CallerScope` argument; the underlying raw repositories are no longer
visible to handlers.

1. **`CallerScope` bag.** A per-request value carrying `caller: CallerIdentity`
   plus one `Authorized<Entity>Repository` per workspace-scoped repo. Built
   once by `createCallerScope(rawPlatformServices, caller)` in the route
   adapter; the resulting `CallerScope` is the only data-access surface the
   handler sees.
2. **`Authorized<Entity>Repository` wrappers.** Each wraps the matching raw
   repository from `@mediforce/platform-core`'s interfaces and enforces, on
   every read and write:
   (a) workspace membership (caller's reachable workspaces intersect the
   entity's workspace),
   (b) soft-delete / archived filtering,
   (c) `WorkflowDefinition` visibility filtering (`public` vs `private`).
   Indirect-namespace entities (`HumanTask`, `CoworkSession`, `AgentRun`,
   `AuditEvent`, `Handoff` — workspace via parent `WorkflowRun`) load the
   parent for the membership check. The wrapper for `getById` returns `null`
   on out-of-scope; list/query methods filter out unreachable entries.
3. **Handler signature.** `(input: ParsedInput, scope: CallerScope) => Promise<Output>`.
   No raw repos, no `caller` third arg (it lives in `scope.caller` when the
   handler needs it for audit/personalization).
4. **What the wrapper does NOT enforce.** Role checks (e.g. "caller has
   `task.assignedRole`"), ownership checks, workflow-step `allowedRoles`
   gating. None of these are enforced at the HTTP API layer today — they
   live in Firestore security rules and in the engine's `RbacService`
   (which is unwired in production, marked `// Phase 4`). This ADR
   preserves the status quo: the wrapper carries only what is enforced
   today, in one place. Adding role enforcement is a separate change
   (likely with [ADR-0002](./0002-firebase-auth-to-nextauth.md), when
   `CallerIdentity` gains per-workspace roles, or as the Phase 4 ADR).
5. **Cross-entity logic stays in the handler.** When a mutation needs to
   read a second entity (e.g. `complete(taskId, data)` validates `data`
   against the parent run's step gate config), the handler does the second
   load explicitly via `scope`. Wrappers never depend on other wrappers,
   and no wrapper holds another wrapper's raw repo in its constructor —
   no cyclical graph, no heavyweight DI.
6. **Engine and worker paths bypass the wrapper.** `WorkflowEngine`,
   `AgentRunner`, `WebhookRouter`, and the `container-worker` operate as
   the system actor and continue to take raw repositories. Authorization
   for system code is god-mode-by-design, audited via `AuditEvent`.
7. **Caller-set scope, not singular workspace.** The base class
   `AuthorizedRepository` filters `workspace IN caller.workspaces` (or
   unrestricted for `caller.kind === 'apiKey'`). This is a small reshape of
   [ADR-0001](./0001-firestore-to-postgres.md) sec. 2.1, whose sketch took a
   singular `workspace: string`. The reshape matches both today's
   multi-workspace `GET /api/tasks?role=…` use case and the future
   Postgres RLS policy form
   (`workspace IN (SELECT workspace FROM workspace_members WHERE user_id = current_user_id())`).
   An opt-in `scopedTo(handle)` mode covers URL-driven single-workspace
   flows (`/{handle}/…`).
8. **No `predicates.ts` file on spec.** Tiny gates that recur (e.g. cron
   heartbeat's `caller.kind === 'apiKey'` check) inline in handlers. A
   shared predicate module only lands when role enforcement does (it will
   need >1 caller).
9. **Static guard.** Replace `auth-coverage.test.ts` with
   `no-raw-repo-imports.test.ts` — fails CI if any file under
   `packages/platform-api/src/handlers/` imports from
   `@mediforce/platform-core/interfaces` or `@mediforce/platform-infra`.
   The TypeScript handler signature already forbids it; the test is
   belt-and-suspenders against bypass.
10. **One follow-up PR delivers it all.** That PR rewrites the 10 GET
    handlers from PR #450 (mechanical, ~5 LOC each), adds the wrapper
    layer (~300 LOC), and lands Phase 2 mutations on top. Total
    ~600 LOC, one coherent pattern in the codebase at every commit
    boundary.

## Considered alternatives

- **Stay handler-resident; let ADR-0001 implementation do the conversion
  later.** Rejected: codifies a pattern in Phase 2 (12+ mutation handlers)
  that gets unwound 1–3 months later. Twice the review surface. Larger
  ADR-0001 implementation PR. The "load + scope-check + delegate" dance
  repeats and each instance is a chance to drop the check silently.
- **Combined wrapper with role/state checks inside `Authorized<Entity>Repository`.**
  Rejected: role enforcement isn't a thing at the API layer today
  (Firestore security rules are the only check) and inventing it as a
  side-effect of a refactor expands scope. Combining role logic into the
  repo also requires cross-entity reads from inside the wrapper (e.g.
  `claim()` would have to load `WorkflowRun` to check
  `allowedRoles[0]`), which forces wrappers to depend on other repos and
  creates a fragile dependency graph. Easier to handle cross-entity logic
  explicitly in the handler.
- **Repository wrapper with reads only; writes go through a separate
  command-bus or service layer.** Rejected: doubles the type surface, splits
  the mental model, and provides no benefit while role enforcement is
  absent. The wrapper already enforces scope on writes (`workspace IN
  caller.workspaces`) — the only kind of "write authz" we have today.
- **Pure Pundit / DDD: separate `*Policy` classes alongside read-scoped repos.**
  Rejected for the same reason — there's no authz body to put in a policy
  class today. The pattern can be added later, when role enforcement
  arrives, by extracting from handlers.
- **Implement the wrapper as a generic `Proxy`.** Rejected: TypeScript
  Proxy types degrade (return types are lost), IDE goto-definition stops
  resolving, and each entity has a different "where is the workspace"
  rule (some on the entity, some via parent). The base-class + thin
  per-method override approach gives full type safety and reads
  straightforwardly.
- **A new `@mediforce/platform-authz` package.** Rejected: ~300 LOC plus
  one-package overhead (`package.json`, exports, tsconfig). Nothing
  outside `platform-api` and `platform-ui` consumes the wrappers today —
  engine, container-worker, and CLI operate as system callers or via the
  HTTP client. Extract later if a real cross-package consumer appears.

## Consequences

- One handler signature for the whole HTTP API surface
  (`(input, scope) => Promise<Output>`). Phase 2 onwards builds on it.
- The static guard becomes a single, structural assertion ("no raw repo
  imports from handlers") instead of a regex menu of acceptable markers.
- A handler that needs to express a public/system endpoint does so by
  bypassing the wrapper deliberately (e.g. cron heartbeat checks
  `scope.caller.kind === 'apiKey'` inline) — visible at the call site, no
  magic annotation.
- Indirect-namespace lookups (HumanTask → Run → workspace) become an
  intrinsic property of the wrapper. The pattern already exists inline in
  PR #450's `filterTasksByNamespace`; the wrapper enshrines it and
  deduplicates parent fetches across a single list call. Single-entity
  `getById` pays one extra round-trip for the parent — same as today.
  Postgres + ADR-0001 collapses this to a single JOIN.
- ADR-0001 implementation simplifies: the Postgres backend swap touches
  `packages/platform-infra/src/postgres/`; the wrapper layer in
  `packages/platform-api/src/repositories/` is unchanged. The
  `AuthorizedRepository<TRow>` base class lives in `platform-infra` (per
  ADR-0001 sec. 2.1, reshaped to take a `CallerIdentity` instead of a
  singular workspace); the wrappers in `platform-api` consume it via the
  raw repo interface from `platform-core`.
- `CallerIdentity` is unchanged by this ADR. ADR-0002's NextAuth landing
  expands it (per-workspace roles, membership level) and the wrapper layer
  inherits the new shape with no change.
- Pharma audit story strengthens: "API authorization is enforced in the
  data-access layer; handlers cannot bypass it because the TypeScript
  signature does not expose raw repositories." That's a one-line answer
  to a compliance reviewer's "how do you prevent cross-tenant data leaks
  at the API layer?".

## Out of scope

- **Role enforcement at the HTTP API layer.** Schema already has
  `HumanTask.assignedRole`, `WorkflowStep.allowedRoles`, etc., but
  enforcement lives in Firestore security rules and an unwired
  `RbacService`. Adding handler-level role checks is deferred to a later
  ADR that lands alongside or after ADR-0002 (so `CallerIdentity` carries
  roles per workspace).
- **`ProcessInstance` → `WorkflowRun` rename and friends.** Per ADR-0001,
  these are follow-up PRs. New wrapper types use canonical names from
  day one (`AuthorizedWorkflowRunRepository`), so we do not propagate
  `Process` in newly written code. Storage-level rename happens with
  ADR-0001's Postgres migration.
- **Engine / `executeAgentStep` / container worker authorization.** System
  actors continue to use raw repositories under god mode. Their
  accountability comes via `AuditEvent`, not wrapper enforcement.
- **`apiKey` god-mode rename to `'admin'` / `'system'` (#448).** Independent
  cleanup; the wrapper layer is shape-stable across the rename.

## Open questions for review

- **Wrapper layer placement: `platform-api/src/repositories/` vs a new
  `platform-authz` package.** Defaulting to `platform-api/`. Confirm in PR
  review.
- **`AuthorizedRepository<TRow>` base class location.** ADR-0001 sec. 2.1
  places it in `packages/platform-infra/src/postgres/repositories/`. The
  Firestore-era equivalent for this ADR's introduction belongs in
  `packages/platform-infra/src/firestore/` (next to the raw repos) so the
  Postgres swap is purely additive. Confirm.
- **Reshape ADR-0001 sec. 2.1 to caller-set scope.** Proposed patch:
  `WorkspaceScopedRepository(db, table, workspace: string)` →
  `AuthorizedRepository(db, table, caller: CallerIdentity)` with default
  `scoped() ⇒ WHERE workspace IN caller.workspaces (or unrestricted for
  apiKey)` and an opt-in `scopedTo(handle)` for URL-driven flows. Confirm
  before ADR-0001 implementation begins.
- **Combined PR vs split.** Proposed: a single PR that rewrites PR #450's
  10 GET handlers, adds the wrapper layer, and lands Phase 2 mutations
  (~600 LOC, mechanical). Confirm in PR review that the size is
  reviewable.
