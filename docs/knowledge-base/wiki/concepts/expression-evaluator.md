---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, expression, dsl, transitions, workflow-engine]
---

**Custom DSL for transition `when` clauses. E.g. `${variables.field} == "value"`. Evaluated by `evaluateExpression()` in `workflow-engine`. Not JS eval. Not JSONata. Small in-house DSL.**

## Purpose

Transitions in a `WorkflowDefinition` carry optional `when` expression. Narrow DSL on purpose — variable reads, comparisons, boolean combinators — keeps audit/review simple. Sidesteps eval-style injection risks.

## Where

- Evaluator: `packages/workflow-engine/src/expressions/expression-evaluator.ts`.
- Caller: `packages/workflow-engine/src/engine/transition-resolver.ts` — uses it in `resolveTransitions()`.
- Tests: `packages/workflow-engine/src/expressions/__tests__/`.

## Before adding DSL features

- Check the existing evaluator. New constructs go there. Don't write parallel evaluators in UI / plugin code.
- Transition logic never bypasses `resolveTransitions()`. If an expression can't express what you need, extend the DSL instead of routing around it.

## Context

Reads from step's `variables` (accumulated workflow context). Mutation happens in `StepExecutor`, not in expressions. Expressions are pure.

## Used by

- [`workflow-engine`](../entities/packages/workflow-engine.md) — every `WorkflowDefinition` transition with a `when` clause.

## Sources

- `packages/workflow-engine/src/expressions/expression-evaluator.ts`
- `packages/workflow-engine/src/engine/transition-resolver.ts`
