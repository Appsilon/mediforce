# Workflow Engine Testing Strategy

## Principles

1. **Unit test every decision point** — transitions, expression evaluation, step routing, RBAC checks. These are pure functions with in-memory doubles, they run in milliseconds.
2. **Integration test the full loop** — trigger → step execution → transition → next step → completion. This is where the real bugs hide: wrong transition taken, state not persisted, agent output not fed to next step.
3. **Test the auto-runner separately** — the auto-runner (`api/processes/[instanceId]/run/route.ts`) is the orchestrator that ties engine + plugins + Firestore together. It needs its own integration tests.

## Test layers

| Layer | What | Where | Speed |
|-------|------|-------|-------|
| **Contract (`platform-api`)** | Pure handler behavior + Zod I/O shapes, against in-memory repos | `packages/platform-api/src/handlers/**/__tests__/` | <1s |
| **Unit** | Transitions, expressions, RBAC, triggers, step routing | `packages/workflow-engine/src/__tests__/` | <1s |
| **Plugin unit** | Individual plugin init, run, output parsing | `packages/agent-runtime/src/plugins/__tests__/` | <1s |
| **Engine integration** | Full workflow loop with in-memory repos | `packages/workflow-engine/src/__tests__/` | <1s |
| **Auto-runner integration** | HTTP endpoint with emulator Firestore | `packages/platform-ui/src/app/api/__tests__/` | ~5s |

### Contract tests (`platform-api`)

The `platform-api` package extracts API endpoint logic out of `platform-ui` into pure handler functions that take `(input, deps)` and return a typed result. A contract is a pair of Zod schemas (input + output) per endpoint — the schema is the source of truth for the API shape; the handler conforms by TypeScript, not by runtime re-parse.

- **Placement**: tests live in `packages/platform-api/src/handlers/<domain>/__tests__/` as two siblings per endpoint — `contract.test.ts` (schema-only assertions) and `<handler-name>.test.ts` (behaviour with in-memory repos).
- **Dependencies**: tests import in-memory repos directly from `@mediforce/platform-core/testing` — no mocks, no HTTP, no Firestore, no dev server.
- **When to write one**: any time a new API endpoint is added or an existing one is migrated out of `platform-ui`, write the contract + handler tests **before** wiring the Next.js route adapter.
- **Canonical example**: `packages/platform-api/src/handlers/tasks/__tests__/` — covers the `listTasks` handler and its Zod contract that back `GET /api/tasks`.

The Next.js route becomes a thin adapter: `createRouteAdapter` (in `packages/platform-ui/src/lib/route-adapter.ts`) handles auth, input parsing, Zod validation → 400, and error sanitisation → 500. The route file itself is ~15 lines of pure declaration.

### Boundary rules (enforced by `packages/platform-ui/src/test/api-boundaries.test.ts`)

Two conventions keep the split from rotting — encoded as a Vitest test that scans source files, in the same structural-assertion style as `api-auth-coverage.test.ts`:

1. **UI import boundary.** Anything in `packages/platform-ui/src/` may only import `@mediforce/platform-api/contract` (types and schemas). Handler imports are reserved for the adapter surface:
   - `src/app/api/**/route.ts` — Next.js route handlers
   - `src/app/actions/*.ts` — server actions
   - `src/lib/route-adapter.ts` — the adapter helper itself
2. **Handler test presence.** Every file in `packages/platform-api/src/handlers/` (except `index.ts`) must have a sibling `__tests__/<name>.test.ts`. Contract tests (`__tests__/contract.test.ts`) are encouraged per domain but not enforced — the handler behaviour test is.

Runs as part of `pnpm test` — no separate CI job.

### Test-name prefixes

Tests in `workflow-engine`, `platform-api`, and `platform-ui` adopt a lightweight tag convention in the `it('…')` string, so `pnpm test -t '\[ERROR\]'` slices by concern at a glance:

| Prefix | What it covers |
|---|---|
| `[DATA]` | Happy-path behaviour — correct output for valid input, filtering, transformations, persistence |
| `[ERROR]` | Failure paths — Zod rejections, 400/500 responses, invariant violations, expected exceptions |
| `[AUTH]` | Authorisation / middleware behaviour (rare — most auth is covered once in `api-auth-coverage.test.ts`) |

The prefix is optional — use it when a file mixes data-path and error-path tests, skip it when every test in a file is the same category. Do not invent new prefixes without adding a row here.

## What exists today

**workflow-engine** (12 test files):
- Engine loop, step execution, transitions, expression evaluator
- Review tracker, graph validator, RBAC
- Manual trigger, webhook trigger, cron trigger

**agent-runtime** (8 test files):
- Agent runner, fallback handler, plugin registry
- Claude Code, OpenCode, ScriptContainer plugins (unit + some e2e)

**Gaps:**
- No integration test for a full workflow: start → agent step → human step → agent step → complete
- No test that agent output feeds into next step's input via `variables`
- No test for the auto-runner loop (the actual orchestrator in production)
- No error recovery tests (agent crashes → instance should fail gracefully)
- No concurrent step execution scenarios

## Writing engine tests

### Unit tests — use in-memory doubles

```typescript
import { WorkflowEngine } from '../engine/workflow-engine';
import { InMemoryProcessRepository, InMemoryInstanceRepository } from '@mediforce/platform-core/testing';

const engine = new WorkflowEngine(
  new InMemoryProcessRepository(),
  new InMemoryInstanceRepository(),
  new InMemoryAuditRepository(),
);
```

Test one thing per test: a specific transition condition, a step type routing decision, an expression evaluation.

### Integration tests — full workflow loop

Test a complete workflow from start to finish:

```typescript
test('3-step workflow: agent → human → agent completes', async () => {
  // 1. Register definition with 3 steps
  // 2. Start instance via manual trigger
  // 3. Assert first step (agent) executes and output is stored
  // 4. Advance past human step (simulate task completion)
  // 5. Assert final step (agent) executes
  // 6. Assert instance status is 'completed'
  // 7. Assert variables contain outputs from all steps
});
```

These use in-memory repos — no Firestore, no emulators. Fast.

### Auto-runner tests — the real orchestrator

The auto-runner at `api/processes/[instanceId]/run/route.ts` is what actually runs in production. It:
- Loads WorkflowDefinition from Firestore
- Loops through steps, decides human vs agent
- Creates HumanTasks for human steps
- Calls `executeAgentStep` for agent steps
- Handles errors and stuck loops

Test this with:
- Mocked Firestore (or emulator)
- Mocked `executeAgentStep` (don't actually run agents)
- Assert: correct HumanTasks created, correct step transitions, correct final state

### What to test when adding features

| Change | Tests to write |
|--------|---------------|
| New step type or executor | Unit test in `workflow-engine/__tests__/step-executor.test.ts` |
| New transition condition | Unit test in `engine/__tests__/transition-resolver.test.ts` |
| New expression syntax | Unit test in `expressions/__tests__/expression-evaluator.test.ts` |
| New plugin | Unit test in `agent-runtime/plugins/__tests__/` |
| Change to auto-runner loop | Integration test with mocked deps |
| Change to step output → next step input | Integration test verifying `variables` propagation |

## Modifying existing tests

Same rule as E2E: tests are the source of truth for expected behavior. If an engine test fails, fix the code — not the test. Only modify a test when the behavior intentionally changed, and state it explicitly in the PR.
