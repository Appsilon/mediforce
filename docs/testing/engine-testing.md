---
status: living
audience: engineers
last_reviewed: 2026-08-19
---

# Workflow engine tests

For engineers changing workflow execution. Use this with
[`e2e-strategy.md`](./e2e-strategy.md): engine and handler tests are fast
in-process coverage; product features also require L3 API E2E coverage.

## Choose the test

| Change | Test location |
|---|---|
| Transition, expression, trigger, or step routing | `packages/workflow-engine/src/**/__tests__/` |
| Role enforcement (`allowedRoles`, workflow `run` / `edit`) | `packages/platform-api/src/handlers/**/__tests__/` — the gate is handler-resident (ADR-0019); the engine runs as the system actor and holds no roles |
| End-to-end engine state change or recovery | `packages/workflow-engine/src/__tests__/integration.test.ts` |
| Plugin behaviour or output parsing | `packages/agent-runtime/src/**/__tests__/` |
| Handler behaviour or Zod contract | `packages/platform-api/src/handlers/**/__tests__/` |
| Production run loop | `packages/platform-ui/src/app/api/processes/[instanceId]/run/__tests__/route.test.ts` |

Use the closest existing test as the template. Test behaviour and persisted
state, not mock call counts. Keep engine and handler tests independent of a
database, containers, and real agents.

## Engine tests

Use the in-memory repositories from `@mediforce/platform-core` to construct a
real `WorkflowEngine`. A unit test covers one decision; extend
`integration.test.ts` when a scenario crosses steps, including output
propagation, retry, recovery, or human-task completion.

```typescript
const engine = new WorkflowEngine(
  new InMemoryProcessRepository(),
  new InMemoryProcessInstanceRepository(),
  new InMemoryAuditRepository(),
);
```

## Run-route tests

The run route is the production orchestrator. Test a change there when it
affects dispatch, task/session creation, retries, recovery, or loop guards.
Mock services and executors; capture Next.js `after()` and await the callback
before asserting the resulting state.

## Run

`pnpm test:unit` runs the default Vitest suite, including these tests. Run the
focused file first while developing, then the full command. The external and
action-flow suites use separate commands and are not part of this guide.

Tests describe the expected behaviour. Change one only when the intended
behaviour changes, and state that in the PR.
