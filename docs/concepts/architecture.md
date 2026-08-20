---
status: living
audience: engineers
last_reviewed: 2026-08-19
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
