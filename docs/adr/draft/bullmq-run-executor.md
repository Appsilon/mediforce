# DRAFT — Run-executor durability: BullMQ-based queue + auto-runner relocation

- **Status:** Draft (not yet numbered; promote to numbered ADR after review session)
- **Date:** 2026-05-26 (draft)
- **Authors:** Marek Rogala (@marekrogala)
- **Reviewers:** TBD
- **Relates to:**
  - Builds on [ADR-0005](../0005-headless-platform-api-ui-separation.md) §"Orchestration kick mechanism" open question.
  - Replaces the `httpSelfFetchRunKicker` placeholder introduced in Phase 3 PR1 with a real durable queue.
  - Touches the `executeAgentStep` + `getPlatformServices` Next.js coupling; relocates the auto-runner loop out of `after()`.

## Context

Today, every workflow-run mutation (claim/complete/cancel/resume/create/retry/cron-tick/cowork-finalize) fires a fire-and-forget `fetch(getAppBaseUrl() + '/api/processes/:id/run')` to wake the auto-runner. The route runs a 632-LOC `after()` loop in the Next.js process. Concurrency per instance is gated by `runLocks: Set<string>` at module scope. The loop iterates the engine, spawns Docker containers for agent steps via `AgentRunner.run()`, and exits when the run reaches a terminal/paused state.

The setup has accumulated several documented workarounds: `runLocks` is single-process only (multi-replica race), `after()` dies with the worker (crash = stuck run, recovery via 15-min cron-heartbeat), no retry / DLQ / observability, `isStuckLoop` + `MAX_SAME_STEP_ITERATIONS` workaround for missing idempotent dispatch, and the `runKicker` prod impl still needs `getAppBaseUrl` + `PLATFORM_API_KEY` (boundary violation under the abstraction). BullMQ is already a prod + staging dependency for `mediforce-docker-jobs` (container-worker), so the infra exists.

The Phase 3 PR1 plan introduces `scope.system.runKicker.kick(instanceId)` as a 1:1 abstraction over today's HTTP self-fetch — zero behaviour change. This ADR is the swap-impl decision: replace the self-fetch with a real durable queue and move the executor out of Next.js.

## Decision

### 1. Workflow execution model: per-step jobs, single queue

Each workflow-run advance becomes one BullMQ job representing one Step Execution attempt. The auto-runner is decomposed: the queue carries pending work, a worker process consumes it, and each step finishes by enqueueing the next.

- **Queue:** `mediforce-workflow-steps` (new, separate from `mediforce-docker-jobs`).
- **Job shape:** `{ runId, stepId }`.
- **Job semantics:** fire-and-forget. No `waitUntilFinished` from producers. (Distinct from `mediforce-docker-jobs` which is sync RPC.)
- **Granularity:** one job = one Step Execution attempt. Transitions are not jobs — they are resolved by the engine inside one execute pass.

The `runKicker` framing is dropped in favour of `scheduleNextSteps`: an explicit "ask the engine what's next, enqueue any pending step(s)" verb. The mental shift: workflow runs do not loop continuously — they react to events. Each event reduces to "given current DB state for run X, what step(s) should run now?"

Rejected alternative: "run-as-one-long-job" (kicker semantics ported to BullMQ — one job runs the whole loop until pause). Rejected because:
- Crash mid-loop loses the entire instance until next cron-heartbeat (15+ min today).
- Retry attempts are run-level, not step-level — `MAX_SAME_STEP_ITERATIONS` and `isStuckLoop` workarounds persist.
- Observability per run, not per step. Bull-board can't show "this specific step is failing repeatedly."
- Future fan-out impossible without re-architecting.

### 2. Producer API: `scope.runs.scheduleNextSteps(runId)`

A single helper replaces the eight self-fetch call sites:

```ts
// packages/platform-core/.../caller-scope.ts (CallerScope.runs)
async scheduleNextSteps(runId: string): Promise<void> {
  const run  = await this.runs.getById(runId)
  if (!run || run.status !== 'running') return
  const next = await this.engine.getNextSteps(run)   // Step[]
  for (const step of next) {
    await this.system.runStepQueue.enqueue(runId, step.id)
  }
}
```

Call sites (replacing every `fetch(getAppBaseUrl() + '/api/processes/:id/run')`):

| Site | Migrated call |
|---|---|
| `POST /api/processes` create | `await scope.runs.scheduleNextSteps(runId)` |
| `POST /api/processes/:id/resume` | `await scope.runs.scheduleNextSteps(runId)` |
| `POST /api/processes/:id/steps/:stepId/retry` | `await scope.runs.scheduleNextSteps(runId)` |
| `POST /api/tasks/:taskId/complete` | `await scope.runs.scheduleNextSteps(runId)` |
| `POST /api/cron/heartbeat` (per fired trigger) | `await scope.runs.scheduleNextSteps(runId)` |
| `POST /api/cowork/:id/finalize` | `await scope.runs.scheduleNextSteps(runId)` |
| Server Action `startWorkflowRun` | `await scope.runs.scheduleNextSteps(runId)` |
| Server Action `retryFailedStep` | `await scope.runs.scheduleNextSteps(runId)` |

`scope.system.runStepQueue` is the new abstract interface; the BullMQ impl lives in the worker package (§4).

### 3. Engine refactor: `getNextSteps(run) → Step[]`

The engine gains an explicit "what's pending for this run right now?" query, returning a list (`Step[]`). Today's implementations always return 0 or 1 elements; the array shape future-proofs for fan-out without re-architecting the queue.

- `getNextSteps(run): Promise<Step[]>` — pure (DB reads only); 0 when terminal/paused, 1 for normal sequential workflows, N for future parallel fan-out.
- Existing `engine.advanceStep(run, stepId, result)` continues to handle state transitions (after a step completes).
- New `engine.onStepFailed(run, stepId, err): FailureDecision` — decides the failure cascade (§7).

Engine remains pure-ish: no BullMQ import, no Redis dep. The queue is consumed by the worker; engine doesn't know it exists.

### 4. Worker package: `packages/workflow-step-worker`

A new package, sibling to `container-worker`, hosts the BullMQ Worker + step-type dispatcher + executors.

```
packages/workflow-step-worker/
  src/queue.ts                  BullMQ Queue setup + RunStepQueue impl
  src/worker.ts                 BullMQ Worker, processStepJob dispatcher
  src/scheduler.ts              scheduleNextSteps glue (engine + queue)
  src/boot-sweep.ts             startup recovery sweep (§9)
  src/heartbeat.ts              BullMQ repeat job registration (§8)
  src/executors/
    agent-step.ts               executeAgentStep — relocated from platform-ui/src/lib/
    script-step.ts              executeScriptStep
    action-step.ts              executeActionStep
    human-step.ts               openHumanTask (INSERT bookmark + exit)
    cowork-step.ts              openCoworkSession (INSERT bookmark + exit)
  src/worker-entry.ts           node entry point
  package.json                  deps: bullmq, @mediforce/workflow-engine,
                                @mediforce/agent-runtime, @mediforce/platform-core
```

**Runtime:** standalone Node process. Own `docker-compose` service (`workflow-step-worker`), separate restart unit, independent failure domain. Match container-worker pattern.

**Why a separate package, not in `workflow-engine`:**

The argument is not "lots of code" (the worker is thin — ~300 LOC). It is interface boundary. Engine is the state machine; the queue is one runtime impl. If queue tech swaps (BullMQ → DBOS, in-process, etc.), the engine doesn't change — only the worker package does. Keeping queue infra out of the engine package preserves engine importability without BullMQ (tests, CLI, future MCP server, future audit tools).

The worker dispatcher is a thin shell:

```ts
async function processStepJob({ runId, stepId }) {
  const run = await runRepo.getById(runId)
  if (run.status !== 'running') return            // late cancel / re-eval race

  const step = engine.resolveStepConfig(run, stepId)
  try {
    const result = await executeByType(step.executor, run, step)
    await stepExecRepo.save(runId, stepId, 'completed', result)
    await engine.advanceStep(run, stepId, result)
    await scheduleNextSteps(runId)
  } catch (err) {
    await stepExecRepo.save(runId, stepId, 'failed', err)
    await engine.onStepFailed(run, stepId, err)
  }
}

function executeByType(type, run, step) {
  switch (type) {
    case 'agent':  return executeAgentStep(run, step)
    case 'script': return executeScriptStep(run, step)
    case 'action': return executeActionStep(run, step)
    case 'human':  return openHumanTask(run, step)
    case 'cowork': return openCoworkSession(run, step)
  }
}
```

### 5. Two execution paradigms preserved (cowork vs agent step)

Mediforce already runs two distinct execution paradigms side-by-side. The ADR preserves both rather than forcing one model onto the other.

| Cowork (chat / voice modes) | Agent step |
|---|---|
| ChatGPT-style: stateless HTTP per turn | Claude-Code-style: long-running Docker container |
| History rebuilt from DB each turn | Process holds context, files, tool state in memory |
| LLM call inline in Next.js handler | Spawned binary (claude-code / opencode / script) executes task |
| No persistent process | Multi-minute container runs to envelope |
| Real-time, interactive, multi-turn | Autonomous, single envelope return |

For the queue model:
- **Cowork step** = pause + bookmark. Worker creates `CoworkSession` row, marks `StepExecution` started, exits. SSE chat lives in Next.js routes; finalize mutation enqueues `scheduleNextSteps(runId)` to resume.
- **Agent step** = long job. Worker calls `executeAgentStep` which delegates to `AgentRunner.run()`, which enqueues on `mediforce-docker-jobs` and `waitUntilFinished` — synchronous inside the worker job. Envelope returns, worker saves, enqueues next.
- **Human step** = pause + bookmark. Mirrors cowork pattern. `complete-task` mutation enqueues to resume.
- **Script / action step** = inline execution. Fast.

This means `cowork` and `human` are essentially "create row + exit"; the workflow run pauses, external events (mutations) wake it via `scheduleNextSteps`. No long-running queue job; no idle worker slot tied up. This decouples interactive sessions from queue capacity.

A future ADR may split `AgentRunner` into `start()` + `collect()`, letting `container-worker` enqueue `scheduleNextSteps` when the agent finishes — making run-step jobs short-lived sec-scale rather than minute-scale. Today's ADR keeps `AgentRunner.run()` synchronous inside the run-step worker job; the interface is stable for future split.

### 6. `runLocks` replacement: BullMQ deduplication

In-memory `runLocks: Set<string>` is replaced by BullMQ's native deduplication:

```ts
queue.add({ runId, stepId }, {
  deduplication: { id: `${runId}:${stepId}`, keepLastIfActive: true }
})
```

`keepLastIfActive` guarantees at most 1 active + 1 queued job per `(runId, stepId)` pair. Burst kicks (cron + complete + resume in 100ms) collapse to one active + one queued. Multi-replica workers safe (Redis-level atomic).

Cancel mutation additionally removes queued jobs for the run:

```ts
async function cancelRun(runId) {
  await runRepo.update(runId, { status: 'cancelled' })
  await scope.system.runStepQueue.removeAllFor(runId)   // BullMQ remove by jobId prefix
}
```

Active jobs are not preempted (soft cancel; see §10).

### 7. Failure semantics

Failure decision tree:

| Scenario | Detection | Response |
|---|---|---|
| Step throws transient error | <1s | BullMQ retry (job-level `attempts`) with backoff |
| Step throws permanent (attempts exhausted) | ~90s sum | `engine.onStepFailed(run, stepId, err)` — see below |
| Worker crashes mid-step | `lockDuration + stalledInterval` (~5.5min) | Stalled detector requeues; new worker reattempts |
| Worker crashes post-save, pre-enqueue | Cron-heartbeat interval (1min) | Sweep re-enqueues stuck runs |
| Cancel mid-step | Mutation removes queued | Active job completes naturally; `scheduleNextSteps([])` absorbs |
| Redis down | Mutation `await queue.add` throws | 5xx to caller; user retry |

`engine.onStepFailed(run, stepId, err): FailureDecision` returns one of:
- `runErrorHandler(handlerStepId)` → workflow definition declared an error-handler step; enqueue it.
- `continueOnError` → skip the failed step; call `scheduleNextSteps`.
- `terminateRun(reason)` → mark `run.status = 'failed'`, emit audit, no further enqueue.

The default for workflows without explicit error handling is `terminateRun`.

Starting BullMQ knobs (tunable post-deploy):

- `lockDuration`: 5 min (auto-renewed while worker lives; this is the crash-detection window, not max job duration)
- `stalledInterval`: 30s (default)
- `maxStalledCount`: 2 (bumped from default 1 to absorb GC pauses / network glitches)
- `attempts`: 3 for `agent` / `script` / `action`; 1 for `human` / `cowork` (no retry on bookmark insert)
- Backoff: exponential, base 30s, max 5min

### 8. Cron-heartbeat: BullMQ repeat + recovery sweep

The existing `POST /api/cron/heartbeat` endpoint moves out of HTTP and into a BullMQ repeat job registered at worker startup:

```ts
queue.add('heartbeat', {}, {
  repeat: { every: 60_000 },
  jobId: 'cron-heartbeat',                          // singleton via fixed jobId
})
```

Per-tick work:
1. Scan triggers due (existing logic).
2. For each fired trigger: `scheduleNextSteps(runId)`.
3. **Recovery sweep:** `SELECT id FROM runs WHERE status = 'running' AND id NOT IN <active+queued jobs in workflow-step queue>`. For each: `scheduleNextSteps(runId)`. Dedup absorbs noise.

Interval: 1 min (down from today's 15 min). Bounds detection latency for the worker-crash-post-save race window.

### 9. In-flight migration: zero migration script

The deploy-day transition reuses the same recovery mechanism the ADR already needs for worker crashes. No bespoke migration code.

1. Deploy new version. Old Next.js shuts down → `after()` loops killed; in-flight `mediforce-docker-jobs` keep running on container-worker (separate queue, separate process).
2. New `workflow-step-worker` starts. **Boot sweep** in `worker-entry.ts`:
   ```ts
   const stuck = await runRepo.list({ status: 'running' })
   for (const run of stuck) await scope.runs.scheduleNextSteps(run.id)
   ```
3. Cron-heartbeat (every 1 min) continues to catch any post-deploy stragglers.
4. Engine recovery logic (already needed for §7 worker-crash) handles "step started, no envelope" — restart attempt, idempotency check against existing `StepExecution` rows.

Orphaned Docker containers from old auto-runner: container-worker continues processing them; envelope files land in `StepExecution.outputDir` (filesystem). New engine recovery picks them up if envelope present; otherwise restarts the step.

Cowork SSE connections drop with the old Next.js process; browsers reconnect to new Next.js, read turns from DB, resume.

### 10. Cancel: soft now, aggressive follow-up (same ADR)

**Implementation step 1 (soft cancel — ships with the ADR):**
- Mutation writes `run.status = 'cancelled'`, removes queued step jobs.
- Active step job is not preempted. Step completes naturally (agent finishes envelope or errors out).
- Worker post-step: reads `run.status = 'cancelled'`, `scheduleNextSteps` returns empty, exits.
- UX: "cancelling…" until current step finishes. Matches today's semantics.

**Implementation step 2 (aggressive cancel — same ADR, separate PR):**
- Cancel mutation additionally kills the Docker container associated with the current step (`StepExecution.dockerContainerId` → Docker API kill).
- `AgentRunner.run()` throws; worker catches, sees cancelled, exits.
- UX: seconds to release; pharma compliance angle: explicit operator intent honoured immediately.

Carve-out into two steps because the soft path is enough to ship the durability win; aggressive needs container-ID tracking + Docker API plumbing that doesn't gate the core architectural change.

### 11. Observability: bull-board in prod + staging

`deadly0/bull-board` image already runs in dev (`docker-compose.yml` :3100). The ADR mounts it in staging + prod, behind Caddy reverse proxy with basic-auth:

- Path: `/admin/queues` (or subdomain per deployment convention).
- Auth: `BULL_BOARD_USER` / `BULL_BOARD_PASS` env (admin secret, separate from app auth).
- Queues monitored: `mediforce-docker-jobs`, `mediforce-workflow-steps`, plus cron repeat.

Visibility into stuck runs / failed jobs / queue depth is invaluable during the first weeks post-deploy.

### 12. Multi-worker scale-out: architecturally supported, single replica day-1

Architecture supports N `workflow-step-worker` replicas:
- BullMQ dedup is Redis-atomic → no double-execution.
- Engine logic stateless and idempotent (reads DB, decides) → safe under concurrency.
- Step executors stateless per-job.
- Boot sweep dedup-absorbs duplicate enqueues when multiple workers boot.

Day-1 deploy: 1 replica (KISS, match container-worker pattern). `docker-compose.yml` ships `replicas: 1`. Scale knob is a number; no code change. Local validation with 2 replicas during integration testing confirms dedup behaviour.

### 13. Dev environment: Redis hard dependency

`pnpm dev` requires Redis + workflow-step-worker + container-worker running. The old `HttpSelfFetchRunStepQueue` fallback (in-process Next.js execution) is rejected:
- Two code paths to maintain.
- Dev/prod divergence — bugs in queue logic invisible until staging.
- The fallback recreates exactly the problem this ADR is solving.

```bash
docker compose up -d   # Redis + workflow-step-worker + container-worker + bull-board
pnpm dev               # Next.js only
```

Tests retain in-memory queue impls in `@mediforce/platform-core/testing`:
- **L2 handler tests:** `RecordingFakeQueue` — records `enqueue()` calls without executing. Tests handler isolation ("did handler call `scheduleNextSteps` correctly?").
- **Cross-layer integration tests (Vitest loopback):** `InMemorySyncQueue` — `enqueue` synchronously invokes `processStepJob`. Tests full chain in-process, no HTTP, no Redis.
- **L3 API E2E + L4 UI E2E:** real BullMQ + Redis + worker subprocess (Playwright global setup).

### 14. HTTP endpoint deletion: `/api/processes/:instanceId/run`

The 632-LOC route is deleted. All eight self-fetch call sites use `scope.runs.scheduleNextSteps` in-process. External integrations (cron, webhook triggers) already have their own endpoints that internally call `scheduleNextSteps`.

Operator debug ("force-advance this run"): new CLI command `mediforce run advance <runId>` in `packages/cli`. Better UX and audit trail than `curl POST /api/...`.

Also deleted:
- `runLocks: Set<string>` (module-scope, `route.ts:31`)
- `loop-guard.ts` (`MAX_SAME_STEP_ITERATIONS`, `isStuckLoop`)
- `getAppBaseUrl()` uses at the eight call sites
- `PLATFORM_API_KEY` self-fetch usage
- `after()` wrap

## Considered alternatives

### Durable execution frameworks (Temporal, DBOS)

Rejected. Workflow-as-code paradigm fundamentally mismatches Mediforce's workflow-as-JSON-definition compliance angle (pharma audit traceability needs static definitions, not code).

**Temporal:** additionally rejected for operational weight (Cassandra + multiple stateful services; mismatch single-tenant on-prem deployments). Not revisiting.

**DBOS:** noted as potential future alternative. Postgres-native (aligns with ADR-0001), single-DB ops (lighter than Temporal), exactly-once via DB transactions. Same workflow-as-code blocker — would require either generic-interpreter pattern (defeats framework value) or static-definition rewrite. Re-evaluate when:
- Workflow definitions move to authored TS (compliance angle resolved differently)
- Multiple compensation/SAGA patterns appear (DBOS primitives become valuable)
- Operational burden of Redis + BullMQ exceeds single-DB orchestration cost

Engine interface (`getNextSteps`, `executeStep` per step type, `onStepFailed`) is portable if migration ever needed — worker package swaps; engine stays.

### Kicker abstraction as long-term home

Phase 3 PR1 introduces `scope.system.runKicker.kick(instanceId)` modelled on today's HTTP self-fetch. Rejected as the long-term interface. "Kicker" frames the runner as a long-running loop being woken; the proper model has no loop at all — runs react to events. `scheduleNextSteps` reads as the actual verb. Adopted instead.

### Single job kind that walks "as far as possible" before exiting

Hybrid Model B from the design grilling: per-job, advance through cheap pure transitions inline until a side-effecting step or pause. Rejected after recognising that transitions in Mediforce are not jobs — the engine resolves them inside one execute pass. Per-step jobs natively give the same behaviour without batching complexity.

### Two-stage queue (dispatcher + executor)

A cleaner orchestrator pattern: dispatcher job (`{kind:'evaluate', runId}`) computes pending steps and enqueues executor jobs (`{kind:'execute', runId, stepId}`); executors enqueue an evaluate when they finish. Rejected as over-engineered for current needs. Single-kind job with `scheduleNextSteps` helper covers the same cases; the dispatcher logic is inlined in the helper. If a real need arises (priority routing, separate dispatcher scaling), the upgrade is mechanical.

### Reusing `mediforce-docker-jobs` queue

Rejected. The docker queue is sync RPC (`waitUntilFinished` semantics). The kick is fire-and-forget. Different semantics on the same queue would force opt-in flags per add call and confuse consumers.

### Worker process co-located in Next.js

Rejected. Recreates the original `after()` problem (workflow execution dies with the web process). Defeats the ADR's core motivation.

### Worker process co-located in `container-worker`

Rejected as SRP violation. Container-worker = "spawn Docker containers per agent step." Workflow-step-worker = "drive workflow state machine forward." Different concerns, different failure domains, different scaling axes.

### In-engine package consolidation

Rejected. Engine should remain importable without BullMQ (tests, CLI, future tools). Worker package preserves the interface boundary.

### Transactional outbox for save+enqueue atomicity

Considered for the worker-crash-post-save-pre-enqueue race window. Rejected as overkill for v1. Cron-heartbeat sweep (every 1 min) absorbs the window. Reconsider if the race ever bites operationally.

## Consequences

- Eight self-fetch sites collapse to one helper call (`scope.runs.scheduleNextSteps`).
- `runLocks`, `isStuckLoop`, `MAX_SAME_STEP_ITERATIONS`, `after()` wrap all retire.
- One new package, one new compose service, one new BullMQ queue.
- Dev onboarding adds one step (`docker compose up -d` before `pnpm dev`); `pnpm dev:queue` becomes default.
- Crash recovery latency for worker-died-mid-step shrinks from 15 min (cron interval) to ~5.5 min (BullMQ stalled detect). For worker-died-post-save: stays at cron interval but interval drops to 1 min.
- Each step execution is a separate BullMQ job → step-level retry, step-level visibility in bull-board, step-level observability.
- Engine is now explicitly importable without queue infra; future tooling (audit replay, CLI debug) gains a clean entry point.
- Architecture supports fan-out workflows when the engine adds it; queue does not need changes.
- Architecture supports horizontal worker scale; ops decision when to deploy >1 replica.
- Cancel UX has a known soft-cancel gap (waits for current step to finish); aggressive cancel ships as the second PR of this ADR's implementation.

## Out of scope

- **Agent runner async split.** `AgentRunner.run()` stays synchronous inside the worker job. A future ADR may split into `start()` + `collect()` so container-worker enqueues `scheduleNextSteps` when the docker job finishes.
- **Transactional outbox.** Save + enqueue stay separate; cron-heartbeat absorbs the race window. Revisit if it bites.
- **Audit-wiring phase.** ADR-0005 §7 already commits to repo-resident `MutationContext` audit emission as a separate phase. Worker-side audit emissions (`run.failed`, step retries) follow the same future pattern.
- **Workflow definition fan-out semantics.** `engine.getNextSteps` returns `Step[]` to permit fan-out, but the workflow definition format change (`next: [a, b]`, `waitForAll: [...]`) is a separate ADR.
- **Per-customer worker isolation.** Single-tenant deployments today; multi-tenant SaaS would need namespace-scoped queues or worker pools. Not in scope.

## Open questions

(None blocking. Section reserved for review-pass comments.)

## Implementation plan (sketch — PR-by-PR)

The ADR is large but decomposes into reviewable PRs. Sketch only; firm sequencing in a companion `PLAN-NNNN.md` after numbering.

1. **PR1 — Worker package skeleton + engine.getNextSteps refactor.** New `packages/workflow-step-worker` with empty Worker, RunStepQueue interface in workflow-engine, engine returns `Step[]` (size 0/1). InMemorySyncQueue + RecordingFakeQueue in `platform-core/testing`. No call-site changes yet.
2. **PR2 — Relocate executors.** Move `executeAgentStep`, `executeScriptStep`, `executeActionStep`, `openHumanTask`, `openCoworkSession` from `platform-ui/src/lib/` to `workflow-step-worker/src/executors/`. Wire dispatcher.
3. **PR3 — `scope.runs.scheduleNextSteps` + 8 call-site migrations.** Replace fire-and-forget fetches. `httpSelfFetchRunStepQueue` impl wired (still works without the worker process).
4. **PR4 — BullMQ impl + worker-entry.ts + docker-compose.** Worker process boots, processes jobs. Queue impl swap in prod config.
5. **PR5 — Cron-heartbeat → BullMQ repeat.** Drop HTTP endpoint variant.
6. **PR6 — Delete `/api/processes/:id/run` + `runLocks` + loop-guard + dead code.** CLI `mediforce run advance` lands.
7. **PR7 — bull-board prod mount.** Caddy basic-auth.
8. **PR8 — Aggressive cancel.** Docker container kill on cancel mutation.

Each PR is pause-safe; previous PR's state stays working until the next ships.
