# MCP Support for Agent Steps

> Design document for integrating Model Context Protocol (MCP) servers into Mediforce's agent execution model.

## Problem

Agent steps currently run with a fixed set of tools: `Bash,Read,Write,Edit,Glob,Grep`. This covers file-based coding work but blocks agents from accessing external systems -- databases, APIs, knowledge bases, internal tools -- during execution. Teams have to bake everything into the skill prompt or pre-download all data before the step runs.

MCP changes this. An agent step that generates ADaM datasets could query a CDISC metadata server for variable definitions. A pharmacovigilance step could call a safety database API to pull case data. A supply chain step could check inventory levels in real time. The agent connects to MCP servers that expose these capabilities as tools, and the platform controls which servers (and which tools) each step is allowed to use.

The pharma angle is critical: in a regulated environment, you don't want an agent with blanket access to everything. You want to declare "this step can read from the CDISC metadata server and nothing else" and have the platform enforce that. The audit trail records exactly which MCP tools were invoked and with what arguments.

## Design Principles

1. **MCP config is data, not infrastructure.** MCP server definitions live in the workflow definition JSON, not in Docker images or environment variables. The platform generates the config file at runtime.
2. **Organization-level Tool Catalog.** Available MCP servers are defined at the org level ("Tools" in the UI). Steps reference tools from the catalog. This is the pre-approved tools library.
3. **Three-layer access control.** Catalog defines what exists. Step defines which servers. `allowedTools` per server defines which tools within each server. Default = nothing.
4. **Per-step scoping.** Each step declares which MCP servers it can access. No inheritance, no ambient access. Explicit is better than implicit in regulated environments.
5. **Secrets flow through the existing system.** MCP servers that need API keys use the same `{{SECRET}}` template resolution that env vars use today.
6. **Claude CLI does the hard work.** The `claude` CLI already supports `--mcp-config` for MCP server configuration. We generate the config file; the CLI connects to the servers.

## Architecture

### Three-Layer Access Control

```
┌─────────────────────────────────┐
│  Organization Tool Catalog      │  Layer 1: What exists
│  (GitHub, Postgres, CDISC, ...) │  Admin configures approved tools
├─────────────────────────────────┤
│  Step Server Allowlist          │  Layer 2: What this step can use
│  step.agent.mcpServers: [...]   │  Workflow author selects servers
├─────────────────────────────────┤
│  Tool Allowlist per Server      │  Layer 3: What tools are exposed
│  allowedTools: ["query"]        │  Granular per-tool filtering
└─────────────────────────────────┘
```

This is the killer feature for pharma demos: a compliance officer can see exactly which external tools each step has access to, down to individual operations.

### How it works end-to-end

```
Tool Catalog (org-level, UI at /[handle]/tools)
  ↓ workflow author picks servers for each step

WorkflowDefinition JSON
  step.agent.mcpServers: [
    { name: "github", command: "npx", args: [...], allowedTools: ["search_code", "get_file_contents"] },
    { name: "postgres", command: "npx", args: [...], env: { "DATABASE_URL": "{{DB_URL}}" }, allowedTools: ["query"] }
  ]

        ↓

BaseContainerAgentPlugin.prepareOutputDir()
  1. Resolves {{SECRET}} templates in MCP server env vars
  2. Writes /output/mcp-config.json (Claude CLI format, includes allowedTools)

AgentPlugin.run()
  3. Emits status event with MCP server list for audit

        ↓

ClaudeCodeAgentPlugin.getAgentCommand()
  Adds: --mcp-config /output/mcp-config.json

        ↓

Inside Docker container:
  - Claude CLI starts MCP servers as child processes (stdio transport)
  - Agent sees MCP tools alongside built-in tools
  - Agent calls MCP tools as needed during execution
  - All tool calls logged in stream-json activity log
  - MCP server processes terminate when claude process exits
```

### Tool Discovery (Future)

Tool discovery is planned for v2. When adding an MCP server to the catalog, the platform will auto-discover available tools by querying the server's `tools/list` endpoint. For v1, available tools are defined manually in the catalog seed data.

### Why stdio transport

MCP supports two transports: stdio and HTTP+SSE. We use stdio only in v1:

- **stdio**: Claude CLI spawns the MCP server as a child process. Automatic lifecycle, no ports, Docker-friendly.
- **HTTP/SSE** (future, v2): For long-running shared MCP servers. Requires network configuration in Docker.

## Schema

### McpServerConfigSchema (platform-core)

```typescript
// packages/platform-core/src/schemas/mcp-server-config.ts

export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),  // ← tool-level filtering
});
```

### WorkflowAgentConfig addition

```typescript
// Added to WorkflowAgentConfigSchema:
mcpServers: z.array(McpServerConfigSchema).optional(),
```

### Example workflow definition step

```json
{
  "id": "generate-adam",
  "name": "Generate ADaM Datasets",
  "executor": "agent",
  "autonomyLevel": "L2",
  "plugin": "claude-code-agent",
  "agent": {
    "skill": "adam-derivation",
    "model": "sonnet",
    "image": "mediforce-agent:protocol-to-tfl",
    "mcpServers": [
      {
        "name": "cdisc-library",
        "command": "node",
        "args": ["/opt/mcp-servers/cdisc-library/index.js"],
        "env": { "CDISC_API_KEY": "{{CDISC_API_KEY}}" },
        "description": "CDISC Library API - read-only access to SDTM/ADaM metadata",
        "allowedTools": ["get_variable_metadata", "search_terminology", "get_codelist"]
      }
    ]
  }
}
```

## Implementation (Done)

### Files changed

| File | Change |
|---|---|
| `packages/platform-core/src/schemas/mcp-server-config.ts` | New: `McpServerConfigSchema` with `allowedTools` |
| `packages/platform-core/src/schemas/workflow-definition.ts` | Add `mcpServers` to `WorkflowAgentConfigSchema` |
| `packages/platform-core/src/schemas/process-config.ts` | Add `mcpServers` to legacy `AgentConfigSchema` |
| `packages/platform-core/src/schemas/index.ts` | Export `McpServerConfigSchema`, `McpServerConfig` |
| `packages/agent-runtime/src/plugins/resolve-env.ts` | Export `resolveValue` for MCP config generation |
| `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts` | `writeMcpConfig()` in `prepareOutputDir()`, MCP status event |
| `packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts` | `--mcp-config` flag in `getAgentCommand()` |
| `packages/platform-ui/src/app/(app)/[handle]/tools/page.tsx` | Tool Catalog page (card grid by category) |
| `packages/platform-ui/src/app/(app)/[handle]/tools/[toolId]/page.tsx` | Tool detail page (connection, secrets, tools) |
| `packages/platform-ui/src/components/app-shell.tsx` | "Tools" in sidebar navigation |
| `packages/platform-ui/src/components/processes/step-status-panel.tsx` | MCP Tools in step config display |
| `packages/platform-ui/src/components/configs/step-config-card.tsx` | MCP servers section in config editor |
| `packages/platform-ui/src/lib/routes.ts` | Tool routes |

### Tests

- `packages/platform-core/src/schemas/__tests__/mcp-server-config.test.ts` — schema validation (valid, minimal, allowedTools, rejection)
- `packages/agent-runtime/src/plugins/__tests__/claude-code-agent-plugin.test.ts` — MCP status event, `--mcp-config` flag presence/absence
- `packages/agent-runtime/src/plugins/__tests__/resolve-env.test.ts` — `resolveValue` secret resolution (literals, templates, fallbacks, errors)
- `packages/agent-runtime/src/plugins/__tests__/mcp-config-integration.test.ts` — `writeMcpConfig` file output (structure, secret resolution, allowedTools, empty env)
- `packages/platform-ui/e2e/journeys/tool-catalog.journey.ts` — E2E journey: browse catalog, search, view detail page

## UI Design

### Tool Catalog (`/[handle]/tools`)

Card grid grouped by category with section headers showing counts. Live search filters by name, description, and category. Each card shows:
- Tool name + category badge
- Description
- Connection command
- Required secrets (with `{{SECRET}}` badges)
- Access level (N tools allowed, or "All tools available")
- Link to detail page

Categories: Development, Data Access, Communication, Clinical Data, Research.

Seed catalog: GitHub, Filesystem, PostgreSQL, Slack, CDISC Library, Brave Search.

E2E journey test: `e2e/journeys/tool-catalog.journey.ts` — GIF recording at `docs/features/tool-catalog.gif`.

### Tool Detail (`/[handle]/tools/[toolId]`)

- Connection info (transport, command)
- Required secrets with resolution explanation
- Available tools list with per-tool status (available / restricted)
- Usage snippet (JSON for workflow definition)

### Step Config Display

- Step status panel shows "MCP Tools: github, postgres" inline
- Step config card shows expandable "MCP Tools (N)" section with server details

### Access Control Info Banner

Prominent banner on Tools page:
> **Per-step access control** — Tools from this catalog can be assigned to individual workflow steps. Each step declares which tools it needs — agents only see tools explicitly granted to their step. Secrets are scoped per-tool and resolved at runtime.

## Demo Scenarios

### "GitHub Read vs Write"

Two steps in one workflow:
1. **Analyze Code** — GitHub MCP with `allowedTools: ["search_code", "get_file_contents"]` (read-only)
2. **Create Issue** — GitHub MCP with `allowedTools: ["create_issue"]` (write)

Shows that the same MCP server can have different tool access per step.

### "No Ambient Access"

Compare two steps in the same workflow:
1. **Extract Metadata** — has CDISC Library MCP. Activity log shows `cdisc-library__get_variable_metadata` calls.
2. **Generate TLG Shells** — no MCP servers. Agent cannot call CDISC tools even though both steps run in the same workflow.

Demonstrates per-step scoping — the core security story.

## Decisions

### Organization-level Tool Catalog

MCP servers are defined at the org level. For v1, the catalog is seed data. For v2, admin UI for adding/removing tools with role-based permissions. Steps reference tools from the catalog — no inline definitions of novel servers.

### Tool-level allowlisting

The `allowedTools` field on `McpServerConfigSchema` restricts which tools from a server are available to the agent. When set, the allowlist is written to the generated `mcp-config.json` alongside the server config. When omitted, all tools are available. Note: Claude CLI does not natively enforce `allowedTools` — the field is included in the config for audit purposes and future enforcement (e.g., via prompt constraints or a filtering MCP proxy).

### Secrets scoping

Secrets use the existing `{{SECRET}}` template system resolved from workflow secrets and environment variables. Each MCP server only gets the secrets declared in its `env` config. Steps with no MCP servers configured have no MCP-related secrets resolved.

### Immutable config

The MCP config file is generated at runtime from the immutable workflow definition version. It cannot drift or be modified by the agent. This is critical for GxP compliance.

## Future Work

- **Tool Catalog admin UI** — CRUD for catalog entries with role-based access
- **Tool discovery** — auto-discover available tools from MCP servers at catalog add time
- **Version pinning** — pin MCP server versions in workflow definitions (see issue #98)
- **OpenCode MCP support** — separate PR once Claude Code path is proven
- **HTTP/SSE transport** — for long-running shared MCP servers
- **Rate limiting** — per-tool call limits within a step execution
