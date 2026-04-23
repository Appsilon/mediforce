---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 4
tags: [concept, plugin-dispatch, agent-runtime, registry]
---

**Registry + dispatch. `AgentRunner` + `PluginRegistry` + `AgentPlugin` contract. Lookup by name → drive lifecycle → validate schema envelope.**

## Flow

1. Step declares `agent: <name>` (e.g. `claude-code-agent`, `supply-intelligence/driver-agent`).
2. `AgentRunner.registry.get(name)` → `PluginNotFoundError` if missing.
3. `plugin.initialize(context)` — store `AgentContext` (step input, config, LLM client, resolved MCP → [mcp-resolution](./mcp-resolution.md), workflow secrets).
4. `plugin.run(emit)` — plugin emits `status`, `annotation`, exactly one `result`.
5. `result` validated vs `AgentOutputEnvelopeSchema`. Must include `confidence` (0.0–1.0) + `confidence_rationale`.
6. Runner applies [autonomy](./autonomy-levels.md) + confidence threshold. Fail → `FallbackHandler` (human escalation / retry / cancel).

## Registration points

- **Built-in** — `getPlatformServices()` in [platform-ui](../entities/packages/platform-ui.md) registers `claude-code-agent`, `opencode-agent`, `script-container`. `MOCK_AGENT=true` → mocks.
- **Domain** — `registerSupplyIntelligencePlugins(registry)` called from `getPlatformServices()`.
- **Ad-hoc / tests** — `registry.register(name, plugin)` directly.

## Registry API

`PluginRegistry` at `packages/agent-runtime/src/runner/plugin-registry.ts`:

- `register(name, plugin)`
- `get(name)` — throws `PluginNotFoundError`
- `has(name)`
- `names()`, `list()`

## Writing a new plugin

Start: [`example-agent`](../entities/plugins/example-agent.md). Docker-backed LLM plugins → extend `BaseContainerAgentPlugin` (see [docker-spawn-strategies](./docker-spawn-strategies.md)). Implement `getAgentCommand()`, `getMockDockerArgs()`, `parseAgentOutput()`.

**Check [entities/plugins/](../entities/plugins/) first. Don't duplicate.**

## Sources

- `packages/agent-runtime/src/runner/agent-runner.ts`
- `packages/agent-runtime/src/runner/plugin-registry.ts`
- `packages/platform-ui/src/lib/platform-services.ts`
- `AGENTS.md` → "Plugin system"
