---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [concept, plugin-dispatch, agent-runtime, registry]
---

**How a workflow step gets routed to the right agent plugin — `AgentRunner` + `PluginRegistry` + `AgentPlugin` contract.**

## Definition

The agent-runtime uses a registry + dispatch pattern. Plugins are looked up by name from a `PluginRegistry`, the runner drives their lifecycle, and results flow through a schema-validated envelope.

## Flow

1. `WorkflowDefinition` step declares `agent: <name>` (e.g. `claude-code-agent`, `supply-intelligence/driver-agent`).
2. `AgentRunner` calls `registry.get(name)` — throws `PluginNotFoundError` if absent.
3. Runner calls `plugin.initialize(context)` — stores `AgentContext` (step input, config, LLM client, resolved MCP, workflow secrets).
4. Runner calls `plugin.run(emit)` — plugin emits `status`, `annotation`, and exactly one `result` event.
5. `result` event is validated against `AgentOutputEnvelopeSchema` — must include `confidence` (0.0–1.0) and `confidence_rationale`.
6. Runner applies [autonomy](./autonomy-levels.md) + confidence threshold checks. If failed, triggers `FallbackHandler` (human escalation, retry, or cancel).

## Registration points

- **Built-in plugins** — `getPlatformServices()` in [`platform-ui`](../entities/packages/platform-ui.md) registers `claude-code-agent`, `opencode-agent`, `script-container` (and `MockClaudeCodeAgentPlugin` when `MOCK_AGENT=true`).
- **Domain plugins** — `registerSupplyIntelligencePlugins(registry)` called from the same `getPlatformServices()`.
- **Ad-hoc / tests** — `registry.register(name, plugin)` directly.

## Registry API

`PluginRegistry` at `packages/agent-runtime/src/runner/plugin-registry.ts`:
- `register(name, plugin)`
- `get(name)` — throws `PluginNotFoundError`
- `has(name)`
- `names()`, `list()`

## Writing a new plugin

Start from [`example-agent`](../entities/plugins/example-agent.md). For Docker-backed LLM plugins, extend `BaseContainerAgentPlugin` (see [docker-spawn-strategies](./docker-spawn-strategies.md)) and implement `getAgentCommand()`, `getMockDockerArgs()`, `parseAgentOutput()`.

**Before writing a plugin, check the registry** — grep for plugins already covering the capability you need. See [`entities/plugins/`](../entities/plugins/).

## Sources

- `packages/agent-runtime/src/runner/agent-runner.ts`
- `packages/agent-runtime/src/runner/plugin-registry.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
- `AGENTS.md` → "Plugin system"
