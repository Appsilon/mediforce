# 0005 — Headless platform: API/UI separation

- **Status:** Accepted (mutable while implementation in progress per the
  status policy in [`docs/adr/README.md`](./README.md); flips to
  `Finalized` when the headless migration completes and
  `headless-migration.md` is deleted)
- **Date:** 2026-05-25 (sections may be amended; date reflects initial
  acceptance)
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Relates to:**
  - Builds on [ADR-0004](./0004-scoped-data-access-authorization.md)
    (`CallerScope` + wrapper layer). Partially supersedes ADR-0004 §5
    when the future audit-wiring phase lands — until then ADR-0004 §5
    stands as written.
  - Implementation plan: [`docs/headless-migration.md`](../headless-migration.md)
    (living phased plan; deleted on migration completion).
  - Code architecture reference: [`docs/api-architecture.md`](../api-architecture.md).

## Context

[ADR-0004](./0004-scoped-data-access-authorization.md) put workspace
authorization into a `CallerScope` data-access bag and migrated the
ten Phase 1 GET endpoints to the handler shape
`(input, scope) => Promise<output>`. Phase 2 of the headless migration
([`docs/headless-migration.md`](../headless-migration.md)) is the next
step — migrating eight lifecycle mutation routes (tasks claim/unclaim/
complete/resolve, process cancel/resume, cron heartbeat) plus deleting
the parallel Server Actions that hand-roll the same operations through
a different code path.

ADR-0004 specified handler signatures and the wrapper layer; it did not
specify what mutations look like in particular:

- How does a handler signal a 409 to the client?
- What does the response body look like for a state-transition mutation?
- Do Server Actions stay alongside the migrated API surface, or get
  deleted?
- How does the adapter map typed handler errors to HTTP responses?
- What happens to the audit emission the Server Actions hand-roll today,
  given the migration deletes them?

This ADR settles those questions for Phase 2 and locks the patterns
every subsequent headless-migration phase inherits.

Domain terms (Workflow Run, Human Task, Cowork Session, Audit Event,
…) are defined in [`CONTEXT.md`](../../CONTEXT.md). Implementation
terms (handler, adapter, scope, contract) are defined in
[`api-architecture.md`](../api-architecture.md).

## Decision

### 1. Error envelope: `{ error: { code, message, details? } }`

Every error response from `createRouteAdapter` returns this shape:

```json
{
  "error": {
    "code": "precondition_failed",
    "message": "Task must be claimed before complete; current: pending",
    "details": { "taskId": "abc123", "currentStatus": "pending" }
  }
}
```

- `code` is a closed string union (see §3).
- `message` is human-readable, may be shown to end users.
- `details` is optional, free-form, useful for Zod issues
  (`details: ZodIssue[]`) or for entity context (`{ taskId, currentStatus }`).

Chosen over RFC 7807 Problem Details because:

- We don't cross org boundaries yet; URI-as-type identifiers add ceremony
  without payoff at our current external-API surface.
- Stripe / Google Cloud / GitHub / Linear all use a `{ error: {...} }`
  shape. Industry default for typed REST.
- Existing UI reads `error` as a string; migration is a trivial codemod
  (`error` → `error.message`).
- Forward-compatible: if external partners eventually demand RFC 7807,
  `code` derives a `type` URI mechanically.

Field name `error` (not `status`) because HTTP status code (header)
already says "this is an error class"; `status` collides with domain
concepts (`task.status`, `run.status`).

### 2. Typed errors: `HandlerError` hierarchy with `code` field

Extend the existing `HandlerError` base (introduced in [#450](https://github.com/Appsilon/mediforce/pull/450))
with a `code: ApiErrorCode` field and `details?: unknown`. One subclass
per code — single hierarchy, single adapter catch arm, subclasses for
server-side throw-site ergonomics (type-narrowed constructor + IDE
autocomplete at zero wire cost).

```ts
export type ApiErrorCode =
  | 'unauthorized' | 'forbidden' | 'not_found'
  | 'validation'   | 'precondition_failed' | 'conflict'
  | 'rate_limited' | 'internal';

export class HandlerError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) { super(message); }

  // Derived from `code` via the §3 table — no second source of truth.
  get statusCode(): number { return httpStatusForApiErrorCode(this.code); }

  // Plain object for JSON serialization — framework-free so the adapter
  // can `NextResponse.json(err.toEnvelope(), { status: err.statusCode })`
  // in one line (see §4).
  toEnvelope(): ApiErrorEnvelope { /* { error: { code, message, details? } } */ }
}

export class PreconditionFailedError extends HandlerError {
  constructor(message = 'Precondition failed', details?: unknown) {
    super('precondition_failed', message, details);
  }
}
// NotFoundError and ForbiddenError already existed and now extend
// the new base. Other codes (unauthorized, validation, conflict,
// rate_limited) throw via the base `HandlerError` directly until the
// first real throw site lands; that PR adds the subclass.
```

Throw site:

```ts
if (task.status !== 'claimed') {
  throw new PreconditionFailedError(
    `Task must be claimed before complete; current: ${task.status}`,
    { taskId, currentStatus: task.status },
  );
}
```

Client side (`@mediforce/platform-api/client`) exposes a single
`ApiError` (transport-aware: HTTP `status` + raw `body` + parsed
`code` / `details` from the §1 envelope). No subclass mirror on the
client today — every `catch` site in the UI currently does
`err instanceof Error ? err.message : 'fallback'`, so per-code
discrimination would be wasted code → ctor mapping. See "future
discrimination" note below.

Rejected: a parallel `ApiError` class alongside `HandlerError` (single
flat class, no subclasses). Two throwables for the same envelope =
inevitable drift; the subclass hierarchy already exists from
[#450](https://github.com/Appsilon/mediforce/pull/450) and just needs
the `code` field.

Rejected: Result types (`Result<T, HandlerError>`). Throws + a single
well-known base class is idiomatic in TS; result types add boilerplate
at every call site.

**Future-idea — UI per-code narrowing.** When the first real
per-code branch appears in UI code (`if (err.code === 'precondition_failed')`
pattern in a hook or component), reconstruct the matching server-side
`HandlerError` subclass on the client from the envelope `code` via a
small map and expose it as a field on `ApiError`. UI could then do
`if (clientErr.handlerError instanceof PreconditionFailedError)` with
full TS narrowing. Out of scope until the first concrete use-case
exists — premature symmetry costs map-table maintenance for no payoff
today.

#### 2a. Throw site

State-machine invariants throw from the **wrapper repository layer** when
the rule belongs to the entity ("task must be claimed before complete").
Authorization-membership invariants throw from wrapper too. Cross-entity
checks (e.g. complete-with-gate-validation needs the parent run) throw
from the **handler** after a second explicit load via `scope`.

The adapter has one `try/catch` ladder; it never branches on entity type.

### 3. HTTP status mapping

Locked table (extensible by ADR amendment while status `Accepted`):

| code | HTTP | meaning |
|---|---|---|
| `unauthorized` | 401 | no caller / token invalid |
| `forbidden` | 403 | known caller, denied (mutations only; reads use 404 anti-enum per Phase 1) |
| `not_found` | 404 | resource missing OR caller can't see it (reads — anti-enum) |
| `validation` | 400 | Zod parse failure on input |
| `precondition_failed` | 409 | state-machine violation (task not claimed, run not pausable) |
| `conflict` | 409 | concurrent-write race (stale version, duplicate create) |
| `rate_limited` | 429 | per-caller rate cap |
| `internal` | 500 | unexpected; logged + reported |

Both `precondition_failed` and `conflict` map to 409 (HTTP-class
correct; client branches on `code`, not the status nuance between 409
and 412). `forbidden` on mutations is 403 — anti-enum payoff lower
because the caller already proved intent by issuing the write.

### 4. Adapter extension: single `HandlerError` catch in `createRouteAdapter`

No new `mutationAdapter` helper. Mutations use the same
`createRouteAdapter` as reads, with a single typed-error catch arm that
delegates serialization to the class itself (`HandlerError.toEnvelope()`
returns the §1 wire shape; `statusCode` getter derives from `code` via
the §3 table — same pattern as Hono's `HTTPException` and NestJS's
`HttpException`):

```ts
catch (err) {
  if (err instanceof HandlerError) return jsonErrorResponse(err);
  if (err instanceof z.ZodError) {
    return jsonErrorResponse(new HandlerError('validation', 'Invalid input', err.issues));
  }
  console.error('[route-adapter] handler error:', err);
  return jsonErrorResponse(new HandlerError('internal', 'Internal error'));
}

function jsonErrorResponse(err: HandlerError): NextResponse {
  return NextResponse.json(err.toEnvelope(), { status: err.statusCode });
}
```

Catch order is `HandlerError → ZodError → unknown`; `ZodError` is a
sibling arm rather than wrapped into a domain throw so a Zod throw
inside handler code (programmer error — backend payload failing
internal parse) is distinguishable in the source from a deliberate
`new HandlerError('validation', ...)` throw, even though both map to
the same envelope.

All existing Phase 1 GET endpoints inherit typed errors without
rewriting (`NotFoundError` / `ForbiddenError` from
[#450](https://github.com/Appsilon/mediforce/pull/450) are subclasses
of `HandlerError` and now carry `code`/`details`).

### 5. Response shape: entity echo

Every single-entity mutation returns the entity in its post-mutation
state. Reuse the GET output schema verbatim.

```ts
// POST /api/tasks/:taskId/claim → { task: HumanTask }
// POST /api/processes/:instanceId/cancel → { run: WorkflowRun }
```

Carve-outs by operation kind:

| Op kind | Response shape |
|---|---|
| Create | `201 Created` + entity echo (`{ run }`, `{ definition, version }`) |
| State transition | `200 OK` + entity echo (`{ task }`, `{ run }`) |
| Bulk | `{ results: Array<{ id, status: 'ok' \| 'error', error? }> }` |
| Async / queued | `202 Accepted` + `{ jobId, status: 'queued' }` |
| Streaming (Phase 3 cowork) | SSE response; not entity echo |
| Operational ping (cron heartbeat) | `{ ok: true, processedAt }` |
| True DELETE with nothing to say | `204 No Content` |

Industry standard (Stripe / GitHub / Linear / Shopify all do entity
echo for single-entity mutations). Eliminates "did it work + what's
the new state" round trips; client never synthesises post-mutation
state from inputs.

Today's inconsistency
(`{ ok, taskId, verdict, processInstanceId }` for complete;
`{ instanceId, status }` for cancel/resume) is hand-rolled drift, not
a deliberate pattern. Migration normalises in the same PR as each
endpoint moves; UI callers update inline (~3 components in Phase 2).

### 6. Server Action policy

Per-endpoint judgement. Default: when migrating a mutation, delete the
parallel Server Action; UI moves to `apiClient.X.Y()`. Keep a Server
Action only when an actually-used Server Action feature justifies it —
`<form action={...}>` progressive enhancement, `revalidatePath()`
post-mutation freshness, or `redirect()`.

Today's actions in `packages/platform-ui/src/app/actions/` use **none**
of these features (they take `idToken` as an explicit arg, validate
via `verifyIdToken` — API-route-shaped code wearing a Server Action
costume). Empirical default for Phase 2: delete all migrated actions.

When kept (future), Server Action is a thin wrapper over the handler:

```ts
'use server';
import { claimTaskHandler } from '@mediforce/platform-api';

export async function claimTaskAction(taskId: string) {
  const result = await claimTaskHandler({ taskId }, await getServerScope());
  revalidatePath(`/tasks/${taskId}`);
  return result;
}
```

Action body may only call handlers — never raw repos, never Firestore
SDK, never inline business logic. PR-reviewed; no boundary test until
drift proves it's needed.

`getServerScope()` constructor shape is deferred until a real
form-action use case appears (Phase 2 deletes all actions; nothing
left to build it for).

### 7. Audit emission: handler-resident bridge, repo-resident later

Today's Server Actions hand-roll audit emission inline
(`auditRepo.append({...})` per action). API routes don't emit at all.
Phase 2 deletes the actions; without a bridge, audit coverage on these
mutations would silently regress.

**Phase 2 bridge:** each migrated mutation handler emits audit inline
via `scope.system.audit.append({...})` — same shape as today's Server
Action code, ~6 LOC per handler. Net-zero LOC if the existing emission
code is moved (not added) from action to handler. The raw write surface
lives on `scope.system.audit` (existing trusted-bypass lane that already
holds `engine` / `agentRunner` / `manualTrigger`), not on the Authorized
wrapper. Reason: `Authorized*Repository` semantics promise per-method
workspace gating; `append` would not gate (writer trusted by-construction —
the handler just loaded the parent through a gated wrapper). Putting it
on `scope.system` makes the trust explicit and groups it with the other
god-mode-by-design handles.

**Long-term direction (separate audit-wiring phase, post-headless-
migration):** audit emission moves to the **persistence boundary
(repository)** via a `MutationContext` threaded into every raw
mutation method. Industry-standard transactional outbox pattern
(Hohpe EIP, Fowler PoEAA audit-log-via-repository-decorator).
Reasons:

1. Repo is the only layer that sees every write path (HTTP handlers,
   `WorkflowEngine`, `AgentRunner`, `container-worker`, future MCP).
   Handler-resident silently misses non-HTTP writers — known gap.
2. Atomicity belongs to the persistence layer. Postgres
   ([ADR-0001](./0001-firestore-to-postgres.md)) makes entity-write +
   audit-row-write transactional for free. Firestore era is best-effort
   dual-write with documented gap.
3. Audit-row-write is part of "how persistence happens", not "what the
   user requested." Mixing it into handlers leaks infrastructure into
   orchestration.

This is captured in
[`headless-migration.md` §"Captured for later"](../headless-migration.md);
when that phase ships, this ADR partially supersedes ADR-0004 §5
(narrowing "wrappers never depend on other wrappers" to exclude
audit infrastructure).

**Phase 2 audit handler code** is throwaway bridge. Recognisable
pattern, easy to find-and-delete during the audit-wiring phase.

Closed action-name set (extensible by amendment):

**Phase 2 (shipped):**
- `task.claimed`, `task.unclaimed`, `task.completed`, `task.resolved`
- `instance.cancelled`, `instance.resumed`
- `cron.heartbeat` (operational; `@no-audit` exemption — no entity
  mutation)

**Phase 3 additions (amended 2026-05-26 after Phase 3 grilling):**
- `instance.retried` — emitted by the migrated `processes/:id/steps/:stepId/retry`
  handler. No prior engine emit covers this (retry is a handler-level
  state reset + kick, not an engine state transition).
- `cron.trigger.fired` — emitted per fired trigger inside the migrated
  `cron/heartbeat` handler. Snapshot: `{ triggerName, definitionName,
  definitionVersion, instanceId }`. `cron.heartbeat` itself stays
  `@no-audit` (heartbeat call is operational; only the sub-events emit).

**Phase 3 inherits (no new handler-bridge emit needed):**
- `tasks/complete` migration → `task.completed` (already in set; same
  shape as today's Server Action — move-not-add per ADR-0005 §7).
- `processes/resume` migration → `instance.resumed` (already in set).
- `processes` POST create migration → `instance.created` +
  `instance.started` are emitted by `engine.createInstance` +
  `engine.startInstance` respectively (`packages/workflow-engine/src/engine/workflow-engine.ts:125,371`).
  Handler bridge does not double-emit; existing engine emits cover the
  create path completely.

**Naming note (amended 2026-05-26 after PR2 design pass).** The original
draft used `run.*` here, forward-looking to ADR-0001's `runs` table
rename. Phase 2 PR2 reverted to `instance.*` because every existing
workflow-engine emit is `instance.*` (`instance.created/started/paused/
resumed/aborted/completed`) and the legacy `bulkCancelProcessRuns`
Server Action emits `instance.cancelled`. New audit lanes ship under
the dominant prefix so audit consumers see one consistent family rather
than a `run.*` / `instance.*` split during the migration window. A
repo-wide `instance.*` → `run.*` (entity + action) rename ships as its
own ADR pass, ideally bundled with the audit-wiring phase (repo-resident
emission via `MutationContext`) since both touch every write path.

### 8. Wrapper layer additions for Phase 2

`AuthorizedHumanTaskRepository` already has `claim` / `complete` /
`cancel`. Phase 2 adds:

- `HumanTaskRepository.unclaim(taskId, userId)` + wrapper passthrough
  (no method today; current `unclaimTask` Server Action writes Firestore
  directly).

Raw audit-write surface lives on `scope.system.audit` (existing
trusted-bypass lane), not on the Authorized wrapper. Reason:
`Authorized*Repository` semantics promise per-method gating; `append`
would not gate (writer trusted by-construction). Putting it on
`scope.system` makes the trust explicit and aligns with where `engine` /
`agentRunner` already live. `AuthorizedAuditEventRepository` stays
read-only.

`AuthorizedWorkflowRunRepository` has `getById` / `list` / `update` only.
Phase 2 adds:

- `ProcessInstanceRepository.cancel(id, reason)` + wrapper passthrough.
- `ProcessInstanceRepository.resume(id)` + wrapper passthrough.

These are domain methods on the wrapper, mirroring how
`AuthorizedHumanTaskRepository.claim()` was already shaped.

## Considered alternatives

- **RFC 7807 Problem Details** for error envelope. Rejected for now —
  no external API surface yet; standard pays back when partners
  consume. Forward-compatible: `code` → `type` URI conversion is
  mechanical when needed.
- **Subclass hierarchy** for typed errors. Rejected — subclasses don't
  cross the JSON wire; force a code → constructor mapping table on the
  client side; no real ergonomic gain over a single class.
- **Result types** instead of throws. Rejected — adds boilerplate at
  every call site; idiomatic TS uses throws + well-known base classes.
- **Adapter-orchestrated audit** (mutation adapter takes an `audit:`
  config). Rejected — only covers the HTTP path; misses engine +
  worker writers; the audit-wiring phase will move audit to the repo
  layer anyway, where it covers everyone.
- **Handler-resident audit as permanent home.** Rejected as long-term
  — same gap as adapter-orchestrated. Acceptable as Phase 2 bridge
  only because the existing Server Action emission is being moved
  rather than newly introduced.
- **`.append()` on `AuthorizedAuditEventRepository`** as the write
  surface during the bridge. Rejected — `Authorized*Repository` names
  a contract ("every method gates on caller's workspace membership"),
  and `append` does not gate. Putting it there forces a misleading
  doc-comment on every read of the file. Raw write goes on
  `scope.system.audit` instead, next to the other trusted-bypass
  handles (`engine`, `agentRunner`, `manualTrigger`).
- **Keep Server Actions alongside the API.** Rejected — empirical:
  today's actions use zero Server Action features. They are API-route-
  shaped code in a Server Action costume, paying the auth-bifurcation
  cost (cookie session vs Bearer) and losing Zod contract + URL
  surface, for no benefit.
- **`mutationAdapter` helper** distinct from `createRouteAdapter`.
  Rejected — one adapter with a single `HandlerError` catch covers
  reads and mutations; second helper adds vocabulary without behaviour
  change.
- **Minimal-ack response shape** (`{ ok: true }`). Rejected — forces a
  refetch round trip and creates race windows where the client renders
  stale state. Industry standard is entity echo.
- **Single mutation `/complete` route per body variant** vs
  **multiple sub-routes**. Chose discriminated-union body schema on a
  single `/complete` route — same underlying operation (`resolveTask`),
  different payload kind discriminated by `kind`.

## Consequences

- Phase 2 mutation handlers share one signature
  (`(input, scope) => Promise<output>`) and one error idiom (throw a
  `HandlerError` subclass — `NotFoundError`, `PreconditionFailedError`,
  etc.). Phase 2.5 and Phase 3 mutations inherit unchanged.
- `createRouteAdapter` becomes the single chokepoint for input parsing,
  scope construction, error mapping, and output serialization across
  reads and mutations.
- The API now has a documented, typed contract for failure modes that
  external consumers (CLI today; MCP / partners later) can rely on
  without string-matching.
- Server Action deletion in Phase 2 removes 8 of 6 hand-rolled
  mutations from `app/actions/`; remaining files cover Phase 2.5 /
  Phase 3 scope and stay until their endpoints migrate. By end of
  Phase 3 the `app/actions/` directory is empty or gone.
- Audit emission has a temporary handler-resident location for Phase 2;
  the audit-wiring phase relocates it to the repository boundary
  uniformly across HTTP, engine, and worker writers.
- The headless story strengthens: every mutation has one URL, one
  contract, one typed client method, one error shape. CLI, MCP, future
  partner integrations consume the same surface as the UI.

## Out of scope

- **Audit-wiring phase.** Repo-resident emission via `MutationContext`
  is scoped to its own phase post-headless-migration. This ADR captures
  the direction; the implementation ADR is separate.
- **`getServerScope()` shape.** Deferred until a real Server Action
  use case appears. Phase 2 deletes all actions.
- **Phase 3 streaming contract.** Cowork chat/message/finalize needs
  an SSE adapter and a streaming handler shape — design pass deferred
  to Phase 3, may produce ADR-0006.
- **Phase 7 deploy split** (separate API server). Adapter abstraction
  is forward-compatible (`createHonoAdapter` etc.) but the decision to
  split is its own ADR.
- **NextAuth migration** (ADR-0002). `CallerIdentity` shape stays;
  the auth carrier change (Bearer ID token → cookie session) is
  orthogonal.
- **Idempotency keys.** Phase 2 mutations are naturally idempotent
  (state transitions return 409 on repeat). Phase 2.5 create endpoints
  (`POST /processes`, `POST /workflow-definitions`) revisit; not
  decided here.

## Open questions

(None blocking Phase 2. Section reserved for amendments while the ADR
is still `Accepted`.)
