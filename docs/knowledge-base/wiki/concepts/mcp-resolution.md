---
type: concept
created: 2026-04-23
updated: 2026-04-23
sources: 3
tags: [concept, mcp, agent-runtime, tool-catalog]
---

**Per-step MCP resolution. Inputs: agent-def bindings + step-level restrictions + tool catalog. Output: concrete `mcp-config.json` written into container.**

## Two paths

### Workflow-mode (recommended)

- `context.resolvedMcpConfig` — pre-resolved by [`agent-runtime`](../entities/packages/agent-runtime.md) `resolveMcpForStep()`.
- Inputs: `AgentDefinition` bindings (which MCP servers agent may use), step-level `allowedTools`, tool catalog entries from Firestore.
- Used by: workflow steps running through `BaseContainerAgentPlugin`.

### Legacy path

- `agentConfig.mcpServers` array inline in process config.
- Flattened via `flattenResolvedMcpToLegacy()`.
- Used by: legacy `processConfigs` (see [dual-schema-migration](./dual-schema-migration.md)).

## What gets written

`/output/mcp-config.json` inside container:

- `mcpServers` map — `stdio` (command + args) or `http` (URL).
- `allowedTools` filter per server — subset declared by step.

## Env var templating

`{{SECRET}}` placeholders in server config resolved at write time from `workflowSecrets`. Encrypted at rest, decrypted via `secrets-cipher` in [`platform-infra`](../entities/packages/platform-infra.md).

## Before adding a new MCP integration

- Register the server in tool catalog (`packages/platform-core/src/schemas/` → tool catalog entries).
- Bind on `AgentDefinition` (Firestore).
- Restrict per-step with `allowedTools` in `WorkflowDefinition`.
- **Do not** hardcode server URLs in plugin code. Go through `resolveMcpForStep()`.

## Sources

- `packages/agent-runtime/src/mcp/resolve-mcp-for-step.ts`
- `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts`
- `packages/platform-core/src/mcp/resolve-effective-mcp.ts`
