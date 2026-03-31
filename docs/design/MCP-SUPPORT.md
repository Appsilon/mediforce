# MCP Support for Agent Steps

> Design document for integrating Model Context Protocol (MCP) servers into Mediforce's agent execution model.

## Problem

Agent steps currently run with a fixed set of tools: `Bash,Read,Write,Edit,Glob,Grep`. This covers file-based coding work but blocks agents from accessing external systems -- databases, APIs, knowledge bases, internal tools -- during execution. Teams have to bake everything into the skill prompt or pre-download all data before the step runs.

MCP changes this. An agent step that generates ADaM datasets could query a CDISC metadata server for variable definitions. A pharmacovigilance step could call a safety database API to pull case data. A supply chain step could check inventory levels in real time. The agent connects to MCP servers that expose these capabilities as tools, and the platform controls which servers (and which tools) each step is allowed to use.

The pharma angle is critical: in a regulated environment, you don't want an agent with blanket access to everything. You want to declare "this step can read from the CDISC metadata server and nothing else" and have the platform enforce that. The audit trail records exactly which MCP tools were invoked and with what arguments.

## Design Principles

1. **MCP config is data, not infrastructure.** MCP server definitions live in the workflow definition JSON, not in Docker images or environment variables. The platform generates the config file at runtime.
2. **Per-step scoping.** Each step declares which MCP servers it can access. No inheritance, no ambient access. Explicit is better than implicit in regulated environments.
3. **The platform owns the lifecycle.** MCP servers are started as sidecar processes inside the same Docker container. The entrypoint starts them before the agent runs and stops them after. No always-on services, no cross-step contamination.
4. **Secrets flow through the existing system.** MCP servers that need API keys use the same `{{SECRET}}` template resolution that env vars use today. No new secret management system.
5. **Claude CLI does the hard work.** The `claude` CLI already supports `--mcp-config` for MCP server configuration. We generate the config file; the CLI connects to the servers. We don't build MCP client code.

## Architecture

### How it works end-to-end

```
WorkflowDefinition JSON
  step.agent.mcpServers: [
    { name: "cdisc-metadata", command: "npx", args: ["-y", "@cdisc/mcp-server"], env: { "API_KEY": "{{CDISC_API_KEY}}" } },
    { name: "postgres-readonly", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."] }
  ]

        |
        v

BaseContainerAgentPlugin.prepareOutputDir()
  1. Resolves {{SECRET}} templates in MCP server env vars
  2. Writes /output/mcp-config.json (Claude CLI format)
  3. Writes MCP server list to audit record

        |
        v

ClaudeCodeAgentPlugin.getAgentCommand()
  Adds: --mcp-config /output/mcp-config.json
  Full command: claude -p --verbose --output-format stream-json
    --allowedTools Bash,Read,Write,Edit,Glob,Grep
    --mcp-config /output/mcp-config.json

        |
        v

Inside Docker container:
  - Claude CLI starts MCP servers as child processes (stdio transport)
  - Agent sees MCP tools alongside built-in tools
  - Agent calls MCP tools as needed during execution
  - MCP server processes terminate when claude process exits

        |
        v

Platform records in audit trail:
  - Which MCP servers were configured
  - Tool invocations captured in stream-json activity log
```

### MCP config file format

The Claude CLI expects a JSON file matching this structure:

```json
{
  "mcpServers": {
    "cdisc-metadata": {
      "command": "npx",
      "args": ["-y", "@cdisc/mcp-server"],
      "env": {
        "API_KEY": "resolved-secret-value"
      }
    },
    "postgres-readonly": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://readonly:pass@host/db"],
      "env": {}
    }
  }
}
```

The platform generates this file in `prepareOutputDir()` with secrets already resolved. The file is written to `/output/mcp-config.json` inside the container (same mount as prompt.txt).

### Why stdio transport (not HTTP/SSE)

MCP supports two transports: stdio (command spawned as child process) and HTTP+SSE (network server). We use stdio exclusively:

- **Lifecycle is automatic.** Claude CLI spawns the MCP server process, communicates over stdin/stdout, and kills it when done. No port management, no cleanup.
- **No network exposure.** The MCP server never listens on a port. No risk of cross-container access or port conflicts when running multiple agent steps concurrently.
- **Docker-friendly.** The MCP server binary just needs to be available in the container image. No sidecar orchestration.
- **This is what Claude CLI does natively.** The `--mcp-config` flag spawns stdio-based MCP servers. We're using the tool as designed.

HTTP/SSE transport is needed only when MCP servers are long-running shared services (e.g., a company-wide knowledge base). That's a future concern. For now, per-step stdio servers cover every use case we need.

## Schema Changes

### WorkflowAgentConfig (platform-core)

Add `mcpServers` to the agent config schema:

```typescript
export const McpServerConfigSchema = z.object({
  /** Unique name for this MCP server (used as key in config file) */
  name: z.string().min(1),
  /** Command to start the MCP server (e.g., "npx", "python", "node") */
  command: z.string().min(1),
  /** Arguments to the command */
  args: z.array(z.string()).default([]),
  /** Environment variables for the MCP server process.
   *  Supports {{SECRET}} template syntax for secret resolution. */
  env: z.record(z.string(), z.string()).optional(),
  /** Human-readable description (for UI and audit trail) */
  description: z.string().optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const WorkflowAgentConfigSchema = z.object({
  // ... existing fields ...
  model: z.string().optional(),
  skill: z.string().optional(),
  prompt: z.string().optional(),
  skillsDir: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  timeoutMinutes: z.number().optional(),
  command: z.string().optional(),
  inlineScript: z.string().optional(),
  runtime: z.enum(['javascript', 'python', 'r', 'bash']).optional(),
  image: z.string().optional(),
  repo: z.string().optional(),
  commit: z.string().optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  fallbackBehavior: z.enum(['escalate_to_human', 'continue_with_flag', 'pause']).optional(),
  // New: MCP server configuration
  mcpServers: z.array(McpServerConfigSchema).optional(),
});
```

### AgentConfig internal type

The internal `AgentConfig` type (used by `BaseContainerAgentPlugin`) adds:

```typescript
interface AgentConfig {
  // ... existing fields ...
  mcpServers?: McpServerConfig[];
}
```

### Example workflow definition

```json
{
  "id": "generate-adam",
  "name": "Generate ADaM Datasets",
  "type": "creation",
  "executor": "agent",
  "autonomyLevel": "L2",
  "plugin": "claude-code-agent",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "{{OPENROUTER_API_KEY}}",
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api"
  },
  "agent": {
    "skill": "adam-derivation",
    "skillsDir": "apps/protocol-to-tfl/plugins/protocol-to-tfl/skills",
    "model": "sonnet",
    "image": "mediforce-agent:protocol-to-tfl",
    "timeoutMinutes": 30,
    "mcpServers": [
      {
        "name": "cdisc-library",
        "command": "node",
        "args": ["/opt/mcp-servers/cdisc-library/index.js"],
        "env": { "CDISC_API_KEY": "{{CDISC_API_KEY}}" },
        "description": "CDISC Library API - read-only access to SDTM/ADaM metadata and controlled terminology"
      }
    ]
  }
}
```

## Implementation

### 1. Schema update (platform-core)

Add `McpServerConfigSchema` and the `mcpServers` field to `WorkflowAgentConfigSchema` in `packages/platform-core/src/schemas/workflow-definition.ts`.

### 2. AgentConfig mapping (base-container-agent-plugin.ts)

In `initialize()`, map `stepAgent.mcpServers` to the internal `agentConfig.mcpServers`:

```typescript
agentConfig = {
  // ... existing mapping ...
  mcpServers: stepAgent.mcpServers,
};
```

### 3. MCP config generation (base-container-agent-plugin.ts)

Override `prepareOutputDir()` in the base class (or add to existing logic) to write the MCP config file:

```typescript
protected async prepareOutputDir(outputDir: string): Promise<void> {
  await super.prepareOutputDir(outputDir);

  if (!this.agentConfig.mcpServers || this.agentConfig.mcpServers.length === 0) {
    return;
  }

  const mcpConfig: Record<string, unknown> = { mcpServers: {} };

  for (const server of this.agentConfig.mcpServers) {
    const resolvedEnv: Record<string, string> = {};
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        resolvedEnv[key] = resolveValue(value, this.workflowSecrets);
      }
    }

    (mcpConfig.mcpServers as Record<string, unknown>)[server.name] = {
      command: server.command,
      args: server.args,
      ...(Object.keys(resolvedEnv).length > 0 ? { env: resolvedEnv } : {}),
    };
  }

  await writeFile(
    join(outputDir, 'mcp-config.json'),
    JSON.stringify(mcpConfig, null, 2),
    'utf-8',
  );
}
```

### 4. CLI flag (claude-code-agent-plugin.ts)

In `getAgentCommand()`, add the `--mcp-config` flag when MCP servers are configured:

```typescript
getAgentCommand(_promptFilePath: string, options?: SpawnCliOptions): AgentCommandSpec {
  const args: string[] = [
    'claude', '-p', '--verbose', '--output-format', 'stream-json',
  ];

  if (options?.model) {
    args.push('--model', options.model);
  }
  if (options?.addDirs) {
    for (const dir of options.addDirs) {
      args.push('--add-dir', this.agentConfig.image ? '/data' : dir);
    }
  }

  args.push('--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep');

  // MCP server configuration
  if (this.agentConfig.mcpServers && this.agentConfig.mcpServers.length > 0) {
    args.push('--mcp-config', '/output/mcp-config.json');
  }

  return { args, promptDelivery: 'stdin' };
}
```

### 5. Audit trail

The existing activity log already captures tool calls from the stream-json output. MCP tool invocations appear in the same stream as `tool_use` events with the MCP server name as a prefix (e.g., `cdisc-library__lookup_variable`). No additional logging code needed -- `formatLogEntries()` already captures these.

Add the MCP server list to the step execution metadata:

```typescript
// In run(), after spawning
await emit({
  type: 'status',
  payload: `MCP servers: ${this.agentConfig.mcpServers.map(s => s.name).join(', ')}`,
  timestamp: new Date().toISOString(),
});
```

### 6. Docker image requirements

MCP servers run as child processes inside the agent container. The container image must include the MCP server binaries. Two approaches:

**Baked into image (recommended for production):**
```dockerfile
FROM mediforce-agent:base
# Install MCP servers used by this workflow's steps
RUN npm install -g @cdisc/mcp-server @modelcontextprotocol/server-postgres
```

**npx at runtime (acceptable for dev/demo):**
```json
{ "command": "npx", "args": ["-y", "@cdisc/mcp-server"] }
```

The `npx -y` approach downloads at runtime -- slower but requires no image changes. Fine for demos and development. Production images should bake in the servers.

### 7. OpenCode plugin

OpenCode supports MCP via its own config mechanism. The `OpenCodeAgentPlugin` would write MCP server configs into the `opencode.json` config file it already generates in `prepareOutputDir()`. Same schema, different output format. This is a separate PR.

### 8. Mock mode

When `MOCK_AGENT=true`, MCP config is still written (for testing the config generation path) but no MCP servers actually start since the mock agent doesn't invoke the real CLI.

## Access Control Model

This is the key differentiator for pharma. Here is what the access control story looks like:

### What is controlled

| Control point | Who decides | Where configured |
|---|---|---|
| Which MCP servers a step can use | Workflow definition author | `step.agent.mcpServers` in the `.wd.json` |
| Which secrets an MCP server gets | Workflow definition author + secrets admin | `{{SECRET}}` templates + namespace secrets |
| Which tools the MCP server exposes | MCP server implementation | Server code (we don't filter tools) |
| Whether the agent uses MCP tools | Claude CLI + autonomy level | The agent decides based on the task |

### What we do NOT control (yet)

- **Per-tool filtering within an MCP server.** If the CDISC MCP server exposes 10 tools, the agent can call any of them. This is acceptable for v1 -- MCP servers should be purpose-built and narrow. A "database" MCP server should expose read-only queries, not DDL.
- **Rate limiting MCP tool calls.** No per-tool call limits. The step-level timeout is the backstop.
- **Cross-step MCP state.** Each step starts fresh MCP servers. No shared state between steps.

### Why this is sufficient for regulated environments

The compliance argument is:

1. **Explicit declaration.** Every MCP server a step can access is declared in the workflow definition, which is version-controlled and immutable once published.
2. **Minimal privilege.** Steps only get the MCP servers they declare. No ambient access to anything.
3. **Secret scoping.** MCP server credentials are resolved from namespace-scoped workflow secrets. Different teams/studies can have different credentials for the same server type.
4. **Audit trail.** Every MCP tool invocation is logged in the activity log with arguments and results. Reviewers can see exactly what external data the agent accessed.
5. **Immutable config.** The MCP config file is generated at runtime from the immutable workflow definition version. It cannot drift or be modified by the agent.

Future enhancement: a `McpServerCatalog` at the organization level that pre-approves MCP server configurations, and steps can only reference servers from the catalog. This adds an approval layer between "developer defines an MCP server" and "step uses it in production." Not needed for v1 but the schema supports it.

## What Goes in the Docker Image

MCP servers need binaries/packages available inside the container. Strategy:

### Base image layer (always available)
```dockerfile
# Common MCP servers pre-installed in the golden image
RUN npm install -g \
  @modelcontextprotocol/server-filesystem \
  @modelcontextprotocol/server-postgres
```

### Workflow-specific image layer
```dockerfile
FROM mediforce-agent:base
# Domain-specific MCP servers
RUN npm install -g @cdisc/mcp-server @pharma/safety-db-mcp
```

### Runtime install (dev/demo only)
```json
{ "command": "npx", "args": ["-y", "@some/mcp-server"] }
```

The image strategy from CONTAINER_STEPS.md applies: start with one image, split when needed.

## Demo Scenario

### "Controlled External Access"

Show a clinical data generation step that has access to a CDISC metadata server:

1. **Workflow definition** declares `mcpServers: [{ name: "cdisc-library", ... }]` on the ADaM generation step.
2. **Agent runs** and the activity log shows MCP tool calls: `cdisc-library__get_variable_metadata("ADSL", "AGEGR1")` -- the agent looked up the correct age group variable definition.
3. **Review panel** shows the MCP servers that were available and the tools that were called.
4. **Compare** with the same step without MCP: the agent had to guess the variable definition or it was hardcoded in the skill prompt. With MCP, it pulls the authoritative source.

### "No Ambient Access"

Show that a different step in the same workflow (e.g., "generate TLG shells") does NOT have access to the CDISC MCP server. It's configured without `mcpServers`. The agent cannot call CDISC tools even though both steps run in the same workflow.

This demonstrates per-step scoping -- the core security story.

## Decisions

### No workflow-level MCP servers

Considered and rejected. Having workflow-level `mcpServers` that all steps inherit creates exactly the ambient-access problem we want to avoid. Every step should explicitly declare what it needs. Copy-paste in JSON is cheap; debugging "why did this step access the safety database?" is expensive.

If repetition becomes a real problem, introduce a `mcpServerPresets` at workflow level that steps can reference by name. But don't build this until it's needed.

### No runtime MCP server management UI

The platform does not provide a UI for starting/stopping/monitoring MCP servers. They are ephemeral child processes inside Docker containers. The activity log is the observability layer. Building a "running MCP servers" dashboard would be over-engineering for stdio-transport servers with step-scoped lifetimes.

### Secrets in MCP env use the same system

MCP server env vars use `{{SECRET}}` templates resolved by the existing `resolveValue()` function. No new secret store, no new resolution path. This means MCP secrets are subject to the same namespace scoping and audit as all other secrets.

### No tool allowlisting in v1

Claude CLI does not currently support filtering which MCP tools are available from a connected server. The control point is: which MCP servers are connected, not which tools within them. This is acceptable because MCP servers should be narrow and purpose-built. If we need tool-level filtering later, it would be implemented as a proxy MCP server that wraps another server and filters its tool list.

## Changes Required

| File | Change |
|---|---|
| `packages/platform-core/src/schemas/workflow-definition.ts` | Add `McpServerConfigSchema`, add `mcpServers` to `WorkflowAgentConfigSchema` |
| `packages/platform-core/src/types/index.ts` | Add `McpServerConfig` to `AgentConfig` type |
| `packages/agent-runtime/src/plugins/base-container-agent-plugin.ts` | Map `mcpServers` in `initialize()`, generate `mcp-config.json` in `prepareOutputDir()` |
| `packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts` | Add `--mcp-config` flag in `getAgentCommand()` |
| `packages/agent-runtime/src/plugins/resolve-env.ts` | Export `resolveValue` (currently module-private) for use in MCP config generation |
| Workflow definition JSONs | Add `mcpServers` to steps that need external tool access |

## Implementation Order

1. **Schema** -- add `McpServerConfigSchema` and wire into `WorkflowAgentConfigSchema`. Run typecheck + tests.
2. **Config generation** -- implement `mcp-config.json` writing in `prepareOutputDir()`. Unit test with mock agent configs.
3. **CLI integration** -- add `--mcp-config` flag to `ClaudeCodeAgentPlugin.getAgentCommand()`.
4. **Demo workflow** -- add an MCP server to one step in the protocol-to-tfl pipeline. Run end-to-end with a real (or mock) MCP server.
5. **Audit** -- verify MCP tool calls appear in activity logs. Add MCP server list to step execution status events.

## Open Questions

- **MCP server startup time.** Some MCP servers take seconds to initialize (especially npx-based ones). Does this eat into the step timeout? Claude CLI handles the startup wait internally, but we should measure the overhead.
- **MCP server failures.** If an MCP server crashes mid-execution, Claude CLI handles the error. But should the platform detect this and emit a specific status event? Or is the existing error handling (step fails, error detail extracted) sufficient?
- **MCP server output size.** MCP tools can return large payloads (e.g., database query results). These flow through the Claude CLI's context window. No platform-level concern, but skill prompts should instruct agents to use targeted queries.
- **Custom MCP servers.** Teams will want to build their own MCP servers for internal systems. What's the guidance? A template repo? A section in the docs? Deferred until demand appears.
- **OpenCode MCP support.** OpenCode has its own MCP config format. Support is a separate PR once the Claude Code path is proven.
