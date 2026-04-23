---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [plugin, claude-code, agent-runtime, container]
---

**Built-in container plugin that runs Claude Code inside a Docker image to execute an agent step. Registered in `PluginRegistry` under `claude-code-agent`.**

## Purpose

Default container-backed agent. Assembles a prompt from the step's skill file + custom prompt + previous outputs + confidence instructions, spawns Claude Code in a Docker container (local or queued), extracts the emitted output envelope. `MOCK_AGENT=true` swaps it for `MockClaudeCodeAgentPlugin` which returns fixtures without running the CLI.

## How it fits

- Concrete subclass of [`BaseContainerAgentPlugin`](../../concepts/plugin-dispatch.md) in [`agent-runtime`](../packages/agent-runtime.md).
- Registered by `getPlatformServices()` in [`platform-ui`](../packages/platform-ui.md).
- Subclass responsibilities: `getAgentCommand()`, `getMockDockerArgs()`, `parseAgentOutput()`.
- Spawning: delegates to [`LocalDockerSpawnStrategy`](../../concepts/docker-spawn-strategies.md) by default, or `QueuedDockerSpawnStrategy` when `REDIS_URL` is set.

## Input / output contract

- Input: `AgentContext` with step input, config, resolved MCP, workflow secrets.
- Output: must emit a `result` event conforming to `AgentOutputEnvelopeSchema`, including `confidence` (0.0–1.0) and `confidence_rationale`. `AgentRunner` validates `confidence` against the step's `confidenceThreshold` and fires a fallback if the threshold isn't met.

## Relationships

- Registered in: [`platform-ui`](../packages/platform-ui.md).
- Inherits from: [`agent-runtime`](../packages/agent-runtime.md) `BaseContainerAgentPlugin`.
- Used by: any workflow step with `type: agent` and `agent: claude-code-agent`.

## Sources

- `packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
