---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, expression, dsl, transitions, workflow-engine]
---

**Custom DSL for transition when-expressions — e.g. `${variables.field} == "value"`. Evaluated by `evaluateExpression()` in `workflow-engine`. Not JavaScript eval, not JSONata — a small in-house DSL.**

## Purpose

Transitions in a `WorkflowDefinition` carry an optional `when` expression that decides whether the transition fires. The DSL is deliberately narrow — variable reads, comparisons, boolean combinators — to keep audit/review simple and sidestep eval-style injection risks.

## Where it lives

- `packages/workflow-engine/src/expressions/expression-evaluator.ts` — the evaluator.
- `packages/workflow-engine/src/engine/transition-resolver.ts` — the caller; uses it in `resolveTransitions()`.
- Tests: `packages/workflow-engine/src/expressions/__tests__/`.

## Before adding a DSL feature

- Check the existing evaluator — new constructs should go there, not parallel implementations in UI or plugin code.
- Transition logic should never bypass `resolveTransitions()`. If an expression can't express what you need, extend the DSL rather than routing around it.

## Context

The evaluator reads from the step's `variables` object (the accumulated workflow context). Mutation happens in `StepExecutor`, not in expressions — expressions are pure.

## Used by

- [`workflow-engine`](../entities/packages/workflow-engine.md) — every `WorkflowDefinition` transition with a `when` clause.

## Sources

- `packages/workflow-engine/src/expressions/expression-evaluator.ts`
- `packages/workflow-engine/src/engine/transition-resolver.ts`
