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
| `GET /api/tasks` | tasks | done | #232 (pilot) |
| `GET /api/tasks/:taskId` | tasks | todo | — |
| `GET /api/processes/:instanceId` | processes | todo | — |
| `GET /api/processes/:instanceId/audit` (paginated) | processes | todo | — |
| `GET /api/processes/:instanceId/steps` | processes | todo | — |
| `GET /api/workflow-definitions` (list) | definitions | todo | — |
| `GET /api/workflow-definitions` (by name+version) | definitions | todo | — |
| `GET /api/agent-definitions` | definitions | todo | — |
| `GET /api/cowork/:sessionId` | cowork | todo | — |
| `GET /api/cowork/by-instance/:instanceId` | cowork | todo | — |
| `GET /api/configs` | configs | todo | — |
| `GET /api/plugins` | misc | todo | — |
| `GET /api/agent-logs` | misc | todo? | — |
| `GET /api/agent-output-file` | misc | todo? | — |
| `GET /api/health` | — | stays as-is | — |
| `GET /api/oauth/callback` | — | stays (Filip's domain) | — |

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

### Phase 2 — Migrate mutations (grouped by domain)

Harder than GETs because each mutation has a state machine and side effects. Break into small PRs:

- **Tasks lifecycle**: `POST /api/tasks/:id/claim`, `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/resolve`
- **Process lifecycle**: `POST /api/processes`, `POST /api/processes/:id/advance`, `POST /api/processes/:id/cancel`, `POST /api/processes/:id/resume`, `POST /api/processes/:id/steps/:stepId/retry`
- **Definitions & configs**: `PUT /api/definitions`, `POST /api/workflow-definitions`, `POST /api/agent-definitions`, `POST /api/configs`, `PUT /api/configs`
- **Cron heartbeat**: `POST /api/cron/heartbeat`

**Additional concerns per mutation:**

- Response shape often echoes the corresponding GET — reuse the schema.
- Fire-and-forget internal fetches (`getAppBaseUrl()` callers) keep working because we stay on same-origin deploy.
- State-machine invariants surface as additional contract refines (e.g. "cannot complete a task that is not claimed").

**PR sizing**: one lifecycle domain per PR (all Tasks mutations, all Process mutations, all Definitions). Typically 3-5 endpoints.

**Pause-safe**: yes — same as Phase 1, unmigrated mutations stay on their inline Next.js handlers.

**Open questions to settle before starting**:
- How do we encode state-machine preconditions in the contract? Candidate: extra Zod `.refine()` on the output of a prior GET shape, combined with repo-level assertions throwing a typed `PreconditionFailedError` that the adapter maps to 409.
- Do we still have separate Server Actions and API routes for the same mutation, or does migrating the handler let us delete the server action? (Next.js-specific concerns like `revalidatePath` stay behind.)
- Idempotency keys for operations like `POST /api/processes` — worth adding now or later?

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
  - Uses `apiFetch` (Filip's helper) under the hood — auth via Firebase Bearer.
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

Firebase is never imported by `platform-api/client` — the browser wrapper in `platform-ui/src/lib/mediforce.ts` supplies `bearerToken` that lazily imports Firebase SDK and reads `auth.currentUser.getIdToken()`. For Node consumers, just `new Mediforce({ baseUrl, apiKey })`.

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
| 11 | **Structural guard** | Architectural invariants — imports, test presence, auth coverage | Vitest (file scan) | <200ms | `packages/platform-ui/src/test/api-boundaries.test.ts`, `api-auth-coverage.test.ts` |
| 12 | **E2E journey** | User-visible flow through real browser | Playwright + emulator + Next.js dev | ~60s | `packages/platform-ui/e2e/journeys/*.journey.ts` |
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
