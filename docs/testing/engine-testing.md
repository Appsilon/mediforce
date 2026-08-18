---
status: living
audience: engineers
last_reviewed: 2026-08-18
---

# Workflow Engine Testing Strategy

How the engine, its plugins, and the handlers around them are tested. For the
repo-wide L1–L5 level model and which level a change belongs at, see
[`e2e-strategy.md`](./e2e-strategy.md) and the `/new-test` skill — everything on
this page is L1 (unit) or L2 (integration), and a product feature still needs
its L3 alongside.

## Principles

1. **Unit test every decision point** — transitions, expression evaluation, step routing, RBAC checks. These are pure functions with in-memory doubles, they run in milliseconds.
2. **Integration test the full loop** — trigger → step execution → transition → next step → completion. This is where the real bugs hide: wrong transition taken, state not persisted, agent output not fed to next step.
3. **Test the auto-runner separately** — the auto-runner (`packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts`) is the orchestrator that ties engine, plugins, and repositories together. It has its own test file rather than being covered incidentally by engine tests.

## Test layers

| Layer | What | Where | Speed |
|-------|------|-------|-------|
| **Contract (`platform-api`)** | Pure handler behavior + Zod I/O shapes, against in-memory repos | `packages/platform-api/src/handlers/<domain>/__tests__/` | <1s |
| **Unit** | Transitions, expressions, RBAC, triggers, step routing | `packages/workflow-engine/src/__tests__/`, `engine/__tests__/`, `expressions/__tests__/`, `triggers/__tests__/` | <1s |
| **Plugin unit** | Individual plugin init, run, output parsing | `packages/agent-runtime/src/plugins/__tests__/` | <1s |
| **Engine integration** | Full workflow loop with in-memory repos | `packages/workflow-engine/src/__tests__/integration.test.ts` | <1s |
| **Auto-runner integration** | The `POST /api/processes/[instanceId]/run` route with mocked repositories | `packages/platform-ui/src/app/api/processes/[instanceId]/run/__tests__/route.test.ts` | <1s |

Every layer here runs under `pnpm test:unit`. None of them needs Postgres, a
container runtime, or a dev server — that is what makes them the first place to
reproduce a bug.

### Contract tests (`platform-api`)

The `platform-api` package holds API endpoint logic as pure handler functions that take `(input, scope)` and return a typed result (ADR-0005). A contract is a pair of Zod schemas (input + output) per endpoint — the schema is the source of truth for the API shape; the handler conforms by TypeScript, not by runtime re-parse.

- **Placement**: tests live in `packages/platform-api/src/handlers/<domain>/__tests__/`, one `<handler-name>.test.ts` per handler, plus an optional `contract.test.ts` per domain for schema-only assertions.
- **Dependencies**: tests import in-memory repos from `@mediforce/platform-core/testing` — no mocks, no HTTP, no dev server, no database.
- **When to write one**: any time a new API endpoint is added, write the handler test **before** wiring the Next.js route adapter.
- **Canonical example**: `packages/platform-api/src/handlers/tasks/__tests__/` — four handler tests plus the one `contract.test.ts` in the repo, backing `GET /api/tasks` and the task actions.

The Next.js route is a thin adapter: `createRouteAdapter` (in `packages/platform-ui/src/lib/route-adapter.ts`) handles auth, input parsing, Zod validation → 400, and error sanitisation → 500. The route file itself is ~15 lines of pure declaration.

### Boundary rules (enforced by `packages/platform-ui/src/test/integration/api-boundaries.test.ts`)

Three conventions keep the split from rotting — encoded as a Vitest test that scans source files, in the same structural-assertion style as `api-auth-coverage.test.ts`:

1. **UI import boundary.** Anything in `packages/platform-ui/src/` may only import `@mediforce/platform-api/contract`, `/client`, or `/services`. Handler imports are reserved for the adapter surface:
   - `src/app/api/**/route.ts` — Next.js route handlers
   - `src/app/actions/*.ts` — the two remaining server actions, frozen: no new ones (ADR-0005, AGENTS.md §8)
   - `src/lib/route-adapter.ts` — the adapter helper itself
2. **No Firestore.** `firebase/firestore` imports are forbidden anywhere under `packages/platform-ui/src/`. Postgres is the datastore (ADR-0001).
3. **Handler test presence.** Every file in `packages/platform-api/src/handlers/` (except `index.ts`) must have a sibling `__tests__/<name>.test.ts`. Contract tests are encouraged per domain but not enforced — the handler behaviour test is.

Runs as part of `pnpm test:unit` — no separate CI job.

### Test-name prefixes

Tests in `workflow-engine`, `platform-api`, and `platform-ui` adopt a lightweight tag convention in the `it('…')` string, so `pnpm test -t '\[ERROR\]'` slices by concern at a glance:

| Prefix | What it covers |
|---|---|
| `[DATA]` | Happy-path behaviour — correct output for valid input, filtering, transformations, persistence |
| `[ERROR]` | Failure paths — Zod rejections, 400/500 responses, invariant violations, expected exceptions |
| `[AUTH]` | Authorisation / middleware behaviour (rare — most auth is covered once in `api-auth-coverage.test.ts`) |

The prefix is optional — use it when a file mixes data-path and error-path tests, skip it when every test in a file is the same category. Do not invent new prefixes without adding a row here.

## What exists today

**workflow-engine** (20 test files):
- Engine loop, step execution, transitions, expression evaluator, graph validator
- Review tracker, escalation, human-task completion, RBAC
- Manual trigger, webhook router, cron trigger and schedule utilities
- Cowork sessions and lifecycle, step retry, previous-run outputs

**agent-runtime** (41 test files):
- Agent runner, step and script executors, fallback handling, plugin registry
- Claude Code, OpenCode, ScriptContainer and container plugins
- MCP resolution, workspace provisioning, OAuth token handling

**Covered since this page was first written:** the full mixed-executor loop, agent
output propagating into `instance.variables` and feeding the next step, routing on
an agent verdict, crash-then-retry recovery
(`workflow-engine/src/__tests__/integration.test.ts`), and the auto-runner loop
itself — stuck-loop guard, stranded-step reaping, attempt caps, human-first steps
(`run/__tests__/route.test.ts`).

**Gaps:**
- No engine-level test for concurrent or fan-out step execution (spawned child workflows are covered only at the action level)
- No test for a workflow whose definition changes between runs while instances are in flight

## Writing engine tests

### Unit tests — use in-memory doubles

```typescript
import { WorkflowEngine } from '../engine/workflow-engine';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core/testing';

const engine = new WorkflowEngine(
  new InMemoryProcessRepository(),
  new InMemoryProcessInstanceRepository(),
  new InMemoryAuditRepository(),
);
```

These are real implementations of the repository interfaces, not mocks — assert
against what they stored, not against call counts. Test one thing per test: a
specific transition condition, a step type routing decision, an expression
evaluation.

### Integration tests — full workflow loop

`packages/workflow-engine/src/__tests__/integration.test.ts` drives a complete
workflow from start to finish and is the file to extend for a new loop scenario:

```typescript
it('propagates an agent step output into instance.variables and feeds it to the next step', async () => {
  // 1. Register definition with 3 steps
  // 2. Start instance via manual trigger
  // 3. Assert first step (agent) executes and output is stored
  // 4. Advance past human step (simulate task completion)
  // 5. Assert final step (agent) receives the earlier output
  // 6. Assert instance status is 'completed'
});
```

These use in-memory repos — no database, no containers. Fast.

### Auto-runner tests — the real orchestrator

The auto-runner at `packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts` is what actually runs in production. It:
- Loads the WorkflowDefinition through the process repository (Postgres in production)
- Loops through steps, decides human vs agent
- Creates HumanTasks for human steps
- Calls the agent step executor for agent steps
- Handles errors, stuck loops, and steps stranded by a deploy or timeout (ADR-0010)

Test this with:
- `vi.mock` over the repositories and `getPlatformServices()` — the existing file shows the shape
- A mocked agent step executor (don't actually run agents)
- `next/server`'s `after()` captured so the test can await the background pass
- Assert: correct HumanTasks created, correct step transitions, correct final state

### What to test when adding features

| Change | Tests to write |
|--------|---------------|
| New step type or executor | Unit test in `workflow-engine/src/__tests__/step-executor.test.ts` |
| New transition condition | Unit test in `workflow-engine/src/engine/__tests__/transition-resolver.test.ts` |
| New expression syntax | Unit test in `workflow-engine/src/expressions/__tests__/expression-evaluator.test.ts` |
| New trigger type | Unit test in `workflow-engine/src/triggers/__tests__/` |
| New plugin | Unit test in `agent-runtime/src/plugins/__tests__/` |
| New API endpoint | Handler test in `platform-api/src/handlers/<domain>/__tests__/`, then the L3 |
| Change to auto-runner loop | Add a case to `run/__tests__/route.test.ts` |
| Change to step output → next step input | Add a case to `workflow-engine/src/__tests__/integration.test.ts` |

## Modifying existing tests

Same rule as E2E: tests are the source of truth for expected behavior. If an engine test fails, fix the code — not the test. Only modify a test when the behavior intentionally changed, and state it explicitly in the PR.
