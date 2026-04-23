---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [plugin, example, reference]
---

**Reference implementation of the `AgentPlugin` interface — a 50-line template showing the event-emission pattern.**

## Purpose

Smallest possible working plugin. Demonstrates the two-method lifecycle: `initialize(context)` to capture step input / config / LLM client, then `run(emit)` to emit `status`, `annotation`, and `result` events. Copy-paste starting point when writing a new plugin. Does not register itself — it's consumed from tests or ad-hoc scripts.

## Lifecycle reminder

1. `initialize(context)` — store `AgentContext`.
2. `run(emit)` — emit events. Must emit exactly one `result` event with an `AgentOutputEnvelope`.
3. Autonomy handling (threshold checks, escalations) is applied by [`AgentRunner`](../packages/agent-runtime.md) **after** `run` returns, not inside the plugin.

## Relationships

- Depends on: [`agent-runtime`](../packages/agent-runtime.md).

## Sources

- `packages/example-agent/src/index.ts`
- `packages/example-agent/src/example-agent.ts`
