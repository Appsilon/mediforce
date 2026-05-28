# 0006 — Client-side server-state management

- **Status:** Accepted (mutable while implementation in progress per the
  status policy in [`README.md`](./README.md); flips to `Finalized` when
  Phase 4 of the headless migration completes)
- **Date:** 2026-05-28
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Relates to:**
  - Lands together with [`docs/headless-migration-phase-4-plan.md`](../headless-migration-phase-4-plan.md)
    (Phase 4 of the headless migration).
  - Complements [`ADR-0001`](./0001-firestore-to-postgres.md) — this ADR
    is the browser-side counterpart of ADR-0001's "realtime swap"
    (§5, amended 2026-05-28).
  - Builds on [`ADR-0005`](./0005-headless-platform-api-ui-separation.md) — consumes the entity-echo
    response shape (§5) directly via `setQueryData`.
  - Forward-compat with deferred SSE work
    ([#516](https://github.com/Appsilon/mediforce/issues/516)) and a
    future per-resource event-stream consolidation ADR.

## Context

[ADR-0004](./0004-scoped-data-access-authorization.md) put workspace
authorization in a `CallerScope` data-access bag. [ADR-0005](./0005-headless-platform-api-ui-separation.md) locked
the HTTP boundary contract (handler shape, error envelope, entity
echo). Together they shape the **server side** of the headless
platform.

The headless migration's Phase 4
([`docs/headless-migration-phase-4-plan.md`](../headless-migration-phase-4-plan.md)) is the **browser
side** of the same architecture: every UI consumer stops importing
`firebase/firestore` and reads / writes through the typed
`mediforce.X.Y()` client. To do that without losing the live-update
behaviour Firestore `onSnapshot` provided, the browser needs a
**client-side cache** with polling, dedup, cancellation, mutation
lifecycle, and (eventually) SSE hooks.

`platform-ui` today has **no cache library**. The single data-fetching
hook (`useInstanceTasks`) is `useState + useEffect + AbortController`
hand-rolled. Phase 4 migrates ~20 hooks; rolling each on the same
pattern duplicates the seams across the codebase and re-invents the
parts a cache library already solves (dedup across components,
focus-refetch, mutation invalidation, optimistic-update lifecycle).

Domain terms used below — Workspace (Namespace), Workflow Run, Human
Task, Cowork Session, Agent Run — are defined in [`CONTEXT.md`](../../CONTEXT.md).

## Decision

Adopt **`@tanstack/react-query`** as the project-wide client-side
server-state manager. One library, one `QueryClient` per app instance,
one cache-key convention, one mutation lifecycle pattern. The
following commitments form the contract; implementation lands in
Phase 4's six-PR rollout (see Phase 4 PRD).

### 1. Library: `@tanstack/react-query` (v5)

Single dependency added to `packages/platform-ui`. Dev-only
`@tanstack/react-query-devtools` ships behind a `NODE_ENV !== 'production'`
gate.

Rejected: SWR, custom helper. See "Considered alternatives" below.

### 2. Cache key convention

All cache keys are arrays with a string-prefix-first shape:

```
[domain, scopeKey?, ...filters]
```

- **`domain`** — kebab-case noun matching the resource family.
  Examples: `'tasks'`, `'runs'`, `'workflows'`, `'agent-runs'`,
  `'cowork'`, `'audit'`, `'namespace'`, `'users'`, `'monitoring'`.
- **`scopeKey`** — the workspace `handle`, the user identifier
  (`'me'`), or an entity id (`runId`, `sessionId`). Determines what
  the rest of the key narrows. Omitted only for truly app-global
  data.
- **`...filters`** — additional structure for sub-resources or query
  filters. Plain values for prefix-matching ergonomics; object
  literal at the tail when the filter set has multiple fields.

Examples:

```ts
['tasks', handle, role, status]
['tasks', handle, { instanceId, stepId }]
['run', runId]
['runs', handle, { status, definitionName }]
['workflows', handle]
['workflow', handle, name]
['agent-runs', handle, { runId, stepId }]
['agent-run', agentRunId]
['cowork', sessionId]
['cowork', sessionId, 'turns']
['audit', runId]
['namespace', handle]
['users', 'me']
['monitoring', handle]
```

Tag-prefix invalidation in react-query catches every variant under a
prefix: `qc.invalidateQueries({ queryKey: ['tasks', handle] })`
refetches all roles, all statuses, all `(instanceId, stepId)` slices.

A central `lib/query-keys.ts` module documents the convention with
typed factory functions per domain. Not strictly enforced — react-query
takes raw arrays — but the factory pattern keeps drift low.

### 3. Default `QueryClient` configuration

```
{
  queries: {
    refetchInterval: 0,           // polling OFF by default; explicit per-hook opt-in
    refetchOnWindowFocus: false,  // most data isn't time-critical
    refetchOnReconnect: true,     // refresh on network recovery
    staleTime: 0,                 // cache served immediately, revalidated in background
    gcTime: 5 * 60 * 1000,        // 5 min cache eviction after no observer
    retry: 2,                     // brief network blip resilience
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
  },
  mutations: {
    retry: 0,                     // mutations are caller-intentional; never auto-retry
  },
}
```

Per-hook overrides are explicit at the call site. Terminal-state
gating (e.g. `enabled: run.status !== 'completed' && ...`) keeps
polling from hitting the backend for resources nobody is advancing.

Mediforce single-VPS Postgres math at default-off-polling: a list-view
tab with 3 live hooks × 1 s polling = 3 RPS. 10 concurrent operators ×
3 tabs each = 90 RPS — well under Postgres capacity for
workspace-indexed lookups. The default-off rule prevents drift toward
"every hook polls."

### 4. Polling cadence — four-tier classification

Inherited from Phase 4 PRD; documented here so future hooks have a
default placement:

- **CRITICAL LIVE — 1–2 s** while resource non-terminal; `null` key
  when terminal. Use for: operator-watching-execution surfaces (run
  detail, step detail, agent run detail, task detail page, audit feed
  during a running run, cowork turns during active POST).
- **STANDARD LIVE — 5 s.** Use for: operator worklists (tasks page,
  workspace home, runs list, workflow list).
- **NICE LIVE — 30 s** (and `refetchOnWindowFocus: true` as
  safety net). Use for: dashboards (monitoring summary).
- **ONE-SHOT — `refetchInterval: 0`.** Two sub-cases:
  - `refetchOnWindowFocus: true` for data that **may change** under
    deliberate user action (workspace metadata, workflow definitions).
  - `refetchOnWindowFocus: false` for data that **should not silently
    change mid-session** (user role, membership). For these, a
    membership / role change is intentionally a backend-403 canary,
    not a silent UI mutation.

### 5. Mutation lifecycle: `useMutation` + entity-echo via `setQueryData`

Every mutation in the app goes through `useMutation`. The lifecycle:

```ts
const claim = useMutation({
  mutationFn: (input) => mediforce.tasks.claim(input),
  onMutate: async (input) => {
    // 1. Cancel in-flight queries for affected keys
    await qc.cancelQueries({ queryKey: ['tasks', handle] });
    await qc.cancelQueries({ queryKey: ['task', input.taskId] });

    // 2. Snapshot for rollback
    const snapshot = {
      list: qc.getQueryData(['tasks', handle, role, 'pending']),
      detail: qc.getQueryData(['task', input.taskId]),
    };

    // 3. Optimistic patch
    qc.setQueryData(['task', input.taskId], (old) =>
      old ? { ...old, status: 'claimed', assignedUserId: caller.uid } : old);
    qc.setQueryData(['tasks', handle, role, 'pending'], (old) =>
      old?.filter((t) => t.id !== input.taskId));

    return { snapshot };
  },
  onSuccess: (data) => {
    // 4. Replace with server-echoed entity (ADR-0005 §5)
    qc.setQueryData(['task', data.task.id], data.task);
  },
  onError: (_err, _input, ctx) => {
    // 5. Restore snapshot on failure
    if (ctx?.snapshot.list) qc.setQueryData(['tasks', handle, role, 'pending'], ctx.snapshot.list);
    if (ctx?.snapshot.detail) qc.setQueryData(['task', input.taskId], ctx.snapshot.detail);
  },
});
```

The entity-echo response shape locked in [ADR-0005 §5](./0005-headless-platform-api-ui-separation.md)
(`{ task: HumanTask }`, `{ run: WorkflowRun }`, etc.) is the natural
input to `setQueryData` in `onSuccess`. No refetch round trip; UI
updates instantly with server-truth post-mutation state.

### 6. Optimistic update playbook — three templates

Documented here for one-place reference; PRs adopting react-query
copy-paste from these:

- **State transition** (`claim`, `cancel`, `complete`, `resume`,
  …): one entity flips status. Optimistic patch on detail key + filter
  on relevant list keys. `onSuccess` replaces detail key with
  entity-echo; `onError` restores snapshot.
- **List-affecting create / delete** (`namespaces.create`, future
  `workflows.delete`): optimistic prepend / filter on the relevant
  list key. `onSuccess` for create: replace optimistic placeholder
  with entity-echoed full entity; for delete: keep filter, no
  replacement. Side-effect (redirect, focus) in `onSuccess` callback.
- **Multi-cache-key cross-cutting** (`runs.bulkCancel` affecting many
  runs + monitoring summary + audit feed): tag-prefix
  `invalidateQueries({ queryKey: ['runs', handle] })` after success.
  Optimistic update optional per call — bulk operations typically
  skip optimistic and refetch.

### 7. SSE forward-compat slot

This ADR does **not** add SSE in Phase 4 (per [`ADR-0001`](./0001-firestore-to-postgres.md) §5
amendment, 2026-05-28). When SSE arrives (per resource — see future
per-resource event-stream consolidation ADR, captured-for-later in
[`docs/headless-migration.md`](../headless-migration.md)), each SSE
hook plugs into the existing cache via `setQueryData`:

```ts
function useRunStream(runId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const abort = new AbortController();
    // fetch + ReadableStream (EventSource lacks custom headers)
    pipeSseFrames(`/api/runs/${runId}/stream`, abort.signal, (event, data) => {
      if (event === 'step_changed')   qc.setQueryData(['run', runId, 'steps'], merge(data));
      if (event === 'task_created')   qc.setQueryData(['tasks', handle, role], prepend(data.task));
      if (event === 'instance_finished') qc.setQueryData(['run', runId], (old) => ({ ...old, status: data.status }));
    });
    return () => abort.abort();
  }, [runId, qc]);
}
```

Components keep reading via `useQuery(['run', runId])`. The transport
(polling vs SSE) becomes a detail of which hook is mounted on the
page. Zero rework on consumer code when SSE lands.

### 8. Error handling

Every mutation / query that fails throws a typed
`ApiError` (from `@mediforce/platform-api/client`) carrying HTTP
`status` + parsed `code` (per [ADR-0005 §1](./0005-headless-platform-api-ui-separation.md) error envelope) +
optional `details`. UI handles in two layers:

- **Catch in `onError` callback** at the call site for inline UX
  (toast, inline error panel).
- **Global error boundary** at the layout level for unhandled errors
  (network down, 500 from backend, browser offline).

Per-code narrowing (`if (err.code === 'precondition_failed')`) is
allowed inline today; if it becomes a frequent pattern, revisit the
"future-idea" note in [ADR-0005 §2](./0005-headless-platform-api-ui-separation.md) about reconstructing
the matching `HandlerError` subclass on the client.

`useSuspenseQuery` (react-query's Suspense-integrated variant)
remains an opt-in per hook; nothing in this ADR commits the app to
Suspense as the default loading-state mechanism. The two co-exist
fine.

## Considered alternatives

- **SWR (vercel/swr).** Rejected. SWR covers polling + dedup + focus-refetch
  out of the box and is smaller (~5 KB gz vs ~13 KB gz). Loses
  precisely where Phase 4 cares most: (a) no tag-prefix invalidation
  primitive — every invalidation needs an exact key or a match
  function, and the mutator must know the consuming hook's key shape;
  (b) `useSWRMutation` is auxiliary and less ergonomic than
  react-query's `useMutation`, so optimistic-update lifecycle becomes
  hand-rolled per call site; (c) no first-class devtools at our scale
  (~30 hooks at end of Phase 4 + projected growth). The 8 KB delta is
  noise against the existing browser bundle. Honest trade-off: SWR is
  fine for 5–10 hooks; Phase 4 ships ~20 at once and Mediforce grows
  past that.
- **Custom helper extended from `useInstanceTasks`.** Rejected.
  Re-implementing dedup, focus-refetch, cancellation, mutation
  lifecycle, optimistic snapshot/rollback, devtools — the project would
  spend the next year shipping a worse-tested replica of react-query.
  Reasonable only if hook count stays under ~5; Phase 4 contradicts
  that.
- **Apollo Client.** Rejected. Apollo is GraphQL-shaped; Mediforce ships
  a Zod-typed REST contract. The GraphQL machinery (link chain, schema
  registry, query AST) is dead weight against an RPC-shaped API.
- **RTK Query (Redux Toolkit).** Rejected. Mediforce has no Redux store
  and no reason to add one; RTK Query couples cache lifecycle to a
  Redux reducer tree without a payoff over react-query's standalone
  cache.
- **Vercel AI SDK for the cache layer.** Considered as a way to reuse
  the AI SDK's streaming patterns if SSE comes later. Rejected — the
  AI SDK is a wrapper around react-query for AI-specific streaming
  primitives; we get the same forward-compat by using react-query
  directly today and adopting the AI SDK pattern only if and when a
  streaming-AI surface appears.

## Consequences

- One library, one mental model. New UI hooks follow the documented
  key convention + cadence tier + mutation lifecycle without
  architectural debate.
- Phase 4 PR1 establishes the foundation (QueryClient provider,
  defaults, devtools, key factory module). PRs 2–6 reuse it
  mechanically; cross-PR architectural drift is minimised.
- Entity-echo from [ADR-0005 §5](./0005-headless-platform-api-ui-separation.md) is naturally consumed —
  every mutation handler's return shape lands in the cache without a
  refetch.
- Tag-prefix invalidation covers Mediforce's existing cross-cutting
  mutation surface (bulk cancel / archive on runs, workflow
  archive cascading to runs + human tasks, cross-namespace workflow
  transfer) without ad-hoc key matchers per call site.
- Optimistic updates become a documented, three-template pattern.
  Operator-perceived latency on every mutation drops to "local state
  change instant" without per-component custom code.
- Devtools available in dev — debugging "why is this list stale" is a
  visible tree of active queries + cache contents, not a console.log
  archaeology session.
- Bundle size delta vs no cache library: ~13 KB gz for react-query +
  some dev-only weight for devtools. Acceptable against current
  browser bundle (~800 KB gz Next.js + Tailwind + Radix + Monaco).
- Future SSE migration is a `useResourceStream(id)` hook per resource
  that pipes events into `setQueryData(...)`. Consumer code (`useQuery`,
  `useMutation`) is untouched. The per-resource event-stream
  consolidation ADR (captured-for-later) builds on this shape.

## Out of scope

- **SSE design.** Not part of Phase 4 (per ADR-0001 §5, amended
  2026-05-28). Future per-resource consolidation ADR + [#516](https://github.com/Appsilon/mediforce/issues/516)
  cover it.
- **`useSuspenseQuery` as default.** Suspense + react-query is
  ergonomic but requires Suspense / ErrorBoundary placement
  decisions that are an orthogonal UI concern. Opt-in per hook;
  default stays branchy `{ data, isLoading, error }`.
- **Server-side cache** (Next.js `cache()`, `unstable_cache`, route-
  level revalidation). Server-rendered pages today fetch through the
  Next.js mechanisms; react-query is for client-rendered hooks. The
  two coexist without coupling.
- **Persistent cache across reloads** (`@tanstack/query-async-storage-persister`).
  Premature — Mediforce sessions are short-lived, browser cache +
  fresh fetch on load is fine. Add when a real use case (offline
  reads, fast restore on slow connection) appears.
- **Query-key codegen from API contract.** Would be elegant —
  `mediforce.tasks.list` could produce its own cache key — but
  premature. The hand-written key factory in `lib/query-keys.ts` is
  ~50 LOC and explicit; codegen-ing it adds machinery for low payoff.
- **Optimistic updates on every mutation.** PR1 (tasks) wires it for
  the state-transition templates. PRs 2–6 wire it where the UX
  payoff is clear; mutations with no visible immediate result (e.g.
  `runs.archive` for an already-completed run) skip the optimistic
  step and just invalidate.

## Open questions

(None blocking Phase 4. Section reserved for amendments while the
ADR is `Accepted`.)
