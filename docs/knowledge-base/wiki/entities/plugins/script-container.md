---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [plugin, script-container, agent-runtime, deterministic]
---

**Deterministic script container. No LLM. Registered as `script-container`. Used by [community-digest](../apps/community-digest.md).**

## Why

Some steps need reproducible LLM-free code (data transforms, packaging, API calls). Script container reuses the same spawn + envelope machinery as LLM plugins → homogeneous workflow steps + consistent audit events.

## How it fits

- Subclass of `BaseContainerAgentPlugin` in [`agent-runtime`](../packages/agent-runtime.md). See [plugin-dispatch](../../concepts/plugin-dispatch.md).
- Registered by `getPlatformServices()` in [`platform-ui`](../packages/platform-ui.md).
- Output conforms to `AgentOutputEnvelopeSchema`; `confidence` typically pinned to `1.0` (deterministic).

## Relationships

- Registered in: [`platform-ui`](../packages/platform-ui.md).
- Inherits from: [`agent-runtime`](../packages/agent-runtime.md) `BaseContainerAgentPlugin`.
- Used by: [`community-digest`](../apps/community-digest.md).

## Sources

- `packages/agent-runtime/src/plugins/script-container-plugin.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
