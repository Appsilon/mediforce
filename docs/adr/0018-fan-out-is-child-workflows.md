---
status: accepted
audience: engineers
last_reviewed: 2026-10-20
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
- **The join is a child-status query, woken by an event.** `spawn` returns
  immediately; a following `wait` with `condition: "children.allCompleted == true"`
  resolves once every child has completed or failed. `resumeWait` reads the
  children by `parentInstanceId` and exposes the counts under a reserved
  `children` root
  ([#1215](https://github.com/Appsilon/mediforce/issues/1215)), so the child's
  state is never copied into the parent. What triggers the check is an event,
  not the clock: when the auto-runner stops driving a run, a task or cowork session
  finishes it, or it is cancelled, `settleRunWaits` re-checks the wait of its parent and of the run itself — the
  latter because a run can park on its wait after every child already ended, so
  no later child would ever wake it. The heartbeat sweep stays, resolving plain
  `duration` / `deadline` waits and backstopping a missed event. N children
  ending at once do race to resume the parent, so the resume is a compare-and-set
  (`updateIfPaused`): exactly one caller wins and kicks the run. Postgres had
  never persisted the parent link, so this needed migration
  `0085_process_instance_parent` (two columns plus a partial index); children
  spawned before it have no link and count as zero children. A mistyped
  `children.*` field throws and is logged rather than silently waiting out the
  deadline. The wait keeps its deadline: when it wins, the run resumes with
  whatever finished.
- **Results are read, not written back.** The `collect` action returns
  `{ children: [{ instanceId, definitionName, status, error, output }], … }`
  for the runs this run spawned, with `output` the child's `variables[step]` (or
  all its variables). Failed and unfinished children are listed too; the next
  step decides what a partial result means. Like the join, it queries the
  children on demand instead of having them push data into the parent.
- **Fan-out is sequential and capped** at 50 children per step execution.
  `Promise.all` would put concurrent write pressure on the storage backend; a
  configurable concurrency parameter is deferred until something needs it.
- **Spawning is same-namespace.** CRO-to-sponsor use cases may need
  cross-namespace spawn with explicit permission grants later.

The runtime surface — config fields, output shape, interpolation roots, caps —
is documented in
[`reference/workflow-capabilities.md`](../reference/workflow-capabilities.md)
and [`packages/core-actions/README.md`](../../packages/core-actions/README.md).
