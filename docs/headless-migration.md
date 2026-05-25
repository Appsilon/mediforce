# Headless migration plan

## Why

Mediforce is evolving into a headless platform: every data path goes through the HTTP API contract, business logic is framework-free, and the Next.js UI is one of several clients (the others being agents, CLI, MCP servers, and future partner integrations).

Getting there is a multi-PR journey, not a big-bang rewrite. This doc tracks the phases; each one is a small, reviewable step that leaves the codebase in a working state.

**Companion artefacts:**
- Issue [#231](https://github.com/Appsilon/mediforce/issues/231) — problem statement, audit findings, rolling follow-up list
- [`docs/ENGINE-TESTING.md`](./ENGINE-TESTING.md) — the Contract test layer that anchors this migration
- [`AGENTS.md`](../AGENTS.md) — package dependency graph

## Core principles

1. **Contract first.** Every endpoint gets a Zod input + output schema in `packages/platform-api/src/contract/` before it gets a handler. The contract is the API — the handler conforms by TypeScript.
2. **Pure handlers.** `(input, deps) => output`. No `NextRequest`, no `cookies()`, no Firestore SDK. Tests pass real in-memory repos from `@mediforce/platform-core/testing` — no mocks.
3. **Thin adapters.** Next.js routes become ~15 lines via `createRouteAdapter`. Auth lives in `middleware.ts` (Filip's PR #220); route files do not re-check it.
4. **Boundary enforced.** `packages/platform-ui/src/test/api-boundaries.test.ts` fails CI if UI code imports handlers or if a handler lacks a sibling test.

## Phases

### Phase 0 — Pilot (done)

- New package `packages/platform-api` with `contract/`, `handlers/`, `services/`
- `GET /api/tasks` migrated end-to-end with 21 tests (13 contract, 8 handler)
- `createRouteAdapter` helper lands in platform-ui
- `platform-services` factory moved from `platform-ui/src/lib/` into `platform-api/src/services/` — two-tier package: `contract` + `handlers` stay pure (framework-free, consumable by CLI / mobile / partners), `services` holds the Firebase-admin wiring; subpath exports keep `/contract` consumers from evaluating `services/` code.
- Boundary enforcement as a Vitest structural test in Filip's style (`api-boundaries.test.ts`)

Landed in [#232](https://github.com/Appsilon/mediforce/pull/232).

### Phase 1 — Migrate all GET endpoints

Uniform pattern. Low risk. Establishes the catalogue of read contracts that Phase 2 mutations will respond with.

**Endpoint checklist:**

| Endpoint | Domain | Status | PR |
|---|---|---|---|
| `GET /api/tasks` | tasks | ✅ done | #232 (pilot) |
| `GET /api/tasks/:taskId` | tasks | ✅ done | #450 |
| `GET /api/processes/:instanceId` | processes | ✅ done | #450 |
| `GET /api/processes/:instanceId/audit` (paginated) | processes | ✅ done | #450 |
| `GET /api/processes/:instanceId/steps` | processes | ✅ done | #450 |
| `GET /api/workflow-definitions` (list) | definitions | ✅ done | #450 |
| `GET /api/workflow-definitions/:name` (by name+version) | definitions | ✅ done | #450 |
| `GET /api/agents` | definitions | ✅ done | #450 |
| `GET /api/agents/:id` | definitions | ✅ done | #450 |
| `GET /api/cowork/:sessionId` | cowork | ✅ done | #450 |
| `GET /api/cowork/by-instance/:instanceId` | cowork | ✅ done | #450 |
| `GET /api/configs` | configs | scoped out — deleted on main in #292 | — |
| `GET /api/plugins` | misc | ✅ done | #450 |
| `GET /api/agent-logs` | misc | todo? | — |
| `GET /api/agent-output-file` | misc | todo? | — |
| `GET /api/health` | — | stays as-is | — |
| `GET /api/oauth/callback` | — | stays (Filip's domain) | — |

**Lessons learned (Phase 1, captured during #450):**

- **Auth threading.** Every handler accepts `caller: CallerIdentity` as a third
  positional argument — not bundled into `deps`. Handlers either consume it
  (calling `assertNamespaceAccess` / `callerCanAccess` / `filterByCaller`, or
  branching on `caller.kind` / `caller.namespaces`) or declare themselves
  `// @public-handler` with a one-line reason. A static grep guard
  (`packages/platform-api/src/handlers/__tests__/auth-coverage.test.ts`) fails
  CI on any handler that drops the caller silently — TypeScript can't catch
  an unused parameter, so we enforce the rule out-of-band. The guard uses
  regex + comment stripping to avoid false positives from bare imports or
  comment-only mentions. Outstanding follow-ups: #448 (terminology rename
  `apiKey` → `admin`, per-user API keys land via #376 mapping to `'user'`
  kind) and #452 (models mutations marked `@public-handler` need an admin
  gate once #448 lands).
- **404 anti-enumeration on every namespace-gated read.** A resource the
  caller cannot read surfaces as **404, not 403** across all 10 Phase 1
  GET endpoints — tasks, processes, audit, steps, agents list +
  detail, workflow-definitions list + detail, cowork (both shapes). The
  route returns the same not-found body as a genuinely-missing id, so a
  non-member caller cannot tell "this id exists but I can't see it" from
  "this id doesn't exist". 403 is reserved for *mutations* the caller
  proved they were trying to perform on a known resource (Phase 2).
- **Breaking shape change.** `GET /api/processes/:id/audit` migrated from a
  bare array to `{ events: AuditEvent[] }`. Wrapping every list-shaped
  response in a named envelope keeps the door open for pagination metadata
  (`{ events, nextCursor }`) without another breaking change. Other Phase 1
  endpoints already used envelopes (`{ tasks }`, `{ definitions }`, etc.) —
  audit was the outlier.

(Audit any missed routes when picking up this phase — `find packages/platform-ui/src/app/api -name 'route.ts'` is the source of truth.)

**Contract extensions surfaced by real UI consumers** — the pilot's `GET /api/tasks` needs these before it can cover every Firestore-bypass it's competing with.

The underlying lesson is that the pilot contract was designed to match what `HumanTaskRepository` can deliver **today**, not what the domain actually supports. Tasks have four statuses (`pending | claimed | completed | cancelled`) — all are real. But `HumanTaskRepository.getByRole(role)` has a built-in filter to `pending | claimed` only (a historical UX decision baked into the data layer). That restriction leaked into the contract as a refine. Fix the root cause in the repo, then widen the contract — not the other way round.

Concrete Phase 1 tickets (tracked in #231):

- **Drop the actionable-only filter from `HumanTaskRepository.getByRole`** — ~~planned~~ **done in #232**. Both the Firestore and in-memory implementations now return every task for a role regardless of status; callers narrow via the `status` field in the contract. The only pre-pilot production caller of `getByRole` was our new handler, so the change had zero user-visible effect on main and unblocked migration of `useCompletedTasks` in future Phase 6 work.
- **Unfiltered list** (`useAllTasks`) — add a `GET /api/tasks` variant with mandatory pagination (`limit` + opaque `cursor`) and probably admin scope. Don't add "filter is optional" — the unbounded read is the footgun.
- **Aggregate stats** (`useMonitoringData`) — different shape (counts, not list). Add `GET /api/tasks/stats` as a separate endpoint rather than contorting the list contract.
- **Multi-field filter** (`instanceId + stepId` in `NextStepCard`) — extend `ListTasksInputSchema` with optional `stepId`. Trivial.

The rule of thumb: **design the contract against real UI consumers, and change the repo interface when the contract needs things the repo doesn't expose**. The repo is infrastructure, the contract is the API — domain flows from the API out.

**Per endpoint:**

1. Write `packages/platform-api/src/contract/<domain>.ts` — input + output Zod schemas.
2. Write `packages/platform-api/src/handlers/<domain>/<name>.ts` — pure handler.
3. Write `__tests__/<name>.test.ts` — in-memory repo, no mocks. Contract tests (`__tests__/contract.test.ts`) per domain are encouraged but not enforced.
4. Replace the existing Next.js route with a `createRouteAdapter` call.
5. Update existing route tests — most already call `GET(req)` directly, typically a one-line adjustment.
6. (Later) Add a method to `packages/platform-ui/src/lib/api-client.ts` once a UI caller needs it.

**PR sizing**: one domain per PR (tasks, processes, definitions…). That's 3-5 endpoints per PR — small enough to review, big enough to justify the overhead.

**Pause-safe**: yes. Stopping mid-phase leaves unmigrated routes working exactly as before (the pilot endpoint and any already-migrated routes are independent).

**Open questions to settle before starting**:
- Pagination cursor design — extend `HumanTaskRepository` + other repo interfaces with `{ limit, cursor }` options? Opaque cursor or field-based (`createdAt` / `id`)? (Tracked in #231.)
- `GET /api/workflow-definitions` — the existing route returns either a list or a single doc depending on query params. Do we split into two contract endpoints (`list` + `get`) or keep one with a union-shaped output?

### Phase 1.5 — Hybrid endpoint cleanup

**✅ Status: done in [#482](https://github.com/Appsilon/mediforce/pull/482)** (merged 2026-05-25). Shipped scope below for historical record; planning notes preserved for the institutional memory of why we did this before Phase 2.

Five endpoints already declared contracts in `platform-api` but still ran
inline route code that bypassed the `createRouteAdapter` pipeline AND the
ADR-0004 scoped data-access layer. Drained the backlog in #482 before Phase 2
mutations set the next pattern in stone.

**Scope — one PR, three domains:**

| Endpoint | Domain | Wrapper / annotation |
|---|---|---|
| `GET /api/runs` | runs | `scope.runs.list({def, status, limit})` |
| `GET /api/runs/:runId` | runs | `scope.runs.getById` + `scope.workflowDefinitions.getByNameVersion` (custom handler — finalOutput walk + definitionNamespace enrichment) |
| `GET /api/workflow-secrets` | secrets | `scope.workflowSecrets` or `scope.workspaceSecrets` (workflow query param picks) |
| `PUT /api/workflow-secrets` | secrets | same; write methods throw `ForbiddenError` for non-members |
| `DELETE /api/workflow-secrets` | secrets | same |
| `GET /api/system/docker-info` | system | `@public-handler` — deployment-global. Dispatcher delegates to `_docker.ts` (local execFile vs container-worker fetch). |
| `GET /api/system/openrouter-credits` | system | `scope.workspaceSecrets.getSecrets(workspace)` to pluck `OPENROUTER_API_KEY`, then external fetch to openrouter.ai. |

**Bundled secrets PUT/DELETE rationale.** Splitting the secrets file across
phases would leave `route.ts` half-`createRouteAdapter`, half-inline. The
mutations are idempotent single-call wrappers with no state machine —
closer in mechanics to GETs than to Phase 2's `tasks.claim` /
`processes.cancel` (real lifecycle invariants). Phase 2 stays "state-
machine mutations only".

**Behavioural changes worth flagging in the PR description:**

- `GET /api/runs/:runId` switches from **403 → 404** for foreign-workspace
  ids, matching the Phase 1 anti-enumeration lesson. The `scope.runs.getById`
  wrapper returns `null` for out-of-scope; `getByIdAdapter` (well, the custom
  handler here) maps to `NotFoundError`. Grep CLI/UI for 403-specific
  branching before merge — none expected, but cheap to confirm.
- `GET /api/workflow-secrets` for a foreign workspace now returns an empty
  `{ keys: [] }` (soft-fail per wrapper contract) instead of 403.

**`docker-info` auth — `@public-handler`, deliberate.** Every authenticated
user fetches it: workflow editor, start-run button, processes problems
panel, plus admin infrastructure page. UI features depend on the image
list. Single-tenant deployments today; namespaces split teams inside one
tenant, not separate organisations. The `caller.isSystemActor` flag
would block all `user` callers (UI), so gating on it is wrong. A tracking
issue captures the "revisit when multi-tenant" follow-up.

**Tests** (handler layer against `createTestScope`):

- `list-runs`, `get-run`, `list-secret-keys`, `set-secret`, `delete-secret`,
  `openrouter-credits` — apiKey / user-in-ns / user-out-of-ns paths.
- `docker-info` — logic split into `handlers/system/_docker.ts` units
  (`fetchFromLocalDocker`, `fetchFromContainerWorker` with mocked `execFile`
  / `fetch`); handler itself is a 5-line dispatcher, not separately tested.
- Existing `contract/__tests__/{runs,secrets,system}.test.ts` already
  cover wire-shape invariants — extend only on a real gap.
- L3 API E2E journeys (`packages/platform-ui/e2e/api/*.journey.ts`)
  re-run before merge — PR #463 left these unverified and Phase 1.5
  touches paths they cover.

**Out of scope — moved to a later "Phase 1.8" effort:** `agent-logs`,
`agent-output-file`, `step-logs`, `tickets`. No contract started yet,
so they're new work rather than finishing-the-loop. File-serving shape
deserves its own design pass.

**Pause-safe**: yes — per-file route swaps revert cleanly if any one is
contentious in review.

### Phase 1.7 — Authorization architecture decision (prerequisite for Phase 2)

Phase 1 ended with namespace authorization threaded **explicitly** through every handler — six GET handlers repeat the same load-then-`callerCanAccess` dance. Phase 2 adds 12+ mutations with the same shape. Before any mutation handler ships, settle whether authorization stays in handlers or moves into the data-access layer.

**Working hypothesis (under design review):** push namespace + visibility authorization down into a scoped data-access bag. Handlers receive a `Services` object whose per-domain entries (`services.tasks`, `services.processes`, …) wrap the underlying repositories with caller-aware reads, writes, and actions. The bag also passes through public/system repos (`tools`, `cron`, `namespaces`, `apiKeys`, `models`) without scoping. Handler signature becomes `(input, services: Services) ⇒ Promise<Output>` — `caller` only stays on handlers that need it for audit, role, or personalization, not authz.

**Why this is a phase, not a side-quest.** The decision is foundational:
- Reverberates through every Phase 2/3 handler shape.
- Survives the NextAuth migration (ADR-002 in PR review) because `CallerIdentity` stays as the abstraction.
- Preempts the per-user-API-key landing pattern (#376) — scoped layer doesn't care how the caller was authenticated.
- Affects #448 (`apiKey` terminology / scope of admin bypass).

**Open questions to settle in design review:**
- Domain naming. `services.tasks` (Rails-style) vs `services.scopedHumanTasks` (explicit) vs `services.taskOps` (suffix-typed). What aligns with existing language in `packages/platform-core/src/interfaces/`?
- Type name for the bag itself. `Services`, `Scope`, `HandlerServices`, `AppServices` — keep `PlatformServices` as the raw factory's return type?
- Enforcement layers. Is TypeScript signature enough, or do we need a structural test (analogue of `auth-coverage.test.ts`) that fails CI when a handler imports raw repos? ESLint?
- Direct vs indirect repos. Five repos have a `namespace` field directly (`ProcessInstance`, `WorkflowDefinition`, `AgentDefinition`, `Secrets`, `WorkflowSecrets`); four (`HumanTask`, `CoworkSession`, `AgentRun`, `Audit`, `Handoff`) resolve namespace through the parent instance. Cost: ~70 LOC per direct wrapper, ~100 LOC per indirect (N+1 lookup on list paths).
- Cost vs alternative. A single `loadWithNamespaceGate(caller, loader, error)` helper adds ~30 LOC and saves ~4 LOC per handler. Why is full scoped-services worth +~1200 LOC infra over that?
- Does Phase 3 break the pattern? Cowork SSE handlers become orchestrators with side effects — does scope still apply, or does the abstraction leak?
- Do mutations that **create** resources (`POST /api/processes`) fit "load + gate + delegate" cleanly, or is creation special?

**Output of this phase:**
- Decisions crystallised in `docs/headless-migration.md` + (likely) `docs/decisions/ADR-003-authorization-architecture.md`.
- If we commit to scoped services: the scope layer implemented as the first PR of Phase 2, before any mutation handler ships.
- If we reject it: the duplication is accepted as Phase-2 cost, with the alternative (`loadWithNamespaceGate` helper or status quo) documented.

**Status:** in design review via the `/grill-with-docs` skill, stress-testing the working hypothesis against the existing domain model, ADRs, and Mediforce-specific concerns (pharma tenant isolation, NextAuth migration, per-user API keys). See the spawned design session.

### Phase 2 — Lifecycle mutations (narrow)

**Prerequisite:** Phase 1.7 closed — [ADR-0004](./adr/0004-scoped-data-access-authorization.md) merged in #463 (2026-05-25). Mutation handlers ship with the `(input, scope: CallerScope)` signature from day one; no raw repo access.

**Scope note (rewritten 2026-05-25):** the original Phase 2 list (PR #445 / branch `claude/cool-jennings-035e0c`) bundled tasks + process + definitions + configs + cron into one phase. Three things changed since:
1. Mutation surface is wider in practice (~30 routes, not 14). Agents+MCP+OAuth subroutes, admin oauth-providers/tool-catalog/docker-images, users invite, workflow-definitions archive/copy/version-archive landed after the plan was written.
2. ADR-0004 wrapper layer is new — mutation pattern is unproven. Validate on uniform state-machine cases before tackling cross-entity work (archive cascades, copy across versions).
3. `configs` was deleted on main in #292; the original bullet is dead.

So Phase 2 narrows to **uniform lifecycle mutations** — same handler shape (load → gate → state transition → write → audit), no cross-entity cascades, no special namespace semantics. The wider surface moves to **Phase 2.5**, planned against the lessons Phase 2 produces.

**In scope:**

| Endpoint | Domain | Shape |
|---|---|---|
| `POST /api/tasks/:taskId/claim` | tasks | scope.tasks.claim(taskId, caller) |
| `POST /api/tasks/:taskId/complete` | tasks | scope.tasks.complete(taskId, data) — validates against parent run's step gate |
| `POST /api/tasks/:taskId/resolve` | tasks | scope.tasks.resolve(taskId, verdict) |
| `POST /api/processes/:instanceId/cancel` | processes | scope.runs.cancel(id, reason) |
| `POST /api/processes/:instanceId/resume` | processes | scope.runs.resume(id) |
| `POST /api/cron/heartbeat` | cron | `caller.isSystemActor` bypass; no scope gate |

**Out of Phase 2 (moved to Phase 2.5 or Phase 3):**

- `POST /api/processes` (create new run) → Phase 2.5 — workspace-write gate, trigger payload validation, idempotency design needed.
- `POST /api/processes/:id/advance`, `POST /api/processes/:id/run`, `POST /api/processes/:id/steps/:stepId/retry` → **Phase 3** — orchestrates `WorkflowEngine` + `AgentRunner`, spawns Docker, fire-and-forget side effects. Needs its own design pass (sync vs queued execution).
- All cowork (`chat`/`message`/`finalize`) → **Phase 3** — SSE adapter unsolved.

**Already shipped (post-original-plan):** `POST /api/model-registry/sync`, `POST /api/model-registry/rankings`, `GET /api/model-registry`, `GET /api/model-registry/:id` — five model-registry endpoints landed under `packages/platform-api/src/handlers/models/` ahead of the formal Phase 2 plan because that domain was being touched anyway. Treat them as Phase 2 reference shape for future mutations.

**Additional concerns per mutation:**

- **Response shape: entity echo.** Every single-entity mutation returns
  the entity in its post-mutation state — `POST /api/tasks/:id/claim` →
  `{ task: HumanTask }`, `POST /api/processes/:id/cancel` →
  `{ run: WorkflowRun }`. Reuse the GET output schema verbatim. This is
  the REST textbook answer (Stripe, GitHub, Linear, Shopify all do it).
  Eliminates "did it work + what's the new state" round trips, kills
  drift between client-synthesised state and server truth.

  Carve-outs (use when they apply, not by default):
  | Op kind | Response shape |
  |---|---|
  | Create | `201 Created` + entity echo (`{ run }`, `{ definition, version }`) |
  | State transition | `200 OK` + entity echo (`{ task }`, `{ run }`) |
  | Bulk | `{ results: Array<{ id, status: 'ok' \| 'error', error? }> }` |
  | Async / queued | `202 Accepted` + `{ jobId, status: 'queued' }` |
  | Streaming (Phase 3 cowork) | SSE response, not entity echo |
  | Operational ping (cron heartbeat) | `{ ok: true, processedAt }` |
  | True DELETE with nothing to say | `204 No Content` |

  Today's inconsistency (`{ ok, taskId, verdict, processInstanceId }` for
  complete; `{ instanceId, status }` for cancel/resume) is hand-rolled
  drift, not a deliberate pattern. Migration normalises in the same PR
  as each endpoint moves; UI callers update inline (~3 components in
  Phase 2).

- State-machine invariants surface as typed errors (`ApiError` with `code: 'precondition_failed'` → 409). See the **error contract** open question below.
- **Audit emission — bridge.** Today's Server Actions hand-roll audit
  (`auditRepo.append({...})` inline in each action). API routes don't
  emit. Deleting the actions during Phase 2 would erase the only existing
  audit coverage for these mutations. To avoid a compliance regression
  during the gap between Phase 2 and the future audit-wiring phase
  (see "Captured for later" below), each new Phase 2 mutation handler
  emits audit inline via `scope.auditEvents.append({...})` — same shape
  as today's Server Action code, ~6 LOC per handler. This is throwaway
  bridge code: the audit-wiring phase rewrites to repo-resident
  `MutationContext` and removes the handler-level emits. Add a `.append()`
  method to `AuthorizedAuditEventRepository` (read-only today) to enable
  this.

**Server Action policy.** Per-endpoint judgement. Default: when migrating
a mutation, delete the parallel Server Action; UI moves to
`apiClient.X.Y()`. Keep a Server Action only when an actually-used Server
Action feature justifies it — `<form action={...}>` progressive
enhancement, `revalidatePath()` post-mutation freshness, or
`redirect()`. Today's actions in `src/app/actions/` use **none** of
these features (they take `idToken` as an explicit arg and call
`verifyIdToken`, i.e. API-route-shaped code wearing a Server Action
costume); the empirical default is therefore "delete". When a future
mutation genuinely needs a Server Action feature, the policy doesn't
forbid adding a thin wrapper:

```ts
'use server';
export async function claimTaskAction(taskId: string) {
  const result = await claimTaskHandler({ taskId }, await getServerScope());
  revalidatePath(`/tasks/${taskId}`);
  return result;
}
```

Action file may only call handlers — never raw repos, never Firestore
SDK, never inline business logic. Enforced by PR review; no boundary
test until drift proves it's needed.

**Phase 2 Server Action deletions** (concrete list, all in
`packages/platform-ui/src/app/actions/`):

| File | Functions to delete in Phase 2 |
|---|---|
| `tasks.ts` | `claimTask`, `unclaimTask`, `completeTask`, `completeParamsTask`, `completeUploadTask`, `completeAssignmentTask` (all 6) |
| `processes.ts` | `cancelProcessRun`, `resumeProcessRun` (Phase 2 lifecycle scope) |

Phase 2.5 / Phase 3 picks up the rest (`processes.ts`:
`startWorkflowRun` / `retryFailedStep` / `archiveProcessRun` /
`bulkCancelProcessRuns` / `bulkArchiveProcessRuns`; whole files for
`cowork.ts` / `definitions.ts` / `namespace-secrets.ts` /
`workflow-secrets.ts`). Surfaced gap: `unclaimTask` currently writes
Firestore directly (`db.collection('humanTasks').doc(taskId).update(...)`),
bypassing the repo — Phase 2 must add an `unclaim` method to
`HumanTaskRepository` + wrapper to give the migrated handler a
non-bypass path.

**PR sizing**: one lifecycle domain per PR. Five PRs total — tasks (3 endpoints), process-state (2), cron (1, trivial). 1-2 week phase.

**Pause-safe**: yes — same as Phase 1.

### Phase 2 — Implementation tracker

Locked design decisions live in
[ADR-0005](./adr/0005-headless-platform-api-ui-separation.md);
code-architecture concepts in [`api-architecture.md`](./api-architecture.md).
This tracker is the entry point for a fresh session picking up Phase 2.

**Two PRs, sequential.** Pattern is unproven (wrapper layer has only
served GETs); smallest endpoint first to validate it, then the rest.

#### PR1 — Cron heartbeat + adapter `ApiError` extension

**Scope.** One endpoint (`POST /api/cron/heartbeat`) plus the
`createRouteAdapter` extension that every subsequent mutation depends
on.

**Files to touch:**
- `packages/platform-api/src/contract/cron.ts` — new. `HeartbeatInputSchema`
  (empty / trivial), `HeartbeatOutputSchema` (`{ ok, processedAt }`).
- `packages/platform-api/src/handlers/cron/heartbeat.ts` — new. System-
  actor bypass: `if (!scope.caller.isSystemActor) throw new ApiError('forbidden', ...)`.
  No audit emission (`@no-audit` operational exemption per ADR-0005 §7).
- `packages/platform-api/src/handlers/cron/__tests__/heartbeat.test.ts`
  — new. Contract + handler tests against in-memory scope.
- `packages/platform-api/src/errors.ts` — add the `ApiError` class +
  `ApiErrorCode` union. Existing `HandlerError` / `NotFoundError` /
  `ForbiddenError` from [#482](https://github.com/Appsilon/mediforce/pull/482)
  **stay** as a coexistence bridge — new code throws `ApiError`,
  existing throws keep working, both produce the same envelope shape.
  Migration of legacy throws to `ApiError` is incremental, not PR1
  blocking.
- `packages/platform-ui/src/lib/route-adapter.ts` — extend the catch
  block with two arms per ADR-0005 §3/§4:
  - `instanceof ApiError` → envelope with `err.code`.
  - `instanceof HandlerError` → derive code from `statusCode`
    (`404 → 'not_found'`, `403 → 'forbidden'`); same envelope shape.
- `loadOr404` helper — extract per [#482](https://github.com/Appsilon/mediforce/pull/482)
  out-of-scope note ("third copy" rule reached for the
  `entity = await scope.X.getById(id); if (!entity) throw …` pattern).
  Lives in `packages/platform-api/src/handlers/_helpers.ts` (or
  similar); used by `get-run` plus any new lookup-with-404 handler in
  PR2.
- `packages/platform-ui/src/lib/__tests__/route-adapter.test.ts` —
  extend with tests for each code → status mapping.
- `packages/platform-ui/src/app/api/cron/heartbeat/route.ts` —
  replace inline handler with `createRouteAdapter` call.
- `packages/platform-api/src/client/mediforce.ts` — add
  `mediforce.cron.heartbeat()` method.

**Server Actions deleted:** none in this PR.

**New routes added:** none (heartbeat route already exists).

**Test layers:** contract + handler + adapter + 1 cross-layer integration.

**Exit criteria:**
- `POST /api/cron/heartbeat` returns `{ ok: true, processedAt }` on
  system-actor caller; `403` + ApiError envelope otherwise.
- All `ApiError` codes mapped to correct HTTP status in adapter tests.
- `api-boundaries.test.ts` + `no-raw-repo-imports.test.ts` pass.
- Existing GET endpoints retroactively return the new error envelope
  (no regression — they previously returned `{ error: string }`; now
  return `{ error: { code, message } }`; UI codemod `err.error` →
  `err.error.message` lands same PR).

#### PR2 — Tasks + Process state lifecycle mutations

**Scope.** Six endpoints + audit-bridge wiring + Server Action
deletions.

Endpoints:
- `POST /api/tasks/:taskId/claim` — migrate existing route.
- `POST /api/tasks/:taskId/unclaim` — **new route** (no existing
  route today; current functionality is Server Action only).
- `POST /api/tasks/:taskId/complete` — migrate. Body uses discriminated
  union over four kinds (`verdict | params | upload | assignment`)
  covering today's `completeTask`, `completeParamsTask`,
  `completeUploadTask`, `completeAssignmentTask` Server Actions.
- `POST /api/tasks/:taskId/resolve` — migrate.
- `POST /api/processes/:instanceId/cancel` — migrate.
- `POST /api/processes/:instanceId/resume` — migrate.

**Files to touch (per endpoint):**
- `packages/platform-api/src/contract/<tasks|processes>.ts` — add
  input + output schemas (output reuses entity schemas per ADR-0005 §5).
- `packages/platform-api/src/handlers/<tasks|processes>/<name>.ts` —
  new handler. Calls `scope.X.method()`, emits audit via
  `scope.auditEvents.append({...})` (bridge per ADR-0005 §7).
- `packages/platform-api/src/handlers/<tasks|processes>/__tests__/<name>.test.ts`
  — contract + handler tests.
- `packages/platform-ui/src/app/api/<path>/route.ts` — replace inline
  with `createRouteAdapter`.
- `packages/platform-api/src/client/mediforce.ts` — add typed methods.

**Server Actions deleted (move, don't add):**
- `packages/platform-ui/src/app/actions/tasks.ts` — delete all six
  (`claimTask`, `unclaimTask`, `completeTask`, `completeParamsTask`,
  `completeUploadTask`, `completeAssignmentTask`). Move audit-emission
  code into the corresponding handlers.
- `packages/platform-ui/src/app/actions/processes.ts` — delete
  `cancelProcessRun` and `resumeProcessRun`. Move audit code. Leave
  `startWorkflowRun`, `retryFailedStep`, `archiveProcessRun`,
  `bulkCancelProcessRuns`, `bulkArchiveProcessRuns` in place
  (Phase 2.5 / Phase 3 scope).

**UI callers to update:**
- `packages/platform-ui/src/components/tasks/claim-button.tsx` —
  replace `claimTask` / `unclaimTask` action imports with
  `mediforce.tasks.claim()` / `mediforce.tasks.unclaim()`.
- Components calling the other `complete*` actions — same pattern;
  body shape becomes discriminated union (`{ kind: 'verdict', ... }`,
  etc.).
- Process detail components calling `cancelProcessRun` /
  `resumeProcessRun` — same.

**Repository layer additions:**
- `HumanTaskRepository.unclaim(taskId, userId)` — new method on both
  the interface and `InMemoryHumanTaskRepository` and the Firestore
  impl. `AuthorizedHumanTaskRepository.unclaim()` wrapper passthrough
  (calls `assertCanMutate` first like the existing `claim`).
- `ProcessInstanceRepository.cancel(id, reason)` — new method on
  interface + in-memory + Firestore. `AuthorizedWorkflowRunRepository.cancel()`
  wrapper.
- `ProcessInstanceRepository.resume(id)` — same.
- `AuthorizedAuditEventRepository.append(event)` — new write method
  on the wrapper (read-only today). Delegates to raw `auditRepo.append()`.

**Test layers:** contract + handler + adapter + hook update + journey
test for at least one tasks flow (claim → complete) and one process
flow (cancel).

**Exit criteria:**
- All eight Server Actions deleted; `app/actions/tasks.ts` empty
  (delete file); `app/actions/processes.ts` retains only the five
  out-of-Phase-2 functions.
- UI callers updated to use `mediforce` client; `apiFetch` direct
  calls for these mutations removed.
- Audit emission preserved (move-not-add): the AuditEvent rows
  produced before and after Phase 2 are identical in actor/action/
  description/snapshots for the eight migrated mutations.
- `api-boundaries.test.ts` + `no-raw-repo-imports.test.ts` +
  Phase 2 audit-coverage structural guard pass.
- Discriminated-union `/complete` body validates all four variants
  end-to-end (contract test).
- E2E journey for claim→complete still green.

**Open questions to settle before starting** (carried forward + new):

- **Error contract schema** (from Phase 1 gap list — now blocking). Mutations introduce 409 (precondition_failed), 412 (state-machine), 422 (validation-with-context). Today's `{ error: string }` shape can't carry a discriminant for the client. Proposal: `{ error: { code: 'precondition_failed' | 'not_found' | ..., message: string, details?: unknown } }`. Decide before any mutation handler ships.
- **State-machine precondition encoding.** Two layers: contract refines (input shape — "verdict must be `approve`/`reject`") + repo-level typed errors (`TaskNotClaimedError`, `TaskAlreadyCompletedError`) that the adapter maps to 409 with the agreed error code. Stay out of Zod refines for cross-entity invariants.
- **Server Actions vs API routes.** Many tasks/process mutations have parallel Server Actions in `src/app/actions/*.ts` for form posts (`revalidatePath`). Decide per endpoint: delete the action (UI moves to `apiClient.tasks.claim()` + manual revalidation), or keep the action as a thin wrapper around the handler. Default: delete unless `revalidatePath` is load-bearing.
- **Idempotency keys.** Not needed for tasks/process-state mutations (each has a natural idempotency via target state — claiming an already-claimed task by you is a no-op, by someone else is 409). Revisit for `POST /api/processes` in Phase 2.5.
- **`apiKey` god-mode rename (#448).** Cron heartbeat uses `caller.isSystemActor`. If #448 lands first, terminology stays clean; if not, document the alias and rename in follow-up.

### Phase 2.5 — Definitions, agents, admin, users

Wider mutation surface that doesn't fit Phase 2's uniform shape. Each group has a quirk that justifies its own design pass once Phase 2 has validated the wrapper-layer mutation pattern.

**Definitions & versioning:**
- `POST /api/workflow-definitions` — creates new version of a workflow. Mints next `version` integer; concurrency on version assignment needs thought (DB sequence vs check-then-insert).
- `PUT /api/workflow-definitions/:name` — update default-version pointer / visibility.
- `POST /api/workflow-definitions/:name/archive` — archives the whole workflow (cascades to all versions — soft-delete pattern).
- `POST /api/workflow-definitions/:name/copy` — copies into another workspace (cross-namespace write, needs both source-read and target-write gates).
- `POST /api/workflow-definitions/:name/versions/:version/archive` — archives one version only.

**Process create (split from Phase 2):**
- `POST /api/processes` — instantiate run from definition. Trigger payload validation against definition's input schema. Idempotency design (client-supplied key vs server-derived dedupe window).

**Agents:**
- `POST /api/agents` — create new agent (workspace-scoped write).
- `PUT /api/agents/:id` — update agent.
- `PUT/DELETE /api/agents/:id/mcp-servers/:name` — MCP binding lifecycle.
- `POST /api/agents/:id/oauth/:provider/start` — initiate OAuth flow.
- `POST /api/agents/:id/oauth/:provider` + `oauth-discover` — callback-side persistence.

**Workflow secrets:** ✅ done in [#482](https://github.com/Appsilon/mediforce/pull/482). `set-secret` handler is an upsert (PUT semantics) covering create + update — no separate `POST` needed.

**Admin (deployment-admin-only):**
- `POST/PUT/DELETE /api/admin/oauth-providers[/:id]`
- `POST/PUT/DELETE /api/admin/tool-catalog[/:id]`
- `POST /api/admin/docker-images` — image management.

These bypass workspace scope (deployment-admin gate). The wrapper layer's `caller.isDeploymentAdmin` predicate needs to exist (or inline the check until a second admin endpoint exists).

**Users:**
- `POST /api/users/invite` — sends invite email.
- `POST /api/users/resend-invite` — re-sends.

Touches NextAuth migration boundary (ADR-0002 unwritten). May want to wait for that ADR to land before designing the contract.

**Out of Phase 2.5 (intentionally inline forever, not API surface):**

- `POST /api/oauth/:provider/callback` — external OAuth callback, redirect-based protocol, not part of our typed contract.
- `POST /api/triggers/webhook/[...path]` — external webhook ingestion, body shape is whoever-is-calling-us, validated per-trigger.
- `POST /api/tickets` — external GitHub Issues bridge with its own rate limit; no Mediforce-domain meaning.

**Open questions for Phase 2.5 design pass** (defer until Phase 2 ships):

- Cross-namespace write (`copy`): does the wrapper support "two scopes at once" or do we drop to raw repo with explicit double-gate?
- Cascade archive: soft-delete vs hard-delete + reference invalidation; per-version vs parent.
- Deployment-admin predicate: lives on `CallerIdentity` directly, or as a separate `AdminScope` analog of `CallerScope`?
- NextAuth boundary: do user-invite endpoints wait for ADR-0002?

**Pause-safe**: yes — Phase 2 leaves Phase 2.5 routes inline; they keep working.

### Phase 3 — Complex flows

Each of these needs its own design pass:

- **Cowork streaming** (`POST /api/cowork/:id/chat`, `POST /api/cowork/:id/message`, `POST /api/cowork/:id/finalize`) — requires an SSE adapter between the pure handler and Next.js `ReadableStream`. Design question: does the handler yield events, or return an async iterator?
- **Process execution** (`POST /api/processes/:id/run`, `POST /api/processes/:id/advance` with agent side-effects) — orchestrates `AgentRunner` + `WorkflowEngine`; handler becomes an orchestrator instead of a thin read. Decide on sync vs. queued execution.
- **Server actions** in `src/app/actions/*.ts` — fold into handlers where sensible, keep Next.js-specific concerns (`revalidatePath`, `redirect`) in a thin action wrapper.

**Pause-safe**: yes, but granularity is coarser — streaming and orchestration are each a PR of meaningful size.

**Open questions to settle before starting**:
- Streaming handler shape — pick one:
  - `AsyncGenerator<Event>` returned from handler; adapter wraps in `ReadableStream`.
  - Handler takes a `write(event)` callback; adapter provides one that writes to the response.
  - Handler returns an `EventEmitter`-style object; adapter subscribes.
  The first is the cleanest functional style; the second is the most flexible for pre-existing code.
- Orchestrator side-effects — `executeAgentStep` spawns Docker containers and writes audit events. Do we keep it as a handler (pure-ish, deps include `AgentRunner`) or promote it to a queue worker entrypoint?
- Cowork finalize writes to multiple repos atomically today — do we need a transaction abstraction in the repo interfaces, or accept non-atomic writes with compensating actions?

### Phase 4 — Typed `apiClient` + first hook migration

Close the loop: UI consumes the same contract it serves.

- Build `packages/platform-ui/src/lib/api-client.ts`:
  - Methods like `apiClient.tasks.list(input)` → `Promise<ListTasksOutput>`.
  - Shares the browser Bearer path with `apiFetch` (Filip's helper) via the
    `getFirebaseIdToken()` helper in `lib/firebase-id-token.ts` — one source
    of truth for `auth.currentUser.getIdToken()`. The typed client itself is
    Firebase-free; the browser wrapper `lib/mediforce.ts` injects the helper
    as its `bearerToken` callback.
  - Parses the response through `<Endpoint>OutputSchema` — runtime guarantee.
  - Input type + schema come from `@mediforce/platform-api/contract`.
- Migrate one non-realtime hook (settings list, archived items, detail view) from `useCollection` / direct Firestore SDK to `apiClient`.
- Journey test for that page stays green — establishes the pattern.

**Accepted trade-off:** the first migrated hook loses real-time updates. That's fine for a non-critical read. Live reads come back later via SSE (Phase 6).

**Status**: started in #232 — `Mediforce` class in `@mediforce/platform-api/client` + `mediforce.tasks.list` + `useInstanceTasks` hook consuming it in `StepHistoryTabs` and `TaskDetail.siblingTasks`. Expand the class alongside each Phase 1 / 2 endpoint migration rather than in one sweep.

**Client shape** — runtime-agnostic, Stripe-style. Exactly one of three config fields must be provided at construction:

- `apiKey: string` → server-to-server (CLI, agent, MCP server). Uses `globalThis.fetch`, attaches `X-Api-Key`.
- `bearerToken: () => Promise<string | null>` → user session (browser). Called per request for rotation; attaches `Authorization: Bearer`.
- `fetch: typeof fetch` → escape hatch. Test loopback, retry/tracing wrappers with auth baked in via closure. No auth headers added by the client — caller's fetch handles it.

Firebase is never imported by `platform-api/client` — the browser wrapper in `platform-ui/src/lib/mediforce.ts` supplies `bearerToken` by reference to `getFirebaseIdToken()` (in `lib/firebase-id-token.ts`), which lazily imports the Firebase SDK and reads `auth.currentUser.getIdToken()`. That same helper backs `apiFetch`, so every browser-initiated call — typed or raw — produces byte-identical auth headers. For Node consumers, just `new Mediforce({ baseUrl, apiKey })`.

**Open questions to settle**:
- Do we keep our own tiny async-hook helper (`useInstanceTasks` pattern — `useState` + `useEffect` + cancelled flag), or adopt an existing library (`@tanstack/react-query` / `swr`) that gives caching, dedup, stale-while-revalidate for free?
- Error surface — today `ApiError` is thrown from the client; hooks map it to `{ error }` state. Do we standardise an error boundary + toast pattern for failed API calls?

### Phase 5 — Delete `@/lib/platform-services` shim

Mechanical cleanup. After Phase 4 the adapter surface is mostly migrated and we can codemod the remaining imports:

- Every `import { getPlatformServices } from '@/lib/platform-services'` → `from '@mediforce/platform-api/services'`
- Every `import { getAppBaseUrl } from '@/lib/platform-services'` → `from '@/lib/app-base-url'`
- Delete `packages/platform-ui/src/lib/platform-services.ts`

**Scope:** ~100+ imports, trivial per file. Single PR.

**Pause-safe**: yes, but the shim is intentionally minimal and trivial — pausing mid-codemod looks ugly. Best to do it in one go.

**Open questions**: none expected — this is mechanical.

### Phase 6 — Migrate remaining UI data fetching

The biggest remaining bypass: client hooks that read Firestore directly via SDK, skipping the API entirely (`useCollection`, `useProcessInstance`, `useAuditEvents`, etc.).

- Each hook gets rewritten to consume `apiClient`.
- Live-critical hooks (active tasks, running processes) need a live-update story — most likely **SSE endpoints** exposed from `platform-api` handlers, one per subscribable resource. `apiClient` wraps `EventSource`.
- Firestore SDK can be removed from browser once all live hooks have moved; at that point the browser no longer needs Firestore project config.

Ship this progressively — one hook at a time, backed by journey tests.

**Pause-safe**: yes — per-hook migration, each backed by a journey test that must stay green. Any pause leaves untouched hooks on the Firestore bypass, working as today.

**Open questions to settle**:
- How does the browser subscribe to an SSE endpoint through `apiFetch`? `fetch` with `Accept: text/event-stream` works; `EventSource` doesn't support custom headers without a proxy hop. The simplest path is `fetch` + `res.body.getReader()` + incremental parse — do we hide that inside `apiClient.tasks.subscribeByRole(role, onEvent)`?
- Auth for long-lived streams — Firebase ID tokens expire (~1 h). Do we reconnect on expiry, refresh on the server, or scope streams to a shorter lifetime and let the client reopen?
- Granularity — one endpoint per subscribable collection (`/api/tasks/stream`, `/api/processes/:id/stream`) or one generic `subscribe` endpoint that takes a contract-defined query? The former is simpler; the latter mirrors Firestore's model more closely.

### Phase 7 — Optional: split API into separate deployable

Only if there's a real reason (scaling, non-Next clients, independent deploy cadence).

- Add `apps/api-server/` with a small HTTP runtime (Hono or Fastify) that mounts the platform-api handlers.
- Deploy split: UI somewhere static (Vercel/CDN), API server somewhere with runtime (Cloud Run / Fly).
- Next.js `/api/*` routes become a thin proxy, or get removed entirely.

Until there's a concrete forcing function, we keep the Next.js-embedded API. Don't split for splitting's sake.

**Pause-safe**: N/A — this is "do it or don't".

**Open questions to settle if we get here**:
- Runtime choice — Hono (edge-compatible, small) vs Fastify (mature, plugins). Both mount our pure handlers trivially.
- Auth — the API server would validate the same Firebase ID token; does it share a Firebase Admin service account with the Next.js app, or use its own?
- Internal server-to-server calls today use `X-Api-Key` + `getAppBaseUrl()` pointing at the same host. A split deploy needs service discovery or a shared base URL env var.

## Testing strategy

Tests are the primary way we read and reason about this codebase. They have to be **elegant, predictable, and cheap to extend** — if writing a test for a new endpoint feels like carpentry, the pattern is wrong and we fix the pattern, not the endpoint.

### Layers (shift-left pyramid)

| # | Layer | Proves | Runner | Budget | Lives in |
|---|---|---|---|---|---|
| 1 | **Contract** | Zod input/output invariants, refines, enums | Vitest | <50ms | `packages/platform-api/src/handlers/<domain>/__tests__/contract.test.ts` |
| 2 | **Handler** | Pure handler behaviour against real in-memory repos | Vitest | <100ms | `packages/platform-api/src/handlers/<domain>/__tests__/<name>.test.ts` |
| 3 | **Adapter** | `createRouteAdapter` wiring (400 / 500 / JSON serialisation) | Vitest | <200ms | `packages/platform-ui/src/lib/__tests__/route-adapter.test.ts` + sampled `src/app/api/**/__tests__/route.test.ts` |
| 4 | **API client** | URL serialisation, input validation, response parsing, `ApiError` shape | Vitest (mocked `apiFetch`) | <200ms | `packages/platform-ui/src/lib/__tests__/api-client.test.ts` |
| 5 | **Cross-layer integration** | Client ↔ adapter ↔ handler ↔ repo round-trip, no HTTP | Vitest (loopback `apiFetch`) | <500ms | `packages/platform-ui/src/test/api-integration.test.ts` |
| 6 | **Hook** | Async state — loading/error/cancel/dep-change | Vitest + `@testing-library/react` `renderHook` | <500ms | `packages/platform-ui/src/hooks/__tests__/<name>.test.ts` |
| 7 | **Component** | Non-trivial conditional rendering (forms, branches, error states) | Vitest + `@testing-library/react` | <500ms | colocated `*.test.tsx` (sparingly) |
| 8 | **Engine** | Workflow orchestration loops (transitions, triggers, RBAC) | Vitest + in-memory repos | <1s | `packages/workflow-engine/src/__tests__/` |
| 9 | **Plugin unit** | Individual agent plugin behaviour | Vitest | <1s | `packages/agent-runtime/src/plugins/__tests__/` |
| 10 | **Auto-runner integration** | Orchestrator endpoint against Firestore emulator | Vitest + emulator | ~5s | `packages/platform-ui/src/app/api/__tests__/` |
| 11 | **Structural guard** | Architectural invariants — imports, test presence, auth coverage | Vitest (file scan) | <200ms | `packages/platform-ui/src/test/integration/api-boundaries.test.ts`, `api-auth-coverage.test.ts` |
| 12 | **E2E journey** | User-visible flow through real browser | Playwright + emulator + Next.js dev | ~60s | `packages/platform-ui/e2e/ui/*.journey.ts` |
| 13 | **E2E smoke** | Unauthenticated pages (login, redirect) | Playwright (no emulator) | ~15s | `packages/platform-ui/e2e/smoke.spec.ts` |

### Mocking — where and how much

| Below HTTP boundary (handler, engine, workflow) | Above HTTP boundary (adapter, client, hook, component) |
|---|---|
| **Never mock.** Use `InMemory*Repository` from `@mediforce/platform-core/testing`. | **Mock sparingly**, only at the outermost seam (e.g. `apiFetch` for client; `apiClient.tasks.list` for hook). |
| Mocks drift; in-memory doubles update with the interface. | These layers are thin; a real in-process loopback is often simpler than a mock. |

**The loopback pattern** (our "zgrabne mockowanie") — for integration tests that want to exercise the full stack without HTTP:

```ts
// Test file
let currentRoute: ((req: NextRequest) => Promise<Response>) | null = null;

vi.mock('../lib/api-fetch', () => ({
  apiFetch: async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
    return currentRoute!(new NextRequest(absolute, init));
  },
}));

beforeEach(() => {
  currentRoute = createRouteAdapter(ListTasksInputSchema, inputFromReq, handler);
});
```

Three moving parts (mock, setter, handler construction) — no hidden ceremony. See `packages/platform-ui/src/test/api-integration.test.ts` for the canonical example.

### Fixtures and factories — one source of truth

`@mediforce/platform-core/testing` exports everything:

- **`InMemory*Repository`** — full in-memory implementations of every repo interface. Extend these as new interfaces land; never hand-roll per test.
- **`build*(overrides?)`** — deterministic object factories (`buildHumanTask`, `buildProcessInstance`, `buildAgentRun`, …). IDs come from an incrementing counter; reset with `resetFactorySequence()` in `beforeEach` when order matters.

If a test needs a shape not covered by a factory, **add the factory** — don't inline literal objects repeatedly.

### Good practices

1. **Shift left relentlessly.** A bug caught at the contract layer is ~1000× cheaper than at E2E. Write contract → handler → adapter → hook → integration in that order. Skip layers that can't catch anything the earlier ones couldn't.
2. **One assertion per concept.** If a test has five `expect(…)` calls for five distinct behaviours, split it. The test name is documentation — if you can't finish the sentence "it …", split the test.
3. **Colocate tests with source.** `src/foo/bar.ts` → `src/foo/__tests__/bar.test.ts`. The boundary guard (`api-boundaries.test.ts`) enforces this for handlers.
4. **Reset state in `beforeEach`.** Every test is independent. Fresh in-memory repo, fresh factory counter, fresh stubs.
5. **Name tests as user-visible statements.** "returns tasks filtered by instanceId" > "test1" > "works correctly". Tests are the spec.
6. **Make the helper before writing the third copy.** If the same three-line block appears in two tests, leave it. If it appears in a third, extract it.

### Anti-patterns — what we don't do

- **Coverage theater.** Testing that `render()` doesn't throw, or that a module exports a function. Adds files, proves nothing. If the test would still pass with `expect(true).toBe(true)`, delete it.
- **Over-mocking.** If you mock every dependency, you test the mock. Handler tests get a real in-memory repo; hook tests mock only the outermost seam.
- **Testing framework internals.** Don't assert on `useEffect` invocation counts or React's render cycles. Assert on what the user sees.
- **Fragile selectors.** `getByRole('button', { name: /submit/i })` > `container.querySelector('.btn-primary')`. DOM class names are incidental; ARIA roles are contract.
- **Duplicate coverage across layers.** If the contract test asserts "role + status=completed is rejected", don't replay the same assertion at adapter, client, and integration layers. Each layer has its own responsibility — see the table above.

### What we have today (as of #232)

Honest self-review. `✅` = good template, `⚠️` = deliberately deferred, `🔴` = gap to close.

| Layer | Coverage | Notes |
|---|---|---|
| Contract | `listTasks` — 13 tests | ✅ Template for every future endpoint |
| Handler | `listTasks` — 8 tests against `InMemoryHumanTaskRepository` | ✅ |
| Adapter | `createRouteAdapter` — 3 tests; `tasks/route.ts` — 5 tests (Filip-era mocks, stale but harmless) | ✅ Harmless mock debt called out in plan Phase 5 |
| API client | `apiClient.tasks.list` — 6 tests, `apiFetch` mocked | ✅ |
| Integration | apiClient ↔ adapter ↔ handler ↔ repo — 2 tests | ✅ First of kind; grow 1 per major feature, not per endpoint |
| Hook | `useInstanceTasks` — 5 tests, incl. cancel-on-deps-change | ✅ Template for Phase 4 / 6 migrations |
| Component | `StepHistoryTabs` — 0 unit tests | ⚠️ Deliberately skipped; E2E covers, component logic trivial |
| Structural | `api-boundaries.test.ts` (ours) + `api-auth-coverage.test.ts` (Filip's) | ✅ |
| Engine | Existing, unchanged | ✅ |
| Plugin unit | Existing, unchanged | ✅ |
| Auto-runner integration | Existing, unchanged | ✅ |
| E2E journey | Existing — no new journey for step-history migration (covered by existing process-detail journey) | ⚠️ Re-assess when Phase 6 migrates live hooks |
| E2E smoke | Existing, unchanged | ✅ |

**Gaps to close in Phase 1** (noted, not blocking the pilot):
- 🔴 Structured logging for `createRouteAdapter` 500s — today just `console.error`. Integrate with whatever observability Mediforce adopts.
- 🔴 Error contract schema — decide on typed error responses (`{ error: 'precondition_failed', details }`) vs the current `{ error: string }` before Phase 2 mutations land.
- 🔴 `seedBuiltinAgentDefinitions` silent-failure mode (pre-existing from main) — decide: fail-fast, retry, or SRE metric.

### Decision tree — "what test do I write?"

```
Added a Zod schema?          → Contract test
Added a handler?             → Handler test + extend contract test
Added an apiClient method?   → API client test
Added a UI data hook?        → Hook test (renderHook)
Added a non-trivial UI branch?  → Component test (sparingly)
Added a new architectural rule? → Structural guard in src/test/
Added a major feature (cross-cutting)? → ONE cross-layer integration test
Added a user-visible flow?   → E2E journey (only if hook+integration can't catch)
```

Nothing in this tree says "add an E2E because it's a new endpoint". E2E is expensive — earn it.

## Definition of done

The migration is complete when:

- [ ] Every `/api/*` route has a contract + handler + tests in `platform-api`
- [ ] `createRouteAdapter` is the only way Next.js route files call handlers
- [ ] The `@/lib/platform-services` shim is gone
- [ ] UI reads go through `apiClient`; Firestore SDK is no longer imported in browser code (Firebase auth still is)
- [ ] `packages/platform-ui/src/test/api-boundaries.test.ts` still passes — nothing drifted
- [ ] A CLI / agent / MCP server can consume `@mediforce/platform-api/contract` + call the deployed API with the same type safety the UI enjoys

Phases are independent; we can pause between any two and still have a working, tested product.

## Captured for later — out of headless-migration scope

Items surfaced during phase grilling that are real and worth doing, but
explicitly outside the UI/API separation goal. Review this section when the
migration is done — most of these become dedicated phases of their own.

### Phase 1.8 — File-serving + ticket endpoints (deferred from #482)

Endpoints with no contract started yet, so finishing-the-loop logic from
Phase 1.5 didn't apply. File-serving shape (streaming, range requests,
content-type negotiation) deserves its own design pass before the
contract gets written.

- `GET /api/agent-logs` — agent run log retrieval.
- `GET /api/agent-output-file` — agent output file retrieval.
- `GET /api/step-logs` — step execution log retrieval.
- `POST /api/tickets` — GitHub Issues bridge. Already inline-forever per
  Phase 2.5 out-of-scope list (external integration, has its own rate
  limit). Mentioned here only because #482 grouped it with the file-
  serving deferral; the headless-migration position is unchanged
  (stays inline).
- `DELETE /api/admin/docker-images` — mutation + deployment-admin
  auth; folds into Phase 2.5 admin bullet rather than Phase 1.8.

### Mutation audit emission (deferred during Phase 2 grilling, 2026-05-25)

**Current state.** Inline routes for tasks/process-state mutations
(`claim`, `complete`, `resolve`, `cancel`, `resume`) emit **zero** audit
events today. Engine + container-worker emit audit through their own paths.
HTTP-handler subset of mutations is the silent gap.

**Why deferred.** Headless-migration goal is UI/API separation (typed
contract, framework-free handlers). Audit emission is orthogonal:
- It doesn't gate the migration's value.
- Fixing it only on the HTTP-handler subset would be a half-fix — engine +
  worker write the same entities and need the same pipeline. Half-fix would
  ship inconsistency.
- Phase 2 mutations at parity with status-quo (no emission) is honest, not
  regressive.

**Likely future shape (sketched, not committed).** Industry-standard for
this problem is **repo-resident emission via a `MutationContext`** threaded
into every raw mutation method on entity repositories. Wrappers
(`Authorized<Entity>Repository`) build `MutationContext` from
`CallerIdentity` and pass through; raw repos write entity + audit row
together. Postgres-era (ADR-0001) gets free atomicity via transaction;
Firestore-era is best-effort dual-write with documented gap. Pattern
names: transactional outbox (Hohpe), audit log via repository decorator
(Fowler PoEAA). Handler ergonomics: zero audit boilerplate, no chance of
forgetting.

**Why repo-resident and not handler-resident:**
1. Repo is the only layer that sees **every** write path (HTTP, engine,
   worker, future MCP). Handler-resident silently misses non-HTTP writers.
2. Atomicity belongs to the persistence layer — only the repo can wrap
   entity-write + audit-row-write in a single transaction.
3. Audit-row-write is part of "how persistence happens", not "what the
   user requested." Mixing it into handlers leaks infrastructure into
   orchestration.

**Rejected alternatives sketched during grilling:**
- DB triggers (Postgres `AFTER UPDATE`). Free atomicity but action names
  (`task.claimed` vs `task.cancelled`) depend on which method was called,
  not detectable from row diff alone. Trigger sees "row changed" not "this
  was a claim." Reject.
- Event sourcing / domain events. Heavier infra than needed.
- Adapter-orchestrated. Only covers HTTP path; misses engine + worker.

**Interaction with ADR-0004.** §5 ("Wrappers never depend on other
wrappers") was written for cross-domain entity composition (e.g. tasks
wrapper not loading runs). Audit infrastructure is orthogonal and a
reasonable reading of §5 doesn't reach it; the future audit ADR will
either narrow §5 explicitly or supersede the relevant clause.

**Action.** Dedicated audit-wiring phase post-migration, with its own ADR
covering HTTP handlers + engine + worker uniformly. Don't pre-design here.
