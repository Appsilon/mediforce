---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 5
tags: [package, agent-runtime, plugins, docker]
---

**Agent execution engine — dispatches plugin runs (Claude Code, OpenCode, scripts), enforces autonomy levels, handles fallbacks, manages Docker spawn strategies, binds MCP per step.**

## Purpose

Given an agent step in a workflow, loads the right plugin, assembles its prompt (skill file + custom prompt + previous outputs + confidence instructions), spawns the container (local or queued), validates the emitted `result` envelope against `AgentOutputEnvelopeSchema`, and applies fallbacks (timeout, low confidence, error). Provides the `AgentPlugin` interface that all agents implement.

## Dependencies

- Internal: [`platform-core`](./platform-core.md) (required); `@mediforce/agent-queue` (optional, activated when `REDIS_URL` is set)
- External: `firebase-admin`, `zod`

## Key exports

- **Interfaces**: `AgentPlugin`, `AgentContext`, `WorkflowAgentContext`, `AutonomyLevel` (see [autonomy-levels concept](../../concepts/autonomy-levels.md)), `LlmClient`, `LlmResponse`.
- **Plugin base**: `BaseContainerAgentPlugin` (1400+ lines — Docker/CLI spawning, volume mounts, git workflows, MCP config write, output extraction).
- **Concrete plugins**: [`ClaudeCodeAgentPlugin`](../plugins/claude-code-agent.md), [`OpenCodeAgentPlugin`](../plugins/opencode-agent.md), [`ScriptContainerPlugin`](../plugins/script-container.md), `MockClaudeCodeAgentPlugin`.
- **Runner**: `AgentRunner` (see [plugin-dispatch concept](../../concepts/plugin-dispatch.md)), `PluginRegistry`, `FallbackHandler`.
- **LLM**: `OpenRouterLlmClient`.
- **Event log**: `FirestoreAgentEventLog`, `InMemoryAgentEventLog`.
- **MCP**: `resolveMcpForStep`, `flattenResolvedMcpToLegacy`.
- **Environment**: `validateWorkflowEnv`.

## Key internal modules

- `src/runner/` — `agent-runner.ts` (600+ lines, main execution loop), `plugin-registry.ts`, `fallback-handler.ts`, `agent-event-log.ts`.
- `src/plugins/` — `base-container-agent-plugin.ts`, concrete plugins, `docker-spawn-strategy.ts` (see [docker-spawn-strategies concept](../../concepts/docker-spawn-strategies.md)), `docker-image-builder.ts`, `resolve-env.ts`.
- `src/interfaces/` — `AgentPlugin` contract, context shapes.
- `src/mcp/` — step-scoped MCP resolution.
- `src/testing/` — `InMemoryAgentEventLog`, `NoopLlmClient`.

## Relationships

- Consumed by: [`platform-ui`](./platform-ui.md), [`example-agent`](../plugins/example-agent.md), [`supply-intelligence-plugins`](./supply-intelligence-plugins.md).
- Depends on: [`platform-core`](./platform-core.md), optionally `agent-queue`.

## Sources

- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/src/runner/agent-runner.ts`
- `packages/agent-runtime/src/runner/plugin-registry.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `packages/agent-runtime/src/plugins/docker-spawn-strategy.ts`
- `AGENTS.md` → "Plugin system", "Docker spawn strategies"
