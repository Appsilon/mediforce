---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [plugin, opencode, agent-runtime, ollama, local-llm]
---

**Built-in container plugin that runs OpenCode as the agent. Supports local Ollama and cloud providers through the same Docker envelope. Registered as `opencode-agent`.**

## Purpose

Alternative to [`claude-code-agent`](./claude-code-agent.md) for steps that should use OpenCode (e.g. local Ollama runs during dev, or swapping providers for cost/latency). Same container-plugin envelope, different CLI inside.

## How it fits

- Concrete subclass of `BaseContainerAgentPlugin` in [`agent-runtime`](../packages/agent-runtime.md).
- Registered by `getPlatformServices()` in [`platform-ui`](../packages/platform-ui.md).
- Used by workflow steps that pick `agent: opencode-agent`.

## Relationships

- Registered in: [`platform-ui`](../packages/platform-ui.md).
- Inherits from: [`agent-runtime`](../packages/agent-runtime.md) `BaseContainerAgentPlugin`.

## Sources

- `packages/agent-runtime/src/plugins/opencode-agent-plugin.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
