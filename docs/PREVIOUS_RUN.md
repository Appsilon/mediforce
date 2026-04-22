# Previous Run Outputs (carry-over across runs)

Some workflows need state between runs: an SFTP monitor remembers the last
seen file timestamp; a change-feed watcher remembers the last processed
cursor. The platform supports this with a small, explicit mechanism.

## How it works

A workflow declares which step outputs of the **current run** should be
exposed to the **next run**, under chosen names:

```yaml
name: sftp-monitor
steps:
  - id: scan
    executor: script
  - id: done
    type: terminal
    executor: human
transitions:
  - { from: scan, to: done }
triggers:
  - { type: cron, name: hourly, schedule: '0 * * * *' }

inputForNextRun:
  - stepId: scan
    output: cursor
    as: cursor
```

At run start, the engine:

1. Finds the **last successfully completed run** of the same workflow name
   (across versions — chain is per workflow name, not per version).
2. For each `inputForNextRun` entry, reads the declared output from the
   predecessor's step execution (`getLatestStepExecution`).
3. Stores the result on the new `ProcessInstance.previousRun` (a plain
   object) and records the source run in `previousRunSourceId`.

The step sees the carry-over in its execution context as `previousRun`:

- Agent plugins: included in the prompt under `## Previous Run Outputs`.
- Script plugin (`ScriptContainerPlugin`): written to
  `/output/previous_run.json` inside the container. The script reads it
  alongside `input.json`. Always a JSON object — `{}` on first run.

### First-run and failure handling

- First run ever → `previousRun` is `{}`.
- Predecessor failed → skipped; resolver takes the next most-recent
  successful run. If none exist, `previousRun` is `{}`.
- Predecessor's step didn't produce the declared output → that key is
  omitted (the object simply doesn't contain it).

Steps that read `previousRun` **must handle the empty-object case explicitly**.
A cursor-based monitor, for example, would process everything newer than
`previousRun.cursor ?? <beginning-of-time>`.

## Validation

`WorkflowDefinitionSchema` rejects definitions where:

- an `inputForNextRun[i].stepId` does not match any `steps[].id`
- an `inputForNextRun[i].as` is duplicated within the block

The `output` key itself is not validated — step outputs are dynamic, and a
missing key at runtime simply means the key is omitted from `previousRun`.

## Why this shape

- **No new storage system.** Step outputs already exist per run. Carry-over
  is a read of the last successful run's outputs — nothing new is persisted
  beyond what the engine already writes.
- **No atomic RMW or concurrency concern.** Each run reads "last successful"
  at start and writes its own outputs. Two runs starting simultaneously read
  the same predecessor and produce independent outputs.
- **Free history.** Every historical value is visible — it's just the step
  execution record on that past `ProcessInstance`.
- **Workflow-level contract.** The `inputForNextRun` block is the full
  surface of what the workflow exports to its future self. Adding or removing
  an entry changes the contract in one place.

## Operational guidance

- **Keep carried state bounded.** A timestamp is cheap; a log is not. Watch
  for linear growth in what you carry — if it can grow unboundedly with
  time, cap it.
- **Cursor + safety net.** For monitor-style workflows, carry both a
  high-water-mark timestamp (for efficiency) and a small bounded set of
  recent hashes (to catch backdated/duplicated arrivals without replaying
  the whole history).

## What is NOT done

- No template syntax like `${previousRun.cursor}` in `stepParams`. The step
  reads `previousRun` directly from its runtime context (agent prompt or
  `/output/previous_run.json`).
- No cross-workflow chains. Each workflow name owns its own chain.
- No schema enforcement on carried values. The shape is whatever the step
  writes — the same rules as for any step output.
- No operator reset mechanism in this PR. If you need to start a workflow's
  chain from scratch, follow up with a dedicated issue — the simplest lever
  would be a small admin action that marks historical completed runs as
  `deleted`, which the resolver already skips.

## Related artefacts

- Schema: `WorkflowDefinition.inputForNextRun`
  (`packages/platform-core/src/schemas/workflow-definition.ts`)
- Instance fields: `ProcessInstance.previousRun`, `previousRunSourceId`
  (`packages/platform-core/src/schemas/process-instance.ts`)
- Engine resolver: `WorkflowEngine.resolvePreviousRunOutputs`
  (`packages/workflow-engine/src/engine/workflow-engine.ts`)
- Firestore index: composite on `(definitionName, status, updatedAt)` in
  `firestore.indexes.json`. **Deploying this feature requires creating that
  index.**
- Integration tests:
  `packages/workflow-engine/src/__tests__/previous-run-outputs.test.ts`
