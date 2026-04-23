---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [plugin, claude-code, agent-runtime, container]
---

**Default container plugin. Runs Claude Code in Docker for agent steps. Registered as `claude-code-agent`. `MOCK_AGENT=true` → `MockClaudeCodeAgentPlugin`.**

## How it fits

- Subclass of `BaseContainerAgentPlugin` in [`agent-runtime`](../packages/agent-runtime.md). See [plugin-dispatch](../../concepts/plugin-dispatch.md).
- Registered by `getPlatformServices()` in [`platform-ui`](../packages/platform-ui.md).
- Subclass must implement: `getAgentCommand()`, `getMockDockerArgs()`, `parseAgentOutput()`.
- Spawning: [`LocalDockerSpawnStrategy`](../../concepts/docker-spawn-strategies.md) by default. `REDIS_URL` set → `QueuedDockerSpawnStrategy`.

## I/O contract

- Input: `AgentContext` — step input, config, resolved MCP (see [mcp-resolution](../../concepts/mcp-resolution.md)), workflow secrets.
- Output: emit exactly one `result` event conforming to `AgentOutputEnvelopeSchema`. Must include `confidence` (0.0–1.0) + `confidence_rationale`. `AgentRunner` validates vs `step.confidenceThreshold` → fires fallback if below.

## Relationships

- Registered in: [`platform-ui`](../packages/platform-ui.md).
- Inherits from: [`agent-runtime`](../packages/agent-runtime.md) `BaseContainerAgentPlugin`.
- Used by: any step with `type: agent` + `agent: claude-code-agent`.

## Sources

- `packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
