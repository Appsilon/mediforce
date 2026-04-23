---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [plugin, script-container, agent-runtime, deterministic]
---

**Built-in container plugin for deterministic scripts — runs a scripted container without calling an LLM. Registered as `script-container`.**

## Purpose

Use when a workflow step needs to execute reproducible, LLM-free code (data transformations, file packaging, API calls). The container still goes through the same spawn + output-envelope machinery as LLM plugins, which keeps workflow steps homogeneous and audit events consistent.

Used by the [`community-digest` app](../apps/community-digest.md) for GitHub data gathering and Discord posting.

## How it fits

- Concrete subclass of `BaseContainerAgentPlugin` in [`agent-runtime`](../packages/agent-runtime.md).
- Registered by `getPlatformServices()` in [`platform-ui`](../packages/platform-ui.md).
- Output still conforms to `AgentOutputEnvelopeSchema`, but `confidence` is typically pinned to `1.0` (deterministic).

## Relationships

- Registered in: [`platform-ui`](../packages/platform-ui.md).
- Inherits from: [`agent-runtime`](../packages/agent-runtime.md) `BaseContainerAgentPlugin`.
- Used by: [`community-digest`](../apps/community-digest.md).

## Sources

- `packages/agent-runtime/src/plugins/script-container-plugin.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
