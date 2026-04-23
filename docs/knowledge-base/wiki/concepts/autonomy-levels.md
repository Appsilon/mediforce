---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [concept, autonomy, agent-runtime, workflow]
---

**5-level scale (L0–L4). How much agent can do before human must intervene. Enforced by `AgentRunner`, not plugins.**

## Levels

| Level | Name | Behavior |
|-------|------|----------|
| L0 | Human-only | No agent. Pure human task. |
| L1 | Agent-assisted | Agent outputs. Human decides. |
| L2 | Human-in-the-loop | Agent acts. Human approves each change. |
| L3 | Periodic review | Agent autonomous. Human reviews in batches. Used by `protocol-to-tfl`. |
| L4 | Fully autonomous | Agent applies changes. No review. |

## In code

- Type: `AutonomyLevel` from [`agent-runtime`](../entities/packages/agent-runtime.md) `src/interfaces/`.
- Field: each `WorkflowDefinition` agent step has `autonomy`. Zod schema in [`platform-core`](../entities/packages/platform-core.md) `src/schemas/workflow-definition.ts`.
- Enforcement: `AgentRunner` (see [plugin-dispatch](./plugin-dispatch.md)) — applies autonomy **after** plugin `result` event. Consults `step.autonomy` + `step.confidenceThreshold` → fires `FallbackHandler` if thresholds miss. Plugins themselves do not implement autonomy.

## Confidence coupling

L3 + L4 pair with `confidenceThreshold` (0.0–1.0). Plugin emits `confidence` + `confidence_rationale` in `AgentOutputEnvelope`. If `confidence < threshold` → `AgentRunner` escalates (human task / retry / cancel) regardless of autonomy.

## Used by

- [`protocol-to-tfl`](../entities/apps/protocol-to-tfl.md) — all agent steps L3.
- Any step in [`platform-ui`](../entities/packages/platform-ui.md) catalog.

## Sources

- `packages/agent-runtime/src/runner/agent-runner.ts`
- `AGENTS.md` → "Autonomy levels"
