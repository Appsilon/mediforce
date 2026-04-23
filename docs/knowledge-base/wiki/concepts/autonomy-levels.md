---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, autonomy, agent-runtime, workflow]
---

**Five-level scale (L0–L4) controlling how much agent action is allowed before a human must intervene. Enforced by `AgentRunner`, not by individual plugins.**

## Levels

| Level | Name | Behavior |
|-------|------|----------|
| L0 | Human-only | No agent involvement — step runs as pure human task. |
| L1 | Agent-assisted | Agent produces output, human decides what to do with it. |
| L2 | Human-in-the-loop | Agent acts, human approves each change before it takes effect. |
| L3 | Periodic review | Agent is autonomous; humans review in batches (e.g. daily). Used by `protocol-to-tfl`. |
| L4 | Fully autonomous | Agent applies changes directly, no review. |

## How it shows up in code

- Type: `AutonomyLevel` exported from [`agent-runtime`](../entities/packages/agent-runtime.md) `src/interfaces/`.
- Field: each `WorkflowDefinition` agent step carries an `autonomy` field (Zod schema in [`platform-core`](../entities/packages/platform-core.md) `src/schemas/workflow-definition.ts`).
- Enforcement: [`AgentRunner`](./plugin-dispatch.md) — applies autonomy handling **after** the plugin emits its `result` event. Plugins themselves do not implement autonomy; the runner consults `step.autonomy` + `step.confidenceThreshold` and triggers the [`FallbackHandler`](../entities/packages/agent-runtime.md) when thresholds aren't met.

## Confidence threshold coupling

L3 and L4 typically pair with a `confidenceThreshold` (0.0–1.0). The plugin must emit `confidence` + `confidence_rationale` in its `AgentOutputEnvelope`; if `confidence < threshold`, `AgentRunner` escalates via fallback (human task, retry, or cancel) regardless of autonomy level.

## Used by

- [`protocol-to-tfl`](../entities/apps/protocol-to-tfl.md) — all agent steps at L3.
- Any workflow step in [`platform-ui`](../entities/packages/platform-ui.md) catalog.

## Sources

- `packages/agent-runtime/src/runner/agent-runner.ts`
- `AGENTS.md` → "Autonomy levels"
