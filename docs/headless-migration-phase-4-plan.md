# Headless migration — Phase 4 plan

- **Status:** Finalized (PR-final merged; PG PR2 [#534](https://github.com/Appsilon/mediforce/pull/534) unblocked)
- **Date opened:** 2026-05-28
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** Filip Stachura (@filipstachura), Paweł Przytuła (@przytu1)
- **Tracks:** Phase 4 of [`docs/headless-migration.md`](./headless-migration.md)
- **Relates to:**
  - Gate for [`ADR-0001`](./adr/0001-firestore-to-postgres.md) cutover
    (PG PR2 [#534](https://github.com/Appsilon/mediforce/pull/534)).
  - Builds on [`ADR-0004`](./adr/0004-scoped-data-access-authorization.md)
    `CallerScope` + [`ADR-0005`](./adr/0005-headless-platform-api-ui-separation.md)
    handler shape + entity-echo.
  - Bundles ADR-0001 §5 amendment in the same PR as this plan.
  - References new [`ADR-0006`](./adr/0006-client-side-server-state.md)
    client-side cache architecture (created in same PR).
  - Forward-compat with deferred SSE work
    ([#516](https://github.com/Appsilon/mediforce/issues/516)) and
    URL canonicalization ([#544](https://github.com/Appsilon/mediforce/issues/544)).

## Problem statement

Operator on Mediforce today sees workflow runs, tasks, agent runs, audit
events and cowork chat **update live** in the UI because every list and
detail view subscribes to Firestore via `onSnapshot`. [ADR-0001](./adr/0001-firestore-to-postgres.md)
moves the server data layer to Postgres. Postgres has no `onSnapshot`
equivalent. After the server-side cutover (PG PR2 / [#534](https://github.com/Appsilon/mediforce/pull/534))
ships, every operator UI view stops updating — empty lists, stale
detail pages, no progress indication during agent runs. Production is
unusable.

PG PR2 description names this PRD as its explicit gate: it cannot merge
until UI stops importing `firebase/firestore`.

## Solution

Remove every `firebase/firestore` import from `packages/platform-ui/src`.
Replace each consumer with:

- A typed `mediforce.X.Y()` call from the platform-api client (Phase 1/2/3 endpoints already exist for most reads/writes).
- A new **react-query** cache layer (`@tanstack/react-query`) providing polling, dedup, mutation lifecycle, optimistic updates, and forward-compat for future SSE — see [ADR-0006](./adr/0006-client-side-server-state.md).
- Six new headless endpoints filling the remaining gaps (see §"Endpoint inventory").

Phase 4 is a **behavioural no-op** as a standalone change: the server still
runs on Firestore, the UI just reaches it through the headless contract
rather than the Firestore SDK. Once Phase 4 ships, PG PR2 unblocks; UI
keeps working when the server flips to Postgres because the contract is
stable.

Phase 4 is a **swap, not a redesign**. UX may lose smoothness where today's
flow relied on incidental Firestore push (tool-call bubble animation in
cowork chat, sub-second task appearance). That regression is accepted;
UX overhauls live in dedicated tickets ([#516](https://github.com/Appsilon/mediforce/issues/516)
for streaming cowork; per-resource SSE consolidation as a future ADR).

## User stories

1. As an operator, I want the task list to refresh within a few seconds of an agent producing a new task, so that I do not need to manually reload the page.
2. As an operator, I want the run detail page to show step transitions within 1–2 seconds, so that I can monitor live execution.
3. As an operator, I want my cowork chat to show my message immediately after I press Send, so that the UI feels responsive even when the backend is computing for several seconds.
4. As an operator, I want tool-call bubbles to appear progressively during a cowork chat turn, so that I can see what the agent is doing.
5. As an operator, I want the workspace switcher in the sidebar to populate without an extra round trip per page navigation, so that the app feels fast.
6. As an operator, I want role-gated buttons (admin actions) to render reliably on the first paint, so that I do not accidentally see UI before the backend says I can use it.
7. As an operator, I want a workspace I just created to appear in my switcher immediately and redirect me to it, so that the create flow feels finished.
8. As an operator, I want claiming a task to update the list view instantly, so that I do not click Claim twice or doubt whether the click worked.
9. As an operator, I want the monitoring dashboard to load with summary numbers, not 10 MB of raw data, so that the page renders in milliseconds even on a slow connection.
10. As an operator with permission to invite members, I want the members list on the settings page to reflect a new invite within a few seconds, so that I can verify the invite landed.
11. As a developer, I want every UI read and write to flow through a typed client method (`mediforce.X.Y()`), so that contract drift between UI and API is impossible.
12. As a developer, I want a single cache library convention for the whole app, so that I do not have to learn three different data-fetching styles across files.
13. As a developer, I want mutation responses to update the cache without a refetch round trip, so that the UI feels instant after a click.
14. As a developer, I want a clear set of cache keys per domain, so that I know exactly which `invalidateQueries(...)` to call after a mutation.
15. As a developer, I want optimistic updates wired through a documented pattern, so that I do not invent a new state-machine on every mutation site.
16. As a developer, I want each PR in Phase 4 to land independently green, so that review can be parallel where possible and pause-safe where not.
17. As an AFK Claude session implementing one PR, I want the plan to tell me exactly which hooks to migrate, which endpoint they map to, what polling interval to use, and which test layers to write, so that I do not need to re-grill the design from scratch.
18. As a future implementer, I want the eventual SSE migration to be a small change to react-query consumers, not a rewrite, so that today's cache structure carries forward.
19. As a compliance reviewer, I want audit emission to remain bit-for-bit identical to today's behavior, so that audit logs do not regress during the swap.
20. As an SRE, I want the new endpoints to use server-side aggregation where possible, so that Postgres queries scale rather than copying the Firestore "load everything and aggregate in browser" anti-pattern.
21. As the implementer of PG PR2, I want this plan to be the explicit gate — once it ships, the server cutover script can run, then PG PR2 merges with no UI fallout.
22. As an authenticated user signing in for the first time on a Deployment, I want my personal workspace to be created automatically so that I land on a usable workspace home page.
23. As a UI engineer adding a future hook, I want a documented key convention (`['domain', handle, ...filters]`), default config table, and optimistic playbook so that the hook fits in without architectural debate.
24. As a developer reading the codebase six months from now, I want the headless-migration plan to refer me to ADR-0006 for the "why react-query, not SWR" rationale, so that I do not waste time re-deciding.

## Implementation decisions

### 1. Cache library: `@tanstack/react-query`

Picked over SWR and a custom helper. Full rationale in [`ADR-0006`](./adr/0006-client-side-server-state.md).
Phase 4 PRD references the ADR; do not duplicate the alternatives discussion here.

Key implications for Phase 4 work:

- Hook tests use the existing `useInstanceTasks` test pattern, wrapped in
  a fresh `QueryClient` per test.
- A single `QueryClient` is constructed at app boot with project-wide
  defaults; per-hook overrides are explicit at call sites (polling
  interval, terminal-state gating).
- Cache key convention: `[domain, handle?, ...filters]` (string-prefix
  array). Examples: `['tasks', handle, role]`, `['run', runId]`,
  `['agent-runs', handle, { runId, stepId }]`, `['users', 'me']`.
- Devtools (`@tanstack/react-query-devtools`) ship behind a dev-only
  bundle gate.

### 2. ADR amendments bundled in the same PR

This PR also lands:

- **[`ADR-0001`](./adr/0001-firestore-to-postgres.md) §5 amendment.** Drop "Live agent run logs and cowork
  text chat move to Server-Sent Events." Replace with "All `onSnapshot`
  listeners are removed. Everything moves to SWR / react-query polling
  (1–10 s, terminal-state gating). No SSE, no WebSockets at cutover.
  SSE remains a forward option for surfaces where polling lag proves
  visible (live token-stream during agent runs, multi-second cowork
  tool loops); tracked by [#516](https://github.com/Appsilon/mediforce/issues/516)
  and a future ADR."
- **ADR-0001 Consequences line** "~14 UI hook sites + 3 page-component
  sites are rewired from `onSnapshot` to SWR / SSE" → drop "/ SSE".
- **[`docs/headless-migration.md`](./headless-migration.md) Phase 4 section** rewritten to reflect this PRD
  as the authoritative plan; the old "working hypothesis" tone goes
  away.

ADR-0001 is `Proposed`; amendment lands in the bundled PR per the
status policy. ADR-0004 (`Finalized`) is unchanged. ADR-0005
(`Accepted`) is unchanged.

### 3. Endpoint inventory — six additions + two contract extensions

After auditing each of the 22 firestore-importing files, six new
headless endpoints cover the gaps. Two existing contracts get small
backwards-compatible additive extensions. Three previously
hypothesized endpoints (`/api/audit-events`, `/api/namespaces/:handle/role`,
explicit `POST /api/users/me/ensure-personal-namespace`) are NOT
needed — see notes below.

#### `GET /api/users/me` — bundle with lazy bootstrap side-effect

```ts
export const GetMeOutputSchema = z.object({
  user: z.object({
    uid: z.string(),
    email: z.string().email().nullable(),
    displayName: z.string().nullable(),
    // Mediforce-side user_profiles fields only; NextAuth columns out of scope here.
  }),
  namespaces: z.array(z.object({
    handle: HandleSchema,
    type: z.enum(['personal', 'organization']),
    displayName: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
  })),
});
```

- Light projection (~1 KB). Powers sidebar switcher, page-gate role
  checks (`useNamespaceRole(handle)` becomes a pure selector over this
  cache), workspace header.
- **Lazy bootstrap side-effect:** if the caller has no personal
  namespace, the handler creates one inline (idempotent) before
  returning, emitting `user.personal_namespace_created` audit event
  exactly once.
- Replaces direct Firestore reads in: `auth-context.tsx`,
  `use-all-user-namespaces.ts`, `use-namespace-role.ts`, plus
  `use-user-namespace.ts` (folded as a selector).
- **TODO at ADR-0002 (NextAuth) landing:** move the bootstrap to
  `events.createUser`; GET /me becomes a pure read (or a defensive
  safety net — decision deferred to ADR-0002).

The lazy-upsert pattern is reusable: future user-profile field
defaults, settings migrations, or role-cache rebuilds can hang off the
same "first call resolves missing state" hook.

#### `GET /api/namespaces/:handle` — workspace detail

```ts
export const GetNamespaceOutputSchema = z.object({
  namespace: NamespaceSchema, // existing full schema
  members: z.array(NamespaceMemberSchema),
  // Settings-specific projections (e.g. secrets count, workflow count)
  // may be added additively when the settings page consumes them.
});
```

- Loaded only on settings / workspace-detail pages. Cache key
  `['namespace', handle]`.
- Replaces direct Firestore reads in `use-namespace.ts`,
  `[handle]/settings/page.tsx` (the remaining `onSnapshot` on
  `namespaces/{handle}/members` after Phase 2.6 already migrated the
  invite/member endpoints).

#### `POST /api/namespaces` — workspace create (organization)

```ts
export const CreateNamespaceInputSchema = z.object({
  handle: HandleSchema,
  displayName: z.string().min(1).max(128),
  bio: z.string().max(2048).optional(),
  // type omitted; this endpoint always creates 'organization'.
  // Personal namespaces are auto-bootstrapped via GET /api/users/me.
});

export const CreateNamespaceOutputSchema = z.object({
  namespace: NamespaceSchema,
});
```

- **Gate:** any authenticated user, preserving status quo. Gate
  policy out of scope for Phase 4; revisit when spam / multi-tenancy
  concerns arise.
- **Atomicity:** repo gets a new consolidated method
  `createNamespaceWithOwner({ namespace, ownerMember })`. Firestore
  impl uses a `WriteBatch` (atomic across docs in same Firestore).
  Postgres impl (ADR-0001 era) uses a transaction. Handler stays
  clean — one wrapper call.
- **Errors:** 409 conflict on duplicate handle (Firestore: existence
  check + race window; Postgres: unique constraint).
- **`users/{uid}.organizations` field:** PRD action item — verify
  this field is dead (Phase 2.6's `getMembershipsForUser` reads the
  member subcollection; if the array is truly unused, drop the third
  write entirely. Reduces atomicity surface and eliminates one
  Firestore consumer in `auth-context.tsx`.).
- **Audit:** `namespace.created` emitted via handler-bridge per
  [ADR-0005 §7](./adr/0005-headless-platform-api-ui-separation.md).
- Replaces direct Firestore writes in
  `app/(app)/workspaces/new/page.tsx`.

#### `GET /api/agent-runs` — paginated list with filters

```ts
export const ListAgentRunsInputSchema = z.object({
  namespace: z.string().optional(),
  runId: z.string().optional(),
  stepId: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
}).refine(
  (v) => !v.stepId || v.runId,
  'stepId requires runId',
);

export const ListAgentRunsOutputSchema = z.object({
  runs: z.array(AgentRunSchema),
  nextCursor: z.string().optional(),
});
```

- Single endpoint with filter params (not nested URL) — consistent
  with `/api/runs?status=...` / `/api/tasks?role=...`.
- Pagination: opaque cursor, default 50 / cap 200. Backend encodes
  `{startedAt, id}` tie-breaker; client treats as token. Forward-compat
  across Firestore→Postgres cursor mechanics.
- **Repo addition:** `AgentRunRepository.listInNamespaces(allowed, { limit, cursor, runId?, stepId? })`.
  Firestore impl: composite query with cursor `startAfter`. Postgres:
  `WHERE (started_at, id) < ($cursor) AND ($namespace = ANY(allowed)) ORDER BY ... DESC LIMIT N`.
- Wrapper passthrough via `AuthorizedAgentRunRepository`.
- Replaces direct Firestore reads in `use-agent-runs.ts`.

#### `GET /api/agent-runs/:agentRunId` — single detail

- Trivial read per [ADR-0004 §10](./adr/0004-scoped-data-access-authorization.md) — no
  bespoke handler; the route wires `getByIdAdapter` against
  `AuthorizedAgentRunRepository.getById`.
- Output: `{ run: AgentRun }`.
- Replaces single-agent-run reads on `agents/[runId]/page.tsx`.

#### `GET /api/namespaces/:handle/monitoring/summary` — dashboard aggregates

```ts
export const MonitoringSummarySchema = z.object({
  runs: z.object({
    running: z.number().int().nonnegative(),
    completed_24h: z.number().int().nonnegative(),
    failed_24h: z.number().int().nonnegative(),
    archived_total: z.number().int().nonnegative(),
  }),
  tasks: z.object({
    pending: z.number().int().nonnegative(),
    claimed: z.number().int().nonnegative(),
    stuck_count: z.number().int().nonnegative(), // claimed > 24h ago
  }),
  roleTaskCounts: z.record(z.string(), z.number().int().nonnegative()),
});
```

- Compact (~200 B) response. Server-side aggregation, not a list
  payload. Polling at 30 s costs nothing.
- Backend handler: 2–3 `SELECT … COUNT(*) GROUP BY …` queries with
  workspace-scoped partial indexes (Postgres era) or in-memory tally
  per scope (Firestore era).
- Closed shape, extensible additively (add `agent_runs_active`,
  `cron_triggers_due` in follow-ups without breaking change).
- Replaces direct Firestore reads + in-browser aggregation in
  `use-monitoring.ts`.
- **PR3 follow-up (carried from PR2 self-review #4):** the PR2 handler
  loads `scope.runs.list({})` and filters by `r.namespace === handle`
  in-app. PR3 owns the processes domain — please extend
  `ListInstancesOptions` with `namespace?: string`, push the filter
  into `ProcessInstanceRepository.listAll` /
  `listInNamespaces` (and the wrapper), and update the monitoring
  handler to pass `{ namespace: handle }` so the dashboard endpoint
  stops over-fetching for system actors. Same cost optimisation matters
  twice as much on Postgres — system actor today hits an unfiltered
  scan.

#### Extension: `ListTasksInputSchema` gains optional `instanceId` + `stepId`

```ts
// Add to existing schema (additive, backwards-compatible).
instanceId: z.string().optional(),
stepId: z.string().optional(),
// Refine: stepId requires instanceId.
```

Folds the two `use-collection.ts` consumers (`next-step-card.tsx`,
`task-detail.tsx`) into the existing `mediforce.tasks.list({...})`
call. Handler gains a new filter branch; repo method extended.

Phase 1 lessons (issue #231) flagged this trivial change.

#### Extension: chat handler return shape gains `session` + `turns`

Today the cowork chat endpoint (`POST /api/cowork/:sessionId/chat`,
shipped in Phase 3.1) returns `{ agentText, artifact, toolCalls }`.
Phase 4 extends additively to include the post-mutation session +
full turns array:

```ts
export const ChatCoworkSessionOutputSchema = z.object({
  // existing fields stay
  agentText: z.string(),
  artifact: ArtifactSchema.nullable(),
  toolCalls: z.array(ToolCallSummarySchema),
  // new — additive, backwards-compatible
  session: CoworkSessionSchema,
  turns: z.array(ConversationTurnSchema),
});
```

Backwards-compatible — existing callers ignoring the new fields keep
working. Enables UI optimistic-then-final-replace pattern without an
extra round trip.

#### Endpoints explicitly NOT added

- **`GET /api/audit-events`** — `use-audit-events.ts`'s only consumer is
  a per-run audit view, already covered by `GET /api/processes/:instanceId/audit`
  (Phase 1 paginated). No cross-run admin audit view exists today;
  add only when one does.
- **`GET /api/namespaces/:handle/role`** — folded into `users/me.namespaces[].role`.
  Single source of truth for the role cache; `useNamespaceRole(handle)`
  is a selector over the bundle, not a dedicated endpoint.
- **`POST /api/users/me/ensure-personal-namespace`** — folded into the
  lazy bootstrap side-effect of `GET /api/users/me`. One less endpoint
  in the inventory; one less round trip on login.

### 4. Per-consumer migration table

Twenty-two `firebase/firestore`-importing files (audited 2026-05-28).
Each row records the migration target, polling cadence, cache key
shape, and invalidation triggers. Four-tier classification from
[`docs/headless-migration.md` § Phase 4](./headless-migration.md)
(CRITICAL LIVE / STANDARD LIVE / NICE LIVE / ONE-SHOT) — verified
per call site, not per hook name (the "live-by-default fallacy" rule
in [`docs/headless-migration.md`](./headless-migration.md)).

#### Hooks (12)

| File | Tier | Endpoint | Polling | Cache key | Invalidation on |
|---|---|---|---|---|---|
| `hooks/use-tasks.ts` | STANDARD LIVE | `mediforce.tasks.list({role, status})` | 5 s | `['tasks', handle, role, status]` | `tasks.claim`, `tasks.complete`, `tasks.unclaim` (if returns), cowork finalize |
| `hooks/use-process-instances.ts` | STANDARD LIVE (list) / CRITICAL LIVE (single, gated on terminal) | `mediforce.runs.list` / `mediforce.runs.get` | 5 s list / 1–2 s single while non-terminal, `null` when terminal | `['runs', handle, filters]` / `['run', runId]` | `runs.cancel`, `runs.archive`, `runs.start`, `runs.bulkCancel`, `runs.bulkArchive` |
| `hooks/use-agent-runs.ts` | STANDARD LIVE | `mediforce.agentRuns.list` (new) | 5 s, paginated | `['agent-runs', handle, filters]` | None today (agent runs are append-only from system actor) |
| `hooks/use-audit-events.ts` | CRITICAL LIVE | `mediforce.processes.audit(instanceId)` (existing) | 1–2 s while run non-terminal, `null` when terminal | `['audit', runId]` | None — append-only |
| `hooks/use-process-definitions.ts` | ONE-SHOT | `mediforce.workflows.list({namespace})` | 0 (focus-refetch on definition mutations) | `['workflows', handle]` | `workflows.register`, `workflows.delete`, `workflows.archive`, `workflows.transfer`, `workflows.copy` |
| `hooks/use-workflow-definitions.ts` | ONE-SHOT | `mediforce.workflows.get(name)` | 0 (focus-refetch on definition edits) | `['workflow', handle, name]` | Same as above |
| `hooks/use-monitoring.ts` | NICE LIVE | `mediforce.monitoring.summary(handle)` (new) | 30 s, focus-refetch on | `['monitoring', handle]` | Any list-mutation (refresh on next tick is fine; no explicit invalidate) |
| `hooks/use-collection.ts` | **DELETE** | n/a (consumers absorb specific endpoints) | n/a | n/a | n/a |
| `hooks/use-namespace.ts` | ONE-SHOT | `mediforce.namespaces.get(handle)` (new) | 0, focus-refetch on | `['namespace', handle]` | Settings save (`mediforce.namespaces.update(handle, ...)` — not in Phase 4 scope; preserve today's update path if separate) |
| `hooks/use-namespace-role.ts` | ONE-SHOT | **Selector** over `useUserMe()`'s `namespaces[].role` for `handle` | n/a (no own fetch) | derived from `['users', 'me']` | When `['users', 'me']` invalidates (membership change) |
| `hooks/use-all-user-namespaces.ts` | ONE-SHOT | **Selector** over `useUserMe()`'s `namespaces[]` | n/a (no own fetch) | derived from `['users', 'me']` | Same |
| `hooks/use-user-namespace.ts` | **DELETE** | **Selector** `useUserMe().namespaces.find(n => n.type === 'personal')` | n/a | derived | n/a |

#### Pages (5)

| File | Tier | Endpoint(s) | Polling | Notes |
|---|---|---|---|---|
| `app/(app)/[handle]/page.tsx` (workspace home) | STANDARD LIVE | `useProcessInstances`, `useAllUserNamespaces` (selector), `mediforce.users.listMembers` (Phase 2.6 already exists) | 5 s for runs list | Multi-hook page — coordinate PR sequencing (PR3 + PR4 overlap; see PR sizing) |
| `app/(app)/[handle]/settings/page.tsx` | ONE-SHOT | `useNamespace`, `mediforce.users.listMembers` (Phase 2.6), `mediforce.users.invite/resend` (Phase 2.6) | 0 (focus-refetch on) | Drops remaining `onSnapshot` on `namespaces/{handle}/members` subcollection |
| `app/(app)/[handle]/tasks/[taskId]/page.tsx` (task detail) | CRITICAL LIVE | `mediforce.tasks.get(taskId)` | 1–2 s while task non-terminal | Today does `onSnapshot(humanTasks/{taskId})` — replace with `useQuery` gated on task status |
| `app/(app)/[handle]/cowork/[sessionId]/page.tsx` (cowork chat) | CRITICAL LIVE during active POST | `mediforce.cowork.getSession(sessionId)` | 1 s while `useSendMessage.isPending`, 5 s idle | See §"Cowork live-turn strategy" |
| `app/(app)/workspaces/new/page.tsx` | n/a (mutation) | `mediforce.namespaces.create(input)` | n/a | Optimistic prepend to `['users', 'me']`; redirect on success |

#### Components (2)

| File | Tier | Endpoint(s) | Notes |
|---|---|---|---|
| `components/tasks/next-step-card.tsx` | CRITICAL LIVE | `mediforce.tasks.list({instanceId, stepId})` (extended ListTasks filter) + `mediforce.runs.get(instanceId)` + `mediforce.workflows.get(name)` | Replaces `use-collection.ts` + `useSubcollection` patterns; multiple cache keys, single page |
| `components/tasks/task-detail.tsx` | STANDARD LIVE | `mediforce.tasks.list({role, status})` | Replaces `use-collection.ts` consumer; gives "remaining task count" sidebar |

**Note on `chat-cowork-view.tsx`:** the Phase 4 doc previously listed
this as importing `firebase/firestore`. The audit confirms it **does
not**. Data flows via parent page props. No migration needed for this
file; mention only for completeness.

#### Context (1)

| File | Migration |
|---|---|
| `contexts/auth-context.tsx` | Drop all Firestore reads/writes. Replace user-doc fetch + namespaces query + personal-namespace bootstrap (3-write inline) with a single `useUserMe()` (`useQuery(['users', 'me'])`). The lazy bootstrap moves to the GET /me handler's side-effect. Firebase Auth import stays — only `firebase/firestore` goes. |

#### Library (1)

| File | Migration |
|---|---|
| `lib/firebase.ts` | **PR-final.** Delete `getFirestore()` + `connectFirestoreEmulator()`. Leave Firebase Auth init. Uninstall `firebase/firestore` from `platform-ui`'s `package.json` peer deps. |

### 5. Cowork live-turn strategy

The cowork chat flow today: parent page subscribes to `coworkSessions/{sessionId}`
via Firestore `onSnapshot`; user sends message → backend's blocking
POST iterates a tool loop (≤10 iterations), persisting intermediate
turns to the session doc as it goes; Firestore push delivers each
intermediate turn to the parent page, which re-renders the chat view
with progressive tool-call bubbles. Phase 3.1 migrated the POST itself
but left this incidental "Firestore as notification channel" in place.

After Phase 4, no Firestore SDK in the UI. Strategy:

1. **Send mutation** wraps `mediforce.cowork.chat({...})` in
   `useMutation`. `onMutate` cancels in-flight polling on the turns
   cache key, snapshots current cache for rollback, optimistically
   prepends the user's turn + an "agent thinking" placeholder. `onError`
   restores snapshot + toasts. `onSuccess` replaces the cache with
   `data.turns` (the server's final shape, via the additive return shape
   extension above).
2. **Turns query** runs an idle polling loop on
   `['cowork', sessionId, 'turns']` at 5 s. Polling interval flips to
   1 s while `sendMessage.isPending` (using `useMutation`'s `isPending`
   as the gate). After `onSuccess` the polling drops back to 5 s.
3. **Cancellation race protection.** `qc.cancelQueries({ queryKey: ['cowork', sessionId, 'turns'] })`
   in `onMutate` stops the in-flight polling response from overwriting
   the optimistic prepend with stale pre-message data (without this,
   the user's turn would flicker in and out).

UX outcomes vs today:

| Today (Firestore push) | Phase 4 (polling + optimistic) |
|---|---|
| User turn appears instantly (Firestore round trip ~100 ms) | User turn appears instantly (local optimistic prepend) |
| Tool-call bubbles arrive within ~100 ms of server persist | Tool-call bubbles arrive within 1 s of server persist (polling tick) |
| Final agent text on POST resolve | Final agent text instant via `onSuccess` cache replacement |

1-second lag on tool-call bubbles is the explicit regression. Acceptable
per "preserve don't upgrade." If operator feedback shows it's painful, a
focused follow-up adds an SSE stream for cowork turns
([#516](https://github.com/Appsilon/mediforce/issues/516)).

### 6. Optimistic update playbook

Three reusable templates, applied across all mutations Phase 4 touches:

- **State transition** (e.g. `tasks.claim`, `runs.cancel`): single
  entity flips status. Pattern: `onMutate` snapshots cache for the
  specific entity key + any list keys containing it, optimistically
  flips status. `onSuccess` replaces both with the entity-echo from the
  server (`{ task }`, `{ run }` — per [ADR-0005 §5](./adr/0005-headless-platform-api-ui-separation.md)).
  `onError` restores snapshots.
- **List-affecting** (e.g. `namespaces.create`, future `workflows.delete`):
  mutation adds or removes from a list. Pattern: optimistic prepend /
  filter on the relevant list key. `onSuccess` for create: replace
  optimistic with server-echoed entity; for delete: keep filter, no
  replacement needed. Redirect / focus shift in `onSuccess` if the flow
  requires it (e.g. workspace create → navigate to `/${handle}`).
- **Multi-cache-key** (e.g. `runs.bulkCancel` affecting many runs +
  monitoring summary + audit logs): use `qc.invalidateQueries` with a
  prefix key (`['runs', handle]`) — tag-prefix invalidation in
  react-query catches every variant at once. Optimistic update optional
  per call (bulk operations often skip optimistic and refetch instead).

Each template is ~10 LOC; documented in [ADR-0006](./adr/0006-client-side-server-state.md)
with code examples that PR1 will codify into copy-paste references for
PRs 2–6.

### 7. `use-collection.ts` + `use-user-namespace.ts` cleanup

`use-collection.ts` is a generic Firestore subscription wrapper. Two
consumers, both folded into specific endpoints:

- `next-step-card.tsx`: needs tasks for one instance + step. Folds into
  `mediforce.tasks.list({instanceId, stepId})` (contract extension above).
- `task-detail.tsx`: needs remaining tasks for caller's role. Folds
  into existing `mediforce.tasks.list({role, status})`.

After both migrate, delete `use-collection.ts`.

`use-user-namespace.ts` looks dead at first audit but is in fact called
standalone for personal-namespace lookup. After Phase 4 it becomes a
selector over `useUserMe()`:

```ts
function usePersonalNamespace() {
  const { data } = useUserMe();
  return data?.namespaces.find(n => n.type === 'personal');
}
```

Then delete the original `use-user-namespace.ts` file.

### 8. PR sizing — six-PR per-resource tracer

PR1 establishes the pattern end-to-end with the smallest domain (tasks).
PRs 2–5 adopt the pattern per domain (mechanical). PR-final removes
Firestore entirely. Some sequencing required (multi-hook pages create
conflicts):

| PR | Scope | Sequencing |
|---|---|---|
| PR1 — tasks + react-query foundation | All react-query infra (QueryClient provider, defaults, devtools, key convention), tasks-domain hook migrations (`use-tasks` + `use-collection` consumers fold), `claim-button` + `task-detail` + task detail page rewires, `mediforce.tasks.list` extended contract. PRD's first end-to-end proof point. | Standalone — must merge first. |
| PR2 — agent-runs + monitoring | `use-agent-runs` + `use-monitoring` migrations. Adds `/api/agent-runs` (list + single), `/api/namespaces/:handle/monitoring/summary`. Repo additions `AgentRunRepository.listInNamespaces`, monitoring aggregator. | Independent of PR3+; can run parallel. |
| PR3 — processes/runs | `use-process-instances`, `use-audit-events`, `next-step-card` migrations. `process-detail.tsx` + cancel/archive/bulk mutations via `useMutation` + optimistic. | Must sequence with PR4 (shared `[handle]/page.tsx`). |
| PR4 — namespaces + auth + workspaces/new | `GET /api/users/me` (with lazy bootstrap), `GET /api/namespaces/:handle`, `POST /api/namespaces`. `use-namespace`, `use-namespace-role`, `use-all-user-namespaces`, `use-user-namespace` → selectors. `auth-context.tsx` drops Firestore. `workspaces/new/page.tsx` uses `useMutation`. Settings page drops remaining `onSnapshot`. Repo addition `NamespaceRepository.createNamespaceWithOwner`. Schema constants `HandleSchema`. | Must sequence with PR3 (shared `[handle]/page.tsx`). |
| PR5 — cowork | `cowork/[sessionId]/page.tsx` rewire, chat send via `useMutation` + optimistic + isPending-gated polling. Chat handler return shape extended (additive). | Can run parallel with PR3/PR4 once PR1 lands. |
| PR4.5 — firestore residual sweep | Migrates the writes/reads PR4 left behind so PR-final can be a true delete-only diff. Adds `UserProfileRepository` (interface + Firestore impl + in-memory) wired into `CallerScope.userProfiles`; extends `GetMeOutput.user` with `mustChangePassword` (default `false`); adds `POST /api/users/me/clear-must-change-password` and the matching CLI / client method. Adds five settings-page mutations: `PATCH /api/namespaces/:handle` (displayName / bio / icon — owner/admin), `DELETE /api/namespaces/:handle` (owner-only cascade via new `NamespaceRepository.deleteNamespaceCascade`), `POST /api/namespaces/:handle/leave` (owner blocked → `precondition_failed`), `DELETE /api/namespaces/:handle/members/:uid` (atomic via new `removeMemberWithOrganizations`), and `PATCH /api/namespaces/:handle/members/:uid` (owner-only, entity-echo). Rewires `auth-context.tsx`, `settings/page.tsx`, and the namespace/user sections of `app/(app)/[handle]/page.tsx` to consume `useUserMe` + `useNamespace` + the new `use-namespace-mutations` hooks. After PR4.5 merges, only `lib/firebase.ts`'s `db` export and the `firebase/firestore` peer dep remain. | Must sequence after PR4. Independent of PR2/PR3/PR5. Must merge before PR-final. |
| PR-final — flip | Delete `lib/firebase.ts` `getFirestore` + emulator. Uninstall `firebase/firestore` from `platform-ui` peer deps. No remaining migration debt — PR4.5 cleared the last writes. Verify `api-boundaries.test.ts` still passes. Update `docs/headless-migration.md` Phase 4 → "done". | Must merge last (after PR4.5). |

Pause-safe across PRs: each merged PR leaves a consistent app state.
Multi-hook page conflicts (above) require sequencing, not full
serialization — at most 2–3 PRs in parallel review.

Merge sequence: PR1 first, PR2/PR3/PR4/PR5 in any order subject to the
shared-page constraints, **PR4.5 after PR4** (depends on the new
`useUserMe`/`useNamespace` cache + `CallerScope` wiring), PR-final last.

Once PR-final merges, PG PR2 ([#534](https://github.com/Appsilon/mediforce/pull/534))
is unblocked.

### 9. Read-path schema drift — discovered during PR1 smoke

PR1 smoke surfaced a class of bug worth calling out before PRs 2–6:

**The pattern.** A Firestore document satisfies the *write-time* Zod
schema in force the day it was registered. The *read-time* schema
later narrows (enum tightened, field made required, discriminator
added). Now every read of that document throws `ZodError` at the repo
boundary. The route adapter maps it to a 400 envelope; React Query
re-polls because 400 is not a terminal status by default.
Reference incident: `humanTasks/*` docs with `params[i].type = 'textarea'`
( a widget hint the UI already renders) blew up `GET /api/tasks/:taskId`
in a tight 400 loop once `StepParamSchema.type` was tightened to a
strict enum. Fixed in [#562](https://github.com/Appsilon/mediforce/pull/562)
by widening to `z.string().min(1).default('string')` (still rejects
non-string corruption, accepts unknown widget hints).

**Five rules for PRs 2–6.**

1. **One vocabulary, one schema.** If two schemas claim to validate
   the same field (today: `StepParamSchema.type` is strict 4-enum,
   `TriggerInputFieldSchema.type` extends to 7 values incl.
   `textarea`/`multiselect`) the registration path and the read path
   *will* drift. Pick a single source of truth and re-export. The
   widget-type vocabulary should land in one constant referenced
   from both schemas (follow-up — out of scope for #562). Same rule
   applies to any new shared vocabulary introduced in PRs 2–6.
2. **Prefer open strings to enums at the storage boundary** for
   anything that's a UI hint, plugin name, or extensibility point.
   Enums are right when the *engine* branches on the value
   (`executor: human|agent|script|cowork|action`); they are wrong
   when the *UI* renders by the value (`type: textarea`) — the UI
   already has a default branch, the schema doesn't need a wall.
3. **Repo-boundary parsing must log.** `XSchema.parse(snap.data())`
   throwing a `ZodError` is the single most common silent failure
   mode in this codebase. Either log the path + doc id before
   re-throwing, or `safeParse` and convert to a structured handler
   error (`NotFoundError` if the doc is unrecoverable). PR1 added a
   `console.error` in `route-adapter` for handler-thrown ZodErrors;
   that is the *catch* — the *cause* still belongs at the repo.
4. **Hooks must terminate on 4xx.** `useTask`'s `refetchInterval`
   returns `false` on `query.state.error`. Copy this pattern into
   every polling hook PRs 2–6 introduce — `useAgentRuns`,
   `useProcessInstance`, `useMonitoring`. A 400 / 403 / 404 from the
   server means the user's intent does not match server state; no
   amount of retrying will reconcile that.
5. **Add a repo-level "legacy shape" test** for any schema where you
   intentionally accept old data. `step-param.test.ts` covers
   canonical, widget-hint, default, and non-string-corruption cases.
   When PR3 touches `humanTasks` repo or PR4 touches `users`, mirror
   that pattern with a `__tests__/legacy-shape.test.ts` per schema
   that has any data already in production.

**Schema convergence — out of scope for PR1, queued for PR3.** Unify
`StepParamSchema.type` and `TriggerInputFieldSchema.type` behind one
shared widget-type constant. Bundling this with PR3 (processes/runs,
which already touches step/trigger surface) keeps the merge sequence
intact. Tracked as [#563](https://github.com/Appsilon/mediforce/issues/563)
with the proposed `PARAM_WIDGET_TYPES` const shape and an exhaustive-
switch contract for the 6 current consumers.

## Testing decisions

Mediforce's test taxonomy from [`docs/headless-migration.md`](./headless-migration.md) §"Testing
strategy" applies directly. New test work per PR:

### What makes a good test (this project's invariants)

- Tests assert on **external behavior** of the unit. Handler tests:
  what the handler returns / throws given input + scope state. Hook
  tests: what the consumer sees (data, loading, error, key-change
  cancel). Never assert on `useEffect` invocation counts, React
  internals, or implementation details.
- **No mocks below the HTTP boundary.** Handlers use
  `InMemoryXRepository` from `@mediforce/platform-core/testing`.
- Above the HTTP boundary, mock at the **outermost seam**: `apiFetch`
  for client tests, `mediforce.X.Y` for hook tests, or use the
  loopback pattern for cross-layer integration.
- **One assertion per concept.** Five `expect(...)` for five behaviors
  = five tests.
- **Hook test template:** the existing `useInstanceTasks` test
  (`packages/platform-ui/src/hooks/__tests__/use-instance-tasks.test.ts`,
  5 cases incl. cancel-on-deps-change) is the canonical shape. Every
  migrated hook gets a sibling test with the same five-case structure,
  wrapped in a fresh `QueryClient` per test (the only react-query
  ceremony required).

### Test scope per PR (foundation + per-domain)

| Module | Test layer(s) |
|---|---|
| Schema constants (`HandleSchema`, `HANDLE_REGEX`) | Contract — boundary cases (min/max length, invalid chars, edge handles) |
| Each new endpoint contract (Zod) | Contract test per schema (input + output) |
| Each new handler | Handler test vs `InMemoryX` repos. Cover: success, not-found / anti-enum 404 path, forbidden (where applicable), and any state-machine invariant the handler enforces |
| `GET /api/users/me` lazy bootstrap | Handler test — "creates personal namespace if missing", "no-op + same shape if exists", "idempotent under repeat call" |
| `NamespaceRepository.createNamespaceWithOwner` | Repo unit test (in-memory) covering namespace + member written together + nothing written if either step fails. Postgres parity test added when PG impl lands. |
| `AgentRunRepository.listInNamespaces` | Repo unit test — cursor stability across page boundary, namespace filter correctness, ordering invariant |
| React-query infra (`QueryClient` defaults) | Smoke test — provider wraps, a hook reads through the provider |
| Per-migrated hook | One hook test each (5-case `useInstanceTasks` template): initial load, success, error, deps change cancels in-flight, terminal-state gates polling |
| Cross-layer integration | One per PR — loopback `apiClient → adapter → handler → in-memory repo` for the PR's primary domain. Existing `packages/platform-ui/src/test/api-integration.test.ts` is the pattern. |
| Optimistic update patterns | One test per template (state transition / list-affecting / multi-cache-key) covering snapshot + rollback path |
| Route adapter | No new work — already parametric from Phase 2 (covers HandlerError + ZodError + unknown) |

### Skip

- Component tests for trivial render wrappers (Phase 1 doctrine — render-doesn't-throw is coverage theater).
- E2E new journeys — existing process / task / cowork journey tests cover the user-visible flows. Add a new journey only if a hook + integration test cannot catch the regression.
- Tests for selector hooks (`useNamespaceRole`, `useAllUserNamespaces`, `usePersonalNamespace`) — they are pure derivations over `useUserMe()`'s cache. Test the underlying `useUserMe` hook; the selectors carry no risk surface.

## Out of scope

Items deliberately not in Phase 4 — they earn their own ticket / phase /
ADR. The migration goal is **swap the data transport**, nothing more.

- **Per-resource SSE event stream consolidation.** Future ADR; tracked
  in [`docs/headless-migration.md`](./headless-migration.md) "Captured for after Phase 4."
- **SSE for cowork tool-loop progress.** [#516](https://github.com/Appsilon/mediforce/issues/516).
- **Phase 5 `@/lib/platform-services` shim cleanup.** Off-critical-path
  cosmetic codemod. Schedule when convenient.
- **Phase 7 — split API into separate deployable.** Forward-compatible
  but unnecessary today.
- **URL canonicalization across the API surface** ([#544](https://github.com/Appsilon/mediforce/issues/544)).
  Phase 4 ships under today's URL shape (`/api/namespaces/:handle`,
  `/api/admin/oauth-providers`, `?namespace=X` query params where
  already present). The rename to `/api/workspaces/:handle` or any
  other canonicalization lands as a coordinated independent PR.
- **File-serving endpoints** (`agent-logs`, `agent-output-file`,
  `step-logs`) — deferred under Phase 1.8 because file-serving shape
  needs its own design pass.
- **Audit-wiring phase.** Repo-resident `MutationContext` per
  [ADR-0005 §7](./adr/0005-headless-platform-api-ui-separation.md) "long-term direction." Handler-bridge audit emission
  from Phase 2/2.5/3 stays in place; new Phase 4 mutations emit via
  the same bridge.
- **Run-executor durability (BullMQ migration).** Captured for later
  in [`docs/headless-migration.md`](./headless-migration.md); independent of UI/API separation.
- **ADR-0002 NextAuth migration.** Lazy-bootstrap side-effect in
  `GET /api/users/me` is a known intermediate; the bootstrap moves to
  `events.createUser` when ADR-0002 ships.
- **Adding role / ownership enforcement to wrappers.** `CallerScope`
  already carries `namespaceRoles` (Phase 2.6); handler-resident
  `assertCallerIsNamespaceAdmin` is the gate. Wrapper-level role
  enforcement deferred per [ADR-0004 §4](./adr/0004-scoped-data-access-authorization.md) "Out of scope."
- **Idempotency keys on creates.** `POST /api/namespaces` accepts
  duplicate handles → 409. Add idempotency when a real client demands
  it.
- **Workspace member-management URL rename.** Phase 2.6 endpoints stay
  under `/api/users/invite`, `/api/users/members`, etc. URL
  canonicalization PR will rename together with the rest.

## Further notes

### Coordination with [#534](https://github.com/Appsilon/mediforce/pull/534) (PG PR2)

PG PR2's description names this PRD as its explicit gate. The merge
sequence is:

1. PR #515 already merged (Postgres provision + tool-catalog tracer).
2. **This phase ships** — all six PRs land sequentially per the
   schedule above. UI stops importing `firebase/firestore`. Server data
   layer still Firestore; behavioural no-op.
3. Staging cutover via `scripts/migrate-firestore-to-postgres/`.
   Iterate per `CUTOVER-CHECKLIST.md`.
4. PG PR2 merges; server flips to Postgres; UI already reads through
   headless endpoints; no fallout.
5. Production cutover during maintenance window.

### Why react-query is forward-compatible with eventual SSE

`@tanstack/react-query` provides the cache. SSE provides updates.
Future `useResourceStream(resourceId)` hooks dispatch each event into
the same cache via `qc.setQueryData(key, updater)`. Polling becomes
the fallback for the initial load + reconnect catchup; SSE pushes
incremental deltas. Components read through the same `useQuery(key)`
they read today; they do not know which transport delivered the
update.

This is the exact pattern "per-resource event stream consolidation"
(captured-for-later in [`docs/headless-migration.md`](./headless-migration.md)) will use. Phase 4
picking react-query now equals zero rework when SSE arrives.

### Audit emission

No new audit shape. Handler-bridge emission per [ADR-0005 §7](./adr/0005-headless-platform-api-ui-separation.md):

- `namespace.created` — emitted by `POST /api/namespaces` handler.
- `user.personal_namespace_created` — emitted exactly once by the
  lazy bootstrap side-effect of `GET /api/users/me` (only when
  creation happens, not on every call).

No other Phase 4 endpoint emits audit (reads do not emit; existing
mutations migrated in Phase 2/2.5/3 keep their existing emit shape).

### Verification action items (block on these before implementation)

Worth confirming before PR1:

1. **`users/{uid}.organizations` field** — verify it is truly dead.
   Grep for readers across `packages/`. If dead, drop from the
   `POST /api/namespaces` handler's write set + remove from
   `auth-context.tsx` bootstrap moved to GET /me. Reduces atomicity
   surface and one Firestore consumer.
2. **`agents/[runId]/page.tsx`** — confirm `runId` in this URL is an
   agentRunId (not a workflowRunId). If workflowRunId, single endpoint
   `GET /api/agent-runs/:agentRunId` does not apply; rethink.
3. **`HandleSchema` location** — search existing schema package for a
   handle constant. If one exists, point at it; if not, create per
   the inventory.
4. **`useSubcollection` / `useProcessInstance` / `useActiveTaskForInstance` /
   `useActiveCoworkSession`** — phrases used in [`docs/headless-migration.md`](./headless-migration.md)
   Phase 4 doc. Verify each maps to an existing file or is aspirational
   shorthand; the audit found only the named 22 files. The per-consumer
   table above is authoritative; the doc's prose lists need a sweep
   pass during PR3 / PR5.
5. **Cowork chat handler** — confirm extending return shape to include
   `session` + `turns` is in fact additive (no schema rejection on
   existing call sites). Should be — Zod object schemas with strict
   defaults pass through extras — but verify by running existing chat
   tests with the extended shape.

### Living document

This PRD is `Active` while implementation runs. Each PR may amend it
to reflect what survived contact with the codebase. Finalize on PR-final
merge, at which point `docs/headless-migration.md` § Phase 4 marks
"done" and this PRD becomes the historical record.
