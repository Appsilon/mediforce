---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [package, workflow-engine, orchestration]
---

**Process instance orchestrator. Step execution, transition routing, review tracking, triggers, when-expression DSL.**

## Purpose

Runs the workflow loop. Given `ProcessInstance`: advance steps, route transitions, track review verdicts, validate step graphs, dispatch triggers. Stateless — state lives in repos from `platform-core`.

## Dependencies

- Internal: [`platform-core`](./platform-core.md).
- External: `zod`.

## Key exports

- **Engine**: `WorkflowEngine` (main — advance/pause/resume/abort), `StepExecutor`, `ReviewTracker`.
- **Routing**: `resolveTransitions`, `TransitionValidationError`, `NoMatchingTransitionError`.
- **Expressions**: `evaluateExpression` → see [expression-evaluator](../../concepts/expression-evaluator.md).
- **Triggers**: `ManualTrigger`, `WebhookTrigger`, `CronTrigger`, `TriggerHandler`, `validateCronSchedule`, `isDue`.
- **Graph**: `validateStepGraph` (DAG + cycle check).
- **Errors**: `StepFailureError`, `RoutingError`, `InvalidTransitionError`, `MaxIterationsExceededError`.

## Key internal modules

- `src/engine/` — `workflow-engine.ts` (600+ lines), `step-executor.ts`, `transition-resolver.ts`, `errors.ts`.
- `src/expressions/` — when-DSL evaluator (`${variables.field} == "value"`).
- `src/graph/` — graph validator.
- `src/review/` — `ReviewTracker`.
- `src/triggers/` — manual / webhook / cron.
- `src/__tests__/` — engine integration tests (see `docs/ENGINE-TESTING.md`).

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md), [`platform-infra`](./platform-infra.md).
- Depends on: [`platform-core`](./platform-core.md).

## Sources

- `packages/workflow-engine/src/index.ts`
- `packages/workflow-engine/src/engine/workflow-engine.ts`
- `packages/workflow-engine/src/engine/transition-resolver.ts`
- `AGENTS.md` → "Key architectural patterns"
- `docs/ENGINE-TESTING.md`
