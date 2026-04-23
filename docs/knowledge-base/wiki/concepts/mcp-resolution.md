---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [concept, mcp, agent-runtime, tool-catalog]
---

**Per-step resolution of MCP (Model Context Protocol) servers and tool filters. Inputs: agent-definition bindings + step-level restrictions + tool catalog. Output: a concrete `mcp-config.json` written into the container.**

## Two paths

### Workflow-mode (recommended)

- `context.resolvedMcpConfig` is pre-resolved by [`agent-runtime`](../entities/packages/agent-runtime.md) `resolveMcpForStep()`.
- Inputs: `AgentDefinition` bindings (which MCP servers the agent may use), step-level `allowedTools` restrictions, tool catalog entries from Firestore.
- Used by: workflow steps running through `BaseContainerAgentPlugin`.

### Legacy path

- `agentConfig.mcpServers` array supplied inline in the process config.
- Flattened via `flattenResolvedMcpToLegacy()`.
- Used by: the legacy `processConfigs` schema (see [dual-schema-migration](./dual-schema-migration.md)).

## What gets written

`/output/mcp-config.json` inside the container, with:

- `mcpServers` map — each entry is either `stdio` (command + args) or `http` (URL).
- `allowedTools` filter per server — subset declared by the step.

## Env var templating

`{{SECRET}}` placeholders in the server config are resolved at write time from `workflowSecrets` (encrypted at rest, decrypted via `secrets-cipher` in [`platform-infra`](../entities/packages/platform-infra.md)).

## Before adding a new MCP integration

- Register the server in the tool catalog (`packages/platform-core/src/schemas/` → tool catalog entries).
- Bind it on an `AgentDefinition` (Firestore).
- Restrict it per-step with `allowedTools` in the `WorkflowDefinition`.
- Do **not** hardcode server URLs in plugin code — go through `resolveMcpForStep()`.

## Sources

- `packages/agent-runtime/src/mcp/resolve-mcp-for-step.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `packages/platform-core/src/mcp/resolve-effective-mcp.ts`
