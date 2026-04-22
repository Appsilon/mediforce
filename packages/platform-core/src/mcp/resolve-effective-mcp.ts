import type {
  AgentMcpBinding,
  HttpAuthConfig,
  ToolCatalogEntry,
} from '../schemas/agent-mcp-binding.js';
import type { AgentDefinition } from '../schemas/agent-definition.js';
import type { WorkflowStep } from '../schemas/workflow-definition.js';

/** Raised when a stdio AgentMcpBinding references a catalogId that is
 *  not present in the provided catalog. Carries the server name and the
 *  missing catalogId so callers can produce actionable errors. */
export class CatalogEntryNotFoundError extends Error {
  public readonly serverName: string;
  public readonly catalogId: string;

  constructor(serverName: string, catalogId: string) {
    super(
      `Tool catalog has no entry for catalogId "${catalogId}" (referenced by MCP server "${serverName}")`,
    );
    this.name = 'CatalogEntryNotFoundError';
    this.serverName = serverName;
    this.catalogId = catalogId;
  }
}

export type ResolvedMcpServer = {
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  auth?: HttpAuthConfig;
  /** Explicit allowlist after applying step-level denyTools subtraction.
   *  undefined means "all tools from the server" (deniedTools may still
   *  apply a second-stage filter). */
  allowedTools?: string[];
  /** Tools denied at step level when binding did not carry an explicit
   *  allowlist to subtract from. Runtime layer should apply this as a
   *  subtractive filter after discovering the server's full tool set. */
  deniedTools?: string[];
};

export type ResolvedMcpConfig = {
  servers: Record<string, ResolvedMcpServer>;
};

/** Resolves an agent's MCP configuration for a specific workflow step.
 *
 *  Pure function — does not read from Firestore, does not mutate inputs.
 *  Step restrictions are strictly subtractive: they can only remove
 *  servers (disable) or tools (denyTools). Step 2 will feed this result
 *  into writeMcpConfig() at agent spawn time. */
export function resolveEffectiveMcp(
  agent: AgentDefinition,
  step: WorkflowStep,
  catalog: Map<string, ToolCatalogEntry>,
): ResolvedMcpConfig {
  const servers: Record<string, ResolvedMcpServer> = {};
  const mcpServers = agent.mcpServers ?? {};
  const restrictions = step.mcpRestrictions ?? {};

  for (const [name, binding] of Object.entries(mcpServers)) {
    const restriction = restrictions[name];
    if (restriction?.disable === true) continue;

    const resolved = resolveBinding(name, binding, catalog);
    applyDenyTools(resolved, binding, restriction?.denyTools);
    servers[name] = resolved;
  }

  return { servers };
}

function resolveBinding(
  name: string,
  binding: AgentMcpBinding,
  catalog: Map<string, ToolCatalogEntry>,
): ResolvedMcpServer {
  if (binding.type === 'stdio') {
    const entry = catalog.get(binding.catalogId);
    if (entry === undefined) {
      throw new CatalogEntryNotFoundError(name, binding.catalogId);
    }
    return {
      type: 'stdio',
      command: entry.command,
      args: entry.args,
      env: entry.env,
      allowedTools: binding.allowedTools ? [...binding.allowedTools] : undefined,
    };
  }

  return {
    type: 'http',
    url: binding.url,
    auth: binding.auth,
    allowedTools: binding.allowedTools ? [...binding.allowedTools] : undefined,
  };
}

function applyDenyTools(
  resolved: ResolvedMcpServer,
  binding: AgentMcpBinding,
  denyTools: readonly string[] | undefined,
): void {
  if (denyTools === undefined || denyTools.length === 0) return;

  if (binding.allowedTools !== undefined) {
    const denySet = new Set(denyTools);
    resolved.allowedTools = (resolved.allowedTools ?? []).filter(
      tool => denySet.has(tool) === false,
    );
    return;
  }

  resolved.deniedTools = [...denyTools];
}
