---
status: accepted
audience: engineers
last_reviewed: 2026-08-19
---

# ADR-0018: Fan-out over sub-graphs is child workflows; the engine stays linear

> **Status: Implemented.** Shipped as `action.kind: 'spawn'` in
> [`packages/core-actions/src/handlers/spawn.ts`](../../packages/core-actions/src/handlers/spawn.ts).
> Reference consumer: [`apps/team-pulse`](../../apps/team-pulse/).

**Date:** 2026-05-26 (recorded retroactively 2026-08-19)
**Deciders:** Filip Stachura
**Issue:** [#521](https://github.com/Appsilon/mediforce/issues/521)

## Context

Workflows need to fan out: dispatch one unit of work per item in a list and
carry on. Backlog-triage did this with an inline script that hand-built
`fetch('/api/processes', ...)` calls — not declarative (the intent is invisible
to WD validation), fragile (hardcoded base URL, manual `X-Api-Key`, bespoke
error accumulation copied per workflow), and opaque to the engine, which had no
notion that one run had started another.

The engine tracks a **single `currentStepId`** per instance. Any fan-out design
either preserves that or rewrites it.

## Decision

Fan-out spawns **child workflow runs**. `action.kind: 'spawn'` takes one or
more targets, and its `forEach` field expands a single target template once per
element of an interpolated array. Each child is a full Workflow Definition with
its own multi-step graph, its own version, and its own audit trail. The parent
engine stays linear.

`forEach` lives on the spawn action's config, **not** on `WorkflowStepSchema`.

## Considered options

- **(a) `forEach` on `WorkflowStepSchema`** — the engine repeats one step N
  times. Simple, but it can only iterate a *single* step; a multi-step unit of
  work (email → human input → validate) is inexpressible.
- **(b) True parallel branches** — `currentStepId` → `currentStepIds[]`, a full
  DAG engine. Rewrites the engine's fundamentals; months of work.
- **(c) Inline sub-workflow** (Step Functions `Map` style) — `forEach` +
  `subSteps` on one step. Engine-in-engine complexity.

Child workflows match how Temporal (child workflows), Step Functions (`Map`
over a sub-state-machine) and BPMN (multi-instance sub-process) all handle
fan-out over sub-graphs. In a pharma context the separate child WD is a
feature, not overhead: independently reusable, versioned and auditable.

`forEach` stays spawn-specific because iteration is spawn-specific — `email`
and `http` do not need it, and if one ever did, the answer is to wrap it in a
child workflow and spawn that N times.

## Consequences

- **Parent → child is a first-class link.** Children carry
  `parentInstanceId` on `ProcessInstanceSchema` plus `triggeredBy: 'spawn'`, so
  `createdBy` keeps meaning "a person" and parent→child queries need no string
  parsing. There is deliberately no reciprocal `childInstanceIds` array — that
  would be an unbounded column and a second write per spawn; children are found
  by querying `parentInstanceId`.
- **The join is manual.** `spawn` returns immediately, and a `wait` step's
  `condition` sees only the *parent's own* variables — it cannot observe child
  status. The shipped pattern is deadline-only wait, then a script step
  collects results by `spawned[].instanceId`, tolerating children that never
  finished. "Wait until all children complete" does not exist; closing the gap
  needs either child→parent write-back or a child-status query in the heartbeat
  sweep, tracked in [#1215](https://github.com/Appsilon/mediforce/issues/1215).
- **Fan-out is sequential and capped** at 50 children per step execution.
  `Promise.all` would put concurrent write pressure on the storage backend; a
  configurable concurrency parameter is deferred until something needs it.
- **Spawning is same-namespace.** CRO-to-sponsor use cases may need
  cross-namespace spawn with explicit permission grants later.

The runtime surface — config fields, output shape, interpolation roots, caps —
is documented in
[`reference/workflow-capabilities.md`](../reference/workflow-capabilities.md)
and [`packages/core-actions/README.md`](../../packages/core-actions/README.md).
