---
type: entity
created: 2026-04-23
updated: 2026-04-23
sources: 5
tags: [package, agent-runtime, plugins, docker]
---

**Agent execution engine. Plugin dispatch, autonomy enforcement, fallback, Docker spawn strategies, per-step MCP binding.**

## Purpose

Given an agent step: load plugin, assemble prompt (skill file + custom prompt + previous outputs + confidence instructions), spawn container (local or queued), validate `result` vs `AgentOutputEnvelopeSchema`, apply fallbacks (timeout / low-confidence / error). Owns the `AgentPlugin` interface.

## Dependencies

- Internal: [`platform-core`](./platform-core.md) (required); `@mediforce/agent-queue` (optional, on `REDIS_URL`).
- External: `firebase-admin`, `zod`.

## Key exports

- **Interfaces**: `AgentPlugin`, `AgentContext`, `WorkflowAgentContext`, `AutonomyLevel` → [autonomy-levels](../../concepts/autonomy-levels.md), `LlmClient`, `LlmResponse`.
- **Plugin base**: `BaseContainerAgentPlugin` (1400+ lines — spawn, mounts, git, MCP config, output extract).
- **Concrete**: [`ClaudeCodeAgentPlugin`](../plugins/claude-code-agent.md), [`OpenCodeAgentPlugin`](../plugins/opencode-agent.md), [`ScriptContainerPlugin`](../plugins/script-container.md), `MockClaudeCodeAgentPlugin`.
- **Runner**: `AgentRunner` → [plugin-dispatch](../../concepts/plugin-dispatch.md), `PluginRegistry`, `FallbackHandler`.
- **LLM**: `OpenRouterLlmClient`.
- **Event log**: `FirestoreAgentEventLog`, `InMemoryAgentEventLog`.
- **MCP**: `resolveMcpForStep`, `flattenResolvedMcpToLegacy`.
- **Env**: `validateWorkflowEnv`.

## Key internal modules

- `src/runner/` — `agent-runner.ts` (600+ lines), `plugin-registry.ts`, `fallback-handler.ts`, `agent-event-log.ts`.
- `src/plugins/` — `base-container-agent-plugin.ts`, concretes, `docker-spawn-strategy.ts` → [docker-spawn-strategies](../../concepts/docker-spawn-strategies.md), `docker-image-builder.ts`, `resolve-env.ts`.
- `src/interfaces/` — `AgentPlugin`, context shapes.
- `src/mcp/` — step-scoped MCP.
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
