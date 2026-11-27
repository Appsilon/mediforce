---
status: living
audience: engineers
last_reviewed: 2026-11-27
---

# Architecture

How Mediforce is put together: the model the product is built on, the vocabulary
for agent autonomy, and the package graph. For *why* the product exists see
[`vision.md`](vision.md); for the runtime shape of an API request see
[`../reference/api-architecture.md`](../reference/api-architecture.md); for what
a single package does, read that package's own `README.md`.

## The model

Workflows are decomposed into **steps**, and each step can be performed by a
human, an AI agent, a script, or a built-in action — with configurable autonomy,
escalation, and auditability. A Workflow is the named reusable process; an
immutable Workflow Definition is one version; a Workflow Run executes one
Definition.

### Steps — the atoms of work

A step is the smallest unit of work. It declares its executor, inputs, access
constraints, and possible transitions. Steps can be sequenced, branched, and
looped — including review loops where a reviewer sends work back for revision,
the most common pattern in regulated environments.

### Workflows — reusable processes

A Workflow is a named, reusable process with versioned Workflow Definitions.
Each Definition is a runnable graph of steps; a Namespace can own many
Workflows and Runs.

A workflow can also call other workflows. A `spawn` action starts one child run per item and a `wait` step joins them when they finish; a `run-workflow` action runs a single child and hands its result back. Either way the engine itself stays linear: fan-out is child runs, not a sub-graph inside one run ([ADR-0018](../adr/0018-fan-out-is-child-workflows.md)).

### Configuration — who does what

Each Namespace configures Workflows for its own context. Related Definitions
can express different control modes: a large pharma company might require human
review on every agent step, while a smaller biotech might allow autonomous
advance.

## Agent autonomy

The design question isn't "should we use AI?" — it's "how much autonomy should
the AI have on this step?"

The answer is a step's **Control Mode** — the picker shown in the workflow
designer, and the one name for this concept:

| Mode | What the agent does | Human involvement |
|------|--------------------|--------------------|
| **CM0 No agent** | Nothing — a human, script, or built-in action runs the step | Full manual control |
| **CM1 Assist** _(coming soon)_ | Reviews the result after the human has done the work | Human leads |
| **CM2 Cowork** | Works alongside the human in real time, via chat or voice | Continuous |
| **CM3 Human review** | Completes the step, then submits it | Human approves or sends back before the run proceeds |
| **CM4 Autonomous agent** | Completes the step and the run advances | Human reviews after the fact via the audit trail |

At any mode, an agent can signal uncertainty and escalate to a human. This isn't
a failure mode — it's how the system maintains safety.

**Control Mode is the only vocabulary for this.** It is a UI concept over two
separate schema fields — `executor` and `autonomyLevel` (`L0`–`L4`) — which are
storage detail, not names to use in conversation. The CM numbers and the L
numbers are unrelated axes.
[ADR-0014](../adr/0014-control-mode-ui-concept.md) owns the mode-to-shape
mapping and [ADR-0008](../adr/0008-step-executor-model.md) owns the executor
model; the mapping is implemented in
[`control-mode.ts`](../../packages/platform-ui/src/lib/control-mode.ts) and the
fields are defined in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts).

## Catalogs: what a workspace owns once and steps reuse

Four things live in the workspace rather than in any one Workflow Definition, so many workflows can share them and a definition stays small and portable:

- **Agents**, versioned. A step that names an agent is pinned to the version current when it was saved, unless its author chooses to track the latest, so editing the agent never silently changes a saved step.
- **Skills**, which an agent holds and a step can add to ([ADR-0025](../adr/0025-skill-catalog.md), [ADR-0027](../adr/0027-step-adds-catalog-skills.md), [ADR-0028](../adr/0028-retire-file-skills.md)).
- **MCP servers**, which an agent references and a step can only narrow ([ADR-0026](../adr/0026-mcp-servers-live-in-the-catalog.md)).
- **Container images**, keyed on where they were built from ([ADR-0022](../adr/0022-image-catalog.md)).

## Evaluation

Trust in an agent step is earned with evidence kept beside the workflow, not inside it. An Evaluation belongs to one agent step or to one agent, holds Eval Cases and Evaluators, and runs them as budgeted Eval Runs that a person signs off. The result is shown as the step's validation and the version's Verified state; it informs people and never blocks a run. Optimisation compares Variants of the model and prompt on the same cases and can apply the winner as a new version. The design is [ADR-0023](../adr/0023-step-evaluation.md), [ADR-0024](../adr/0024-optimisation.md), [ADR-0029](../adr/0029-agent-evaluation.md) and [ADR-0031](../adr/0031-agent-cases-from-workflow-runs.md); how it works today is [`../reference/step-evaluation.md`](../reference/step-evaluation.md).

## Package layers

Dependencies point one way: toward `platform-core`. Nothing imports
`platform-ui`. Each package's `package.json` is the exact dependency graph; the
layers below are the stable shape to design against.

```
foundation   platform-core
domain       workflow-engine · platform-infra · agent-runtime · core-actions
             mcp-client · container-worker
composition  platform-api
delivery     cli · mediforce-mcp · platform-ui
reference    example-agent (built on agent-runtime + platform-core)
```

Each package's `README.md` is the authority on what it is for and what you must
not do to it; `docs/` covers only what spans more than one package. Directories
under `apps/` are workflow packages built on this platform, not part of the graph.

Two rules the graph enforces in CI: handlers in `platform-api` reach data
through `CallerScope` rather than importing `platform-infra` directly (an
unannotated import fails `no-raw-repo-imports.test.ts`), and every directory
under `packages/` and `apps/` carries a `README.md` (`pnpm check:readmes`).

## Compliance

Every step execution, agent action, and human decision is recorded, along with
who configured the agent, what data it accessed, what it decided, and who
approved. Agents are scoped — they see only the data relevant to their current
task. We're working with compliance professionals toward GxP requirements; this
is an ongoing effort, not something we claim to have solved.

## What's still open

Workflow packaging and sharing, the plugin system for domain-specific
capabilities, and enterprise deployment patterns are all still being explored.
Decisions land in [`../adr/`](../adr/README.md) as they are made; explorations
that haven't been decided sit in [`../research/`](../research/). Every
abstraction earns its place by being needed in more than one concrete use case.
