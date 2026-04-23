---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [plugin, example, reference]
---

**Reference `AgentPlugin` implementation. 50-line template. Copy-paste start for new plugins.**

## Lifecycle

1. `initialize(context)` — store `AgentContext`.
2. `run(emit)` — emit events. Exactly one `result` event with `AgentOutputEnvelope`.
3. Autonomy handling (thresholds, escalations) applied by `AgentRunner` **after** `run` returns. Plugin does not implement autonomy.

See [plugin-dispatch](../../concepts/plugin-dispatch.md) for full flow.

## Relationships

- Depends on: [`agent-runtime`](../packages/agent-runtime.md).
- Not registered — consumed from tests / ad-hoc scripts.

## Sources

- `packages/example-agent/src/index.ts`
- `packages/example-agent/src/example-agent.ts`
