---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 2
tags: [plugin, opencode, agent-runtime, ollama, local-llm]
---

**Container plugin running OpenCode. Local Ollama + cloud providers via same Docker envelope. Registered as `opencode-agent`.**

## How it fits

- Alt to [`claude-code-agent`](./claude-code-agent.md) for steps picking `agent: opencode-agent`. Same envelope, different CLI.
- Subclass of `BaseContainerAgentPlugin` in [`agent-runtime`](../packages/agent-runtime.md).
- Registered by `getPlatformServices()` in [`platform-ui`](../packages/platform-ui.md).

## Relationships

- Registered in: [`platform-ui`](../packages/platform-ui.md).
- Inherits from: [`agent-runtime`](../packages/agent-runtime.md) `BaseContainerAgentPlugin`.

## Sources

- `packages/agent-runtime/src/plugins/opencode-agent-plugin.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
