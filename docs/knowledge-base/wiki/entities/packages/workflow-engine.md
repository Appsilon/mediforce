---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [package, workflow-engine, orchestration]
---

**Process instance orchestrator — step execution, transition routing, review tracking, trigger handling, and expression evaluation.**

## Purpose

Runs the workflow loop. Given a `ProcessInstance`, it advances steps, routes transitions via a when-expression DSL, tracks review verdicts, validates step graphs, and dispatches manual / webhook / cron triggers. Stateless by design — state lives in repositories injected from `platform-core`.

## Dependencies

- Internal: [`platform-core`](./platform-core.md)
- External: `zod`

## Key exports

- **Engine**: `WorkflowEngine` (main orchestrator — advance / pause / resume / abort), `StepExecutor`, `ReviewTracker`.
- **Routing**: `resolveTransitions`, `TransitionValidationError`, `NoMatchingTransitionError`.
- **Expressions**: `evaluateExpression` (see [expression-evaluator concept](../../concepts/expression-evaluator.md)).
- **Triggers**: `ManualTrigger`, `WebhookTrigger`, `CronTrigger`, `TriggerHandler`, `validateCronSchedule`, `isDue`.
- **Graph validation**: `validateStepGraph` (DAG + cycle checks).
- **Errors**: `StepFailureError`, `RoutingError`, `InvalidTransitionError`, `MaxIterationsExceededError`.

## Key internal modules

- `src/engine/` — `workflow-engine.ts` (main loop, 600+ lines), `step-executor.ts`, `transition-resolver.ts`, `errors.ts`.
- `src/expressions/` — custom when-expression evaluator (`${variables.field} == "value"` DSL).
- `src/graph/` — step graph validator.
- `src/review/` — `ReviewTracker` (verdict accumulation, decision finalisation).
- `src/triggers/` — manual / webhook / cron handlers.
- `src/__tests__/` — engine integration tests (see [`docs/ENGINE-TESTING.md`](../../../ENGINE-TESTING.md)).

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md), [`platform-infra`](./platform-infra.md).
- Depends on: [`platform-core`](./platform-core.md).

## Sources

- `packages/workflow-engine/src/index.ts`
- `packages/workflow-engine/src/engine/workflow-engine.ts`
- `packages/workflow-engine/src/engine/transition-resolver.ts`
- `AGENTS.md` → "Key architectural patterns"
- `docs/ENGINE-TESTING.md`
