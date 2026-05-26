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

**Final scope (rewritten 2026-05-26 after PR2 design pass — see [#499](https://github.com/Appsilon/mediforce/issues/499)):** narrowed further from the five-endpoint mid-phase scope to **two endpoints** — `claim` (PR1) and `cancel` (PR2). `complete`, `resume`, and `resolve` reclassified to Phase 3 because all three depend on the still-undecided orchestration-kick mechanism (fire-and-forget self-fetch to `/api/processes/:id/run` after state transition). Migrating them in Phase 2 would either pre-decide Phase 3 §"Orchestration kick mechanism" or ship handlers that know about HTTP/baseUrl/api-key. Neither is acceptable; defer.

**In scope:**

| Endpoint | Domain | PR | Shape |
|---|---|---|---|
| `POST /api/tasks/:taskId/claim` | tasks | PR1 ([#495](https://github.com/Appsilon/mediforce/pull/495)) | scope.tasks.claim(taskId, caller) — state-machine in handler |
| `POST /api/processes/:instanceId/cancel` | processes | PR2 | scope.runs.update(id, {status:'failed', error, updatedAt}) — state-machine in handler |

(`POST /api/cron/heartbeat` was originally in this list — repicked to Phase 3 because the route self-fetches `/api/processes/:id/run` to kick the run loop, making it an orchestration endpoint rather than an operational ping. See PR1 tracker's "Repick history" note + Phase 3 below.)

**Out of Phase 2 (moved to Phase 2.5 or Phase 3):**

- `POST /api/tasks/:taskId/complete` (+ four `complete*` variants — verdict/params/upload/assignment — collapsed into a discriminated-union body) → **Phase 3** — depends on orchestration-kick redesign (handler calls `engine.advanceStep` then fire-and-forget kicks `/api/processes/:id/run`).
- `POST /api/tasks/:taskId/resolve` → **Phase 3** — UI-unused duplicate of `/complete` (E2E `previous-run-outputs.journey.ts` is the only caller); deletion bundles with the `/complete` discriminated-union landing.
- `POST /api/processes/:instanceId/resume` → **Phase 3** — same orchestration-kick dependency as `/complete`.
- `POST /api/processes` (create new run) → Phase 2.5 — workspace-write gate, trigger payload validation, idempotency design needed.
- `POST /api/processes/:id/advance`, `POST /api/processes/:id/run`, `POST /api/processes/:id/steps/:stepId/retry` → **Phase 3** — orchestrates `WorkflowEngine` + `AgentRunner`, spawns Docker, fire-and-forget side effects. Needs its own design pass (sync vs queued execution).
- All cowork (`chat`/`message`/`finalize`) → **Phase 3** — SSE adapter unsolved.

**Dead-code cuts in PR2 (no API surface added):**

- `UnclaimButton` + `unclaimTask` Server Action — zero callers in source tree, deleted outright. No `/api/tasks/:taskId/unclaim` route. If the operator-release-back-to-queue feature returns, it earns a new design pass at that time.
- `cancelProcessRun` Server Action — deleted; UI moves to `mediforce.processes.cancel()`.

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

- State-machine invariants surface as typed errors (`PreconditionFailedError` → envelope `code: 'precondition_failed'` → 409). See the **error contract** open question below.
- **Audit emission — bridge.** Today's Server Actions hand-roll audit
  (`auditRepo.append({...})` inline in each action). API routes don't
  emit. Deleting the actions during Phase 2 would erase the only existing
  audit coverage for these mutations. To avoid a compliance regression
  during the gap between Phase 2 and the future audit-wiring phase
  (see "Captured for later" below), each new Phase 2 mutation handler
  emits audit inline via `scope.system.audit.append({...})` — same shape
  as today's Server Action code, ~6 LOC per handler. This is throwaway
  bridge code: the audit-wiring phase rewrites to repo-resident
  `MutationContext` and removes the handler-level emits. The raw audit
  write surface lives on `scope.system.audit` (the existing trusted-
  bypass lane that already holds `engine` / `agentRunner`), not on
  `AuthorizedAuditEventRepository` — see ADR-0005 §7/§8 for why.

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

#### PR1 — `tasks/claim` migration + adapter `HandlerError` arm + `loadOr404`

**Scope.** Smallest pure state-transition mutation
(`POST /api/tasks/:taskId/claim`) plus the `createRouteAdapter`
extension every subsequent mutation depends on. No orchestration, no
self-fetch, no new abstractions — proves the wrapper-layer +
`HandlerError` hierarchy + audit-bridge pattern end-to-end on one
endpoint.

**Repick history (2026-05-25).** Originally scoped to `cron/heartbeat`.
Repicked because cron-heartbeat is not operational — it scans cron
triggers, fires them, then **self-fetches** `/api/processes/:id/run` to
kick the run loop. That's fire-and-forget orchestration, same category
as `processes/run` and `processes/advance` which Phase 3 explicitly
defers. Cron-heartbeat moves to Phase 3 with its orchestration siblings;
PR1 picks a true minimal mutation instead.

**Files to touch:**
- `packages/platform-api/src/errors.ts` — extend `HandlerError`
  (from [#450](https://github.com/Appsilon/mediforce/pull/450)) with
  `code: ApiErrorCode` + `details?: unknown`. Existing
  `NotFoundError` / `ForbiddenError` keep their names; their
  constructors now also stash the code. Add
  `PreconditionFailedError` for the claim handler's state-machine
  throw. Other codes (unauthorized, validation, conflict,
  rate_limited) stay subclass-less until first real throw site —
  product code throws the base `HandlerError` directly.
- `packages/platform-ui/src/lib/route-adapter.ts` — single
  `instanceof HandlerError` catch arm per ADR-0005 §4:
  envelope reads `err.code`, `err.message`, `err.details`. Sibling
  `instanceof ZodError` arm + `console.error` + 500 fallback.
- `packages/platform-ui/src/lib/__tests__/route-adapter.test.ts` —
  parametric coverage per `ApiErrorCode` via the matching subclass
  throw + ZodError + unknown-error coverage.
- `loadOr404` helper — extract per [#482](https://github.com/Appsilon/mediforce/pull/482)
  out-of-scope note ("third copy" rule reached for the
  `entity = await scope.X.getById(id); if (!entity) throw …` pattern).
  Lives in `packages/platform-api/src/handlers/_helpers.ts` (or
  similar); used by PR1's claim handler + future lookup-with-404 sites.
- `packages/platform-api/src/contract/tasks.ts` — add
  `ClaimTaskInputSchema` (`{ taskId: z.string().min(1) }`) and
  `ClaimTaskOutputSchema` (`{ task: HumanTaskSchema }`). Export from
  `contract/index.ts`.
- `packages/platform-api/src/handlers/tasks/claim-task.ts` — new.
  Handler: assert `scope.caller.userId`, call `scope.humanTasks.claim()`
  (wrapper already exists), emit audit-bridge via
  `scope.system.audit.append({...})` — move the audit-emission code from
  today's `claimTask` Server Action (`packages/platform-ui/src/app/actions/tasks.ts:43-59`),
  do not author new audit shape.
- `packages/platform-api/src/handlers/tasks/__tests__/claim-task.test.ts`
  — contract + handler tests against in-memory scope.
- `packages/platform-api/src/repositories/caller-scope.ts` — extend
  `SystemServices` with `readonly audit: AuditRepository` (raw write
  surface for the audit bridge per ADR-0005 §7). Wired in
  `create-caller-scope.ts` from `services.auditRepo`.
  `AuthorizedAuditEventRepository` stays read-only.
- `packages/platform-ui/src/app/api/tasks/[taskId]/claim/route.ts` —
  replace inline handler with `createRouteAdapter` call. Path-param
  `taskId` merged into input via the `inputFromReq` callback.
- `packages/platform-api/src/client/mediforce.ts` — add
  `mediforce.tasks.claim(input)` method. Test it.
- `packages/platform-ui/src/app/actions/tasks.ts` — **delete** the
  `claimTask` function (only; leave `unclaimTask` and the four
  `complete*` actions — they migrate in PR2).
- `packages/platform-ui/src/components/tasks/claim-button.tsx` —
  replace the dynamic `import('@/app/actions/tasks').then(({claimTask})...)`
  with `mediforce.tasks.claim({taskId})`. **Leaves the unclaim path on
  the Server Action** as an intentional temp state — PR2 deletes it
  when adding the new `/unclaim` route.

**Server Actions deleted:** `claimTask` only.

**New routes added:** none (claim route already exists).

**Mixed-state callout for PR description:** `claim-button.tsx` is
temporarily split — claim goes through `apiClient`, unclaim goes
through the existing Server Action. PR2 closes the loop by adding the
`/unclaim` route, migrating unclaim, and deleting `unclaimTask`.

**Test layers:** contract + handler + adapter + client method test +
hook/component test for claim-button update + 1 cross-layer integration
through the loopback pattern.

**Exit criteria:**
- `POST /api/tasks/:taskId/claim` returns `{ task: HumanTask }` on
  success; `403` + typed envelope for non-member; `404` + envelope
  for foreign-workspace task (anti-enum); `409` + envelope for task
  not in `pending` status.
- Audit emission preserved bit-for-bit: AuditEvent rows produced by
  the migrated handler match what `claimTask` Server Action emitted
  (action `task.claimed`, same actor/description/snapshots/basis).
- All `ApiErrorCode` values map to correct HTTP status via the single
  `HandlerError` adapter arm; covered parametrically in adapter tests
  by throwing the matching subclass.
- `api-boundaries.test.ts` + `no-raw-repo-imports.test.ts` pass.
- Existing Phase 1 / Phase 1.5 GET endpoints retroactively return the
  new error envelope (`{ error: string }` → `{ error: { code, message } }`).
  UI code reading `err.error` updated to `err.error.message`. Tests
  asserting on string envelope updated mechanically.
- `mediforce.tasks.claim()` round-trip green via cross-layer integration
  test.
- E2E journey involving claim still green.

#### PR2 — `processes/cancel` migration + dead-code cleanup (closes Phase 2)

**Scope (final — narrowed 2026-05-26 from the earlier five-endpoint plan; see [#499](https://github.com/Appsilon/mediforce/issues/499) for rationale).** One endpoint migrated, three Server Actions deleted, one dead UI component removed.

Endpoint:
- `POST /api/processes/:instanceId/cancel` — migrate.

Reclassified to Phase 3 (orchestration-kick group):
- `POST /api/tasks/:taskId/complete` (+ discriminated-union body collapsing `completeTask` / `completeParamsTask` / `completeUploadTask` / `completeAssignmentTask`).
- `POST /api/tasks/:taskId/resolve` — UI-unused duplicate; deleted alongside `/complete`'s landing.
- `POST /api/processes/:instanceId/resume`.

These three depend on the orchestration-kick mechanism (fire-and-forget self-fetch to `/api/processes/:id/run` after state transition) whose design is deferred to Phase 3. Migrating them in PR2 would either pre-decide the kick or ship handlers leaking HTTP/baseUrl/api-key concerns.

Cut as dead code (no API surface added):
- `UnclaimButton` (`claim-button.tsx`) + `unclaimTask` Server Action — neither was rendered or called anywhere in source. Deleted outright.

**Files touched:**
- `packages/platform-api/src/contract/processes.ts` — `CancelRunInputSchema { runId, reason? }` / `CancelRunOutputSchema { run }` (output reuses `ProcessInstanceSchema` per ADR-0005 §5; contract symbols use `Run` per ADR-0001 vocabulary even though the underlying storage schema is still named `ProcessInstanceSchema`).
- `packages/platform-api/src/handlers/processes/cancel-run.ts` — new handler. Reuses `scope.runs.update()` rather than introducing a dedicated wrapper method (matches PR1's "state-machine in handler" deviation; `ProcessInstanceRepository.cancel(id, reason)` from ADR-0005 §8 is deferred until a second mutation needs it). Audit action `instance.cancelled` matches workflow-engine's `instance.*` family + legacy `bulkCancelProcessRuns` emit.
- `packages/platform-api/src/handlers/processes/__tests__/cancel-run.test.ts` — contract + handler tests against `createTestScope`.
- `packages/platform-api/src/contract/__tests__/processes.test.ts` — contract schema unit tests.
- `packages/platform-ui/src/app/api/processes/[instanceId]/cancel/route.ts` — replaced inline body with `createRouteAdapter`. URL path keeps the legacy `processes/:instanceId` segment until a coordinated URL rename phase; the adapter translates `params.instanceId` → `runId`.
- `packages/platform-api/src/client/index.ts` — `mediforce.runs.cancel(input)` method (sits next to `runs.list/get/start`).
- `packages/cli/src/commands/run-cancel.ts` — new CLI command `mediforce run cancel <runId> [--reason <text>]`.
- `packages/platform-ui/src/components/processes/process-detail.tsx` — swap `cancelProcessRun` action call for `mediforce.runs.cancel({ runId })`.
- `packages/platform-ui/src/components/processes/agent-escalated-banner.tsx` — same swap.
- `packages/platform-ui/src/lib/workflow-status.ts` — comment-only update (the `'Cancelled by user'` literal gate stays; comment now points at the handler default).

**Server Actions deleted (move-not-add for `cancelProcessRun` audit):**
- `packages/platform-ui/src/app/actions/processes.ts` — `cancelProcessRun` deleted; audit payload moved into the cancel handler. Retains `startWorkflowRun`, `retryFailedStep`, `archiveProcessRun`, `bulkCancelProcessRuns`, `bulkArchiveProcessRuns` (Phase 2.5 / Phase 3 scope).
- `packages/platform-ui/src/app/actions/tasks.ts` — `unclaimTask` deleted (dead code, no audit to preserve). Retains `completeTask`, `completeParamsTask`, `completeUploadTask`, `completeAssignmentTask` (move with `/complete` discriminated-union to Phase 3).

**Test layers:** contract + handler + adapter (PR1 covers parametrically) + client method test + cross-layer integration round-trip (`api-integration.test.ts` extended) + existing E2E process-detail journey covers cancel button click.

**Exit criteria (met):**
- `POST /api/processes/:instanceId/cancel` returns `{ run: WorkflowRun }`; `404` for missing/foreign-workspace ids (anti-enum); `409 precondition_failed` for non-running/non-paused.
- Audit emission preserved bit-for-bit (`instance.cancelled` event matches the prior Server Action shape — actor derived from `scope.caller`, default reason `'Cancelled by user'` literal unchanged, consistent with workflow-engine `instance.*` family).
- `mediforce.runs.cancel()` available in browser (via `lib/mediforce`) + CLI + Node consumers.
- `app/actions/processes.ts:cancelProcessRun` and `app/actions/tasks.ts:unclaimTask` deleted; UI callers (`process-detail.tsx`, `agent-escalated-banner.tsx`) moved to typed client.
- `UnclaimButton` removed from `claim-button.tsx`; `ClaimButton` retained.
- Phase 2 closed. Wrapper-layer mutation pattern proven on two state transitions of opposite shape (`claim`: pending→claimed, `cancel`: running/paused→failed).

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

### Phase 3 — Kick-driven mutations (split from prior Phase 3 — 2026-05-26)

**Split rationale (2026-05-26, post-PR501 grilling).** The pre-2026-05-26 Phase 3 bundled three orthogonal problems:
1. Reclassified state-transition mutations that need an orchestration kick (`tasks/complete`, `tasks/resolve`, `processes/resume`).
2. Streaming response shape (cowork chat/message/finalize SSE).
3. Run executor durability (queue migration of the `/api/processes/:id/run` auto-runner loop).

Each is a separate design pass with different risk and different reviewers. Bundling forced the streaming decision to wait on the kick decision and vice versa. Split:

- **Phase 3** (this section) — kick mechanism + reclassified mutations + cron-heartbeat + retry + processes-create + remaining `app/actions/*.ts` cleanup.
- **Phase 3.1** (below) — Cowork SSE x3. Own grill session, own streaming-adapter design.
- **Future ADR (not a phase)** — BullMQ-based run executor. Replaces self-fetch kick + relocates auto-runner loop out of Next.js `after()`. Triggered only after Phase 3 proves the `runKicker` abstraction. Out of headless-migration scope (concerns runtime durability, not API surface).

**In-scope endpoints** (audited 2026-05-26 — see "Pre-PR audit findings" below):

| Endpoint | Source | Notes |
|---|---|---|
| `POST /api/tasks/:taskId/complete` | reclassified PR501 | Discriminated-union body (4 variants: verdict/params/upload/assignment); step-gate validation handled by `engine.advanceStep` (NOT by handler — confirmed in audit). Biggest endpoint by surface, simplest by shape — fits existing wrapper-layer pattern. |
| `POST /api/processes/:instanceId/resume` | reclassified PR501 | Pure state transition; pattern mirrors `cancel`. |
| `POST /api/processes/:instanceId/steps/:stepId/retry` | original Phase 3 | State reset + kick. Shape similar to `resume`. |
| `POST /api/cron/heartbeat` | repicked from Phase 2 PR1 | Trigger-scan logic clean; N kicks per heartbeat (one per due trigger). |
| `POST /api/processes` (create) | moved from Phase 2.5 | Trigger-payload validation against definition input schema; create + kick in one handler. **Idempotency NOT added in this PR** — today's behaviour is "no dedupe at all", and headless migration does not introduce new features. Idempotency → separate future ticket. |

**Pre-PR audit findings (2026-05-26 — affects scope):**

- `POST /api/tasks/:taskId/resolve` — **delete the route**, do not migrate. Grep confirmed zero external callers; route is "thin HTTP wrapper around `resolveTask()` lib" (`packages/platform-ui/src/app/api/tasks/[taskId]/resolve/route.ts:7-9`). Lib (`@/lib/resolve-task`) is heavily used by `app/actions/tasks.ts` for the four `complete*` actions and stays in place — the four `tasks/complete` body variants in the migrated handler will call into the lib directly (or absorb it). PR501's "UI-unused duplicate" claim is confirmed.
- `POST /api/processes/:instanceId/advance` — **drop from Phase 3 scope entirely.** Grep confirmed zero external callers (only the route's own tests + the engine's internal `engine.advanceStep()` method, which is a different code path). The HTTP endpoint never gets called by UI / CLI / agents. Annotate `@internal-route` and leave inline forever.
- `app/actions/cowork.ts` — uses zero Server Action features (no `revalidatePath` / `redirect` / form action). Default per ADR-0005 §6 is "delete on migrate", but the file is 451 LOC of meaningful business logic (synthesis-prompt constants, transcript parser, `sendMessage` self-fetch wrapper). **Cleanup deferred to Phase 3.1** (it pairs with the cowork SSE endpoints; relocating 451 LOC mid-Phase-3 would bloat the diff).

**Out of Phase 3 scope (intentional):**

- `POST /api/processes/:instanceId/run` — internal auto-runner endpoint. **Not migrated in Phase 3.** Stays as-is (600-LOC inline route + Next.js `after()` loop + in-memory `runLocks` Set). Becomes "kicked endpoint" called via the new abstraction. Migration covered by the future BullMQ executor ADR.
- `POST /api/processes/:instanceId/advance` — confirmed internal-only by audit; stays inline forever.
- Cowork SSE + `app/actions/cowork.ts` cleanup → **Phase 3.1**.
- Run executor queue migration → future ADR.
- Idempotency for `processes` POST create → separate future ticket (new feature, orthogonal to headless migration).

**Decision — Orchestration kick mechanism: `scope.system.runKicker` abstraction.**

The kick is the gating dependency for every reclassified handler. Settled on the `runKicker` abstraction (option (a) from the prior open-questions list) for Phase 3, with explicit fwd-compat to a queue-based executor later.

**What it is.** A single-method interface threaded through `CallerScope.system`:

```ts
interface RunKicker {
  /**
   * Notify the runtime that this instance has been advanced and needs the
   * auto-runner to execute its current step. Fire-and-forget — returns when
   * the kick is dispatched, not when the run completes. Idempotent: if the
   * runtime is already executing this instance, the kick is a no-op
   * (200/409 on the underlying transport, swallowed).
   */
  kick(instanceId: string, opts?: { triggeredBy?: string }): Promise<void>;
}
```

**Production impl (`httpSelfFetchRunKicker`).** Encapsulates exactly today's pattern — `getAppBaseUrl()` + `fetch(/api/processes/:id/run)` + `X-Api-Key` header + `.catch(() => {})`. One place, not eight.

**Test impl (`noopRunKicker` / `syncRunKicker`).** No-op for unit/handler tests; in-process synchronous execute for cross-layer integration tests that want to assert the kicked state.

**Why this is right for Phase 3.**
- Headless cel: handlers framework-free (no `getAppBaseUrl`, no `PLATFORM_API_KEY`, no `fetch`). ✅
- Pause-safe: per-endpoint migration; remaining inline routes still call the same kick. ✅
- Zero behaviour change: prod impl is bit-for-bit today's self-fetch. ✅
- Workaround stays a workaround **under** the abstraction; future BullMQ migration swaps one impl, handlers untouched. ✅
- Engine stays pure state-machine; no runtime concern leaks into `workflow-engine`. ✅

**What it does NOT solve (deferred to BullMQ ADR):** crash safety (`after()` dies with worker), distributed lock (`runLocks` per-process), retry / DLQ / observability, multi-worker race ("two Next.js workers run two parallel loops"). Today's prod = single VPS, single worker — pattern works **until** we scale out.

**Self-fetch sites today (kicks of `/api/processes/:id/run`) — 8:**

| Site | Style | Disposition in Phase 3 |
|---|---|---|
| `api/cron/heartbeat/route.ts` | `await` (blocks until 202) | migrate to handler; `await scope.system.runKicker.kick()` |
| `api/tasks/[taskId]/complete/route.ts` | fire-and-forget | migrate to handler |
| `api/processes/[instanceId]/resume/route.ts` | fire-and-forget | migrate to handler |
| `api/processes/route.ts` (POST create) | fire-and-forget | migrate to handler |
| `api/processes/[instanceId]/steps/[stepId]/retry/route.ts` | fire-and-forget | migrate to handler |
| `app/actions/cowork.ts` (cowork finalize) | fire-and-forget | leave inline; swap kick line to `runKicker` only — Phase 3.1 deletes the file |
| `app/actions/processes.ts:startWorkflowRun` | fire-and-forget | delete (folds into POST create handler) |
| `app/actions/processes.ts:retryFailedStep` | fire-and-forget | delete (folds into retry handler) |

**PR sequencing — one PR.** Mediforce convention from Phase 1 (#450, 10 GETs) and Phase 1.5 (#482, 7 endpoints): land the whole shape in one reviewable PR rather than dribble a phase across six. Smaller PRs were rejected during grilling — pattern is uniform across these mutations (kick + audit + entity echo + state transition), so iterating endpoint-by-endpoint produces churn without learning.

**Single PR scope:**
- `RunKicker` interface + `scope.system.runKicker` wiring in `caller-scope.ts` + prod impl (`httpSelfFetchRunKicker`) + test impl (`noopRunKicker`, plus `syncRunKicker` if integration tests need post-kick assertion).
- All 8 self-fetch sites retrofitted to `scope.system.runKicker.kick()` — those that get migrated to handlers do it inline; those that don't (`/api/processes/:id/run` itself stays inline) just swap the kick line.
- Migrate every in-scope endpoint to the headless handler shape: `tasks/complete` (4-variant discriminated union), `tasks/resolve` (or delete if UI-unused — verify first), `processes/resume`, `processes/steps/:stepId/retry`, `cron/heartbeat`, `processes` POST create.
- Add `mediforce.X.Y()` typed client methods + CLI commands for each.
- Delete the matching server actions per ADR-0005 §6 (move-not-add for audit emission). Confirm `app/actions/tasks.ts` empty (delete file); `app/actions/processes.ts` retains only `archiveProcessRun` + `bulkCancelProcessRuns` + `bulkArchiveProcessRuns` (Phase 2.5 scope).
- Wrapper-layer additions on `AuthorizedHumanTaskRepository` / `AuthorizedWorkflowRunRepository` as each endpoint needs them.

**Estimated size:** ~1.5-2 weeks of work, large diff (~2-3k LOC like #450). Single review pass.

**Pause-safe within the PR:** no. Once it lands, it lands as a whole. Inside the working branch, each endpoint migration is a clean commit so reviewers can read them sequentially.

**Pre-PR audits — completed 2026-05-26.** Findings folded into the "In-scope endpoints" + "Out of Phase 3 scope" tables above. Three follow-ups changed Phase 3 shape: `advance` dropped (internal-only), `resolve` route deleted (UI-unused), cowork cleanup deferred to Phase 3.1.

**Test impl decision — `noopRunKicker` only.** `createTestScope` gets `noopRunKicker` (spy-friendly: assertion = "was kicked with X"). `syncRunKicker` (in-process execute) deferred — no current test needs post-kick state assertion, and `api-integration.test.ts` loopback pattern is non-streaming round-trip only. Add later when a concrete use case lands.

**Decisions locked during grilling (2026-05-26):**

- **`tasks/complete` shape — one endpoint with discriminated-union body.** Today is already one route (`/api/tasks/:taskId/complete`) accepting four payload shapes; lib (`resolveTask`) is one function taking a union; audit action is one (`task.completed`); side effects identical. The four variants differ only in payload shape determined by `step.ui` / `step.params` / `step.selection` config — client already knows which to send by reading the task's GET. Splitting into four sibling endpoints would give false signals ("these are different operations") for what's conceptually one. Industry alignment: Stripe `POST /v1/payment_intents/:id/confirm` (discriminator `payment_method.type`) — same pattern. Contract:

  Discriminator field: `kind` — matches codebase convention (`ActionConfigSchema.kind`, `PresentationSchema.kind` for operation/payload variants; `type` is reserved for protocol/external variants like `HttpAuthConfigSchema.type` / `AgentMcpBindingSchema.type`).

  ```ts
  const CompleteTaskInputSchema = z.object({
    taskId: z.string().min(1),
    payload: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('verdict'), verdict: z.enum(['approve', 'revise']), comment: z.string().optional() }),
      z.object({ kind: z.literal('params'), paramValues: z.record(z.string(), z.unknown()) }),
      z.object({ kind: z.literal('upload'), attachments: z.array(AttachmentSchema) }),
      z.object({ kind: z.literal('assignment'), assignments: z.array(AssignmentSchema) }),
    ]),
  });
  ```

- **`cron/heartbeat` audit emission — ONLY `cron.trigger.fired`, NOT skipped.** Audit is a state-change record (pharma compliance trail), not an evaluation log. Skipping a not-due trigger changes no state and has no compliance significance — same logic that exempts the heartbeat call itself (`cron.heartbeat` stays `@no-audit`). The HTTP response already returns `{ triggered, skipped }` for debug visibility; skips also `console.log`. Audit row spam math: N cron WDs × 96 beats/day × ~95% skip rate would produce hundreds of "nothing happened" rows/day for nothing. Engine convention is "emit only on state change" — cron-heartbeat follows it. Snapshot:
  - `action: 'cron.trigger.fired'`
  - `inputSnapshot: { triggerName, definitionName, definitionVersion, schedule }`
  - `outputSnapshot: { instanceId }`
  - `basis: 'Cron trigger schedule due'`
  - `entityType: 'processInstance'`, `entityId: result.instanceId`, `processInstanceId: result.instanceId`

- **`processes` POST create response shape — ADR-0005 §5 entity echo.** `201 Created` + `{ run: WorkflowRun }`. Today's `{ instanceId, status, message }` is bespoke drift. The breaking change is migrated in the same PR (UI callers swap `result.instanceId` → `result.run.id`; CLI command updates inline). Rejecting carve-outs preserves ADR uniformity — first endpoint that breaks §5 opens the door for every endpoint to break it.

- **`instance.retried` audit snapshot — matches engine emit pattern.** Same shape as engine.ts `instance.*` emits (`inputSnapshot` = what triggered, `outputSnapshot` = what changed, `description` = verb sentence, `basis` = short why).

  ```ts
  await scope.system.audit.append({
    actorId: scope.caller.userId ?? 'api-user',
    actorType: 'user',
    actorRole: scope.caller.role ?? 'operator',
    action: 'instance.retried',
    description: `Retried failed step '${stepId}' on instance '${instanceId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { instanceId, stepId, previousExecutionId, previousError },
    outputSnapshot: { resetTo: 'running', currentStepId: stepId, newExecutionId },
    basis: 'User requested retry of failed step via API',
    entityType: 'processInstance',
    entityId: instanceId,
    processInstanceId: instanceId,
  });
  ```

- **`unclaimTask` endpoint — NOT added.** PR501 deleted `unclaimTask` Server Action + `UnclaimButton` component as dead code (zero source callers). Phase 3 does not introduce a `POST /api/tasks/:taskId/unclaim` endpoint. If a future use case lands, opens its own ticket.

**Decision — `/api/processes/:instanceId/advance`.** Investigate user-facing surface before committing to migrate. If only `engine` and tests call it, leave inline forever (internal API, not headless contract).

**Decision — Server Action policy on cowork+processes leftovers.** Per ADR-0005 §6: default delete on migrate. `app/actions/cowork.ts` deletion deferred to Phase 3.1 (its endpoints stream).

**Open questions to settle during Phase 3 (non-blocking for PR1):**
- Test impl ergonomics — `noopRunKicker` enough for handler tests, or do we want `syncRunKicker` (executes loop in-process) for cross-layer integration coverage? Adds complexity to the test scope but lets us assert post-kick state.
- `tasks/resolve` — confirm UI-unused; if so, delete in PR2 rather than migrate.
- `processes/advance` user-facing? Audit callers; decide migrate vs leave inline.
- `processes` POST create idempotency — client-supplied key vs server-derived dedupe window. Inherits Phase 2.5 open question.
- `tasks/complete` step-gate validation — handler loads parent run + WorkflowDefinition + walks step config to validate verdict payload. Cross-entity load is the first complex handler shape; pattern question.

### Phase 3.1 — Cowork streaming (split from Phase 3 — 2026-05-26)

Three endpoints. All stream SSE. All write to multiple repos. Orthogonal to the kick decision. Own design pass deferred — see the `/grill-with-docs` task spawned 2026-05-26.

**In-scope:**

- `POST /api/cowork/:sessionId/chat` — LLM streaming (assistant token-by-token).
- `POST /api/cowork/:sessionId/message` — user message append + optional LLM response stream.
- `POST /api/cowork/:sessionId/finalize` — locks session, writes artifact, may emit kick (which uses `scope.system.runKicker` from Phase 3 PR1). Multi-repo write; atomicity question.

**Why split.** Streaming handler shape is its own design question (AsyncGenerator vs callback vs EventEmitter) with no overlap with the kick mechanism. Finalize is the only cowork endpoint that needs the kick — and it gets `runKicker` from Phase 3 PR1 for free.

**Open questions (Phase 3.1 grill — not Phase 3):**
- Streaming handler shape: `AsyncGenerator<Event>` (cleanest functional) vs `write(event)` callback (most flexible for existing code) vs `EventEmitter`-style subscribe.
- SSE adapter — does it live in `createRouteAdapter` (one adapter, two response modes) or a sibling `createStreamingRouteAdapter`?
- Multi-repo atomicity on finalize — transaction abstraction in repo interfaces vs compensating actions vs accept-the-gap (Firestore reality today).
- Voice-realtime channel — does the WebRTC/OpenAI realtime path fit the same streaming abstraction or is it a separate sub-pattern?
- Auth for long-lived streams — Firebase ID token expiry mid-stream; reconnect, refresh, or cap stream lifetime?

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
- Error surface — today `ApiError` (with `code`/`details`) is thrown from the client; hooks map it to `{ error }` state. Do we standardise an error boundary + toast pattern for failed API calls?
- UI per-code narrowing — once the first real `if (err.code === 'X')` switch appears in UI, revisit ADR-0005 §2 "future-idea" note: reconstruct the matching server-side `HandlerError` subclass on the client from envelope `code` via a small map and surface it as a field on `ApiError`, so UI can do `if (clientErr.handlerError instanceof PreconditionFailedError)` with full TS narrowing. Out of scope until a concrete use-case lands.

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

### Run executor durability — BullMQ-based queue (deferred during Phase 3 grilling, 2026-05-26)

**Current state.** `/api/processes/:instanceId/run` is a 600-LOC inline Next.js route running the auto-runner loop in `after()`. Eight call sites self-fetch this URL after state-changing mutations to wake the executor. In-memory `runLocks: Set<string>` per process provides at-most-once execution per instance. Pattern works on a single-worker VPS deployment (today's prod + staging).

**Workarounds it accumulates.**
- `runLocks` per-process only — multi-worker = parallel loops (race). Comment in source acknowledges and points to "Firestore transaction or Redis" as the proper fix.
- `after()` dies with worker — crash mid-loop leaves instance "running" with nobody executing. Cron-heartbeat is the de facto recovery (next 15-min beat re-detects + re-kicks).
- No retry / DLQ / observability — `fetch().catch(() => {})` swallows failures.
- `isStuckLoop` / `MAX_SAME_STEP_ITERATIONS` — workaround for the lack of idempotent dispatch; a real queue provides iteration tracking for free.
- Boundary violation — every kicker has to know `getAppBaseUrl()` + `PLATFORM_API_KEY`. Phase 3 hides this behind `scope.system.runKicker` but the workaround stays under the abstraction.

**Why deferred from Phase 3.** Headless-migration goal is API surface (typed contract, framework-free handlers). Run executor durability is a different concern (runtime/ops/durability). Fixing it during Phase 3 would:
- Force a "Redis required for dev default" decision mid-migration.
- Mix architectural changes (queue migration, executor relocation outside `after()`) with mechanical changes (handler shape migration). Different reviewers, different risk profiles.
- Block all reclassified mutation migrations on a much larger design.

**Likely future shape (sketched, not committed).** Mediforce already runs BullMQ in prod + staging via `@mediforce/container-worker` (today: Docker container job dispatch only, gated by `REDIS_URL`). The future ADR extends this:
- New queue `mediforce-instance-runs` with payload `{ instanceId, triggeredBy }`. Fire-and-forget (no `waitUntilFinished` — unlike today's Docker queue which is sync RPC).
- Producer = `scope.system.runKicker.kick()` swaps impl from `httpSelfFetchRunKicker` to `queueRunKicker`. Handlers untouched.
- Consumer = `container-worker` (or sibling worker process) runs the auto-runner loop. Relocates `executeAgentStep` + dependencies outside the Next.js context. Crash → BullMQ retries. Distributed lock = BullMQ consumer group.
- `/api/processes/:instanceId/run` either becomes a thin enqueue wrapper or is deleted entirely.

**Open questions for the ADR (not pre-decided here).**
- Sync RPC `waitUntilFinished` (today's Docker queue) vs fire-and-forget (right for the kick). Different semantics, may need different queue config.
- Default `pnpm dev` — keep Redis opt-in (status quo) and ship a fallback in-process kicker, or make Redis a hard dev dependency? Affects developer onboarding friction.
- Multi-tenant scale-out — does one worker process suffice, or do we need consumer-group scaling matched to instance throughput?
- Cron-heartbeat — does it stay as Next.js HTTP route triggered externally, or become a BullMQ `repeat` job?
- BullMQ vs Temporal — Temporal evaluated separately (see Temporal-migration research spawn 2026-05-26). Going with BullMQ for this ADR unless the Temporal research concludes otherwise.

**Action.** Dedicated ADR drafted post-Phase 3, after the `runKicker` abstraction has shipped and proven the swap-impl-only migration path. Grill session spawned 2026-05-26.

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
