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

/** Raised when a step's mcpRestrictions references an MCP server name
 *  that is not defined on the agent. Catches typos (e.g. "githuub" for
 *  "github") at resolution time rather than letting them silently no-op.
 *  Carries the offending name and the known names for actionable errors. */
export class UnknownRestrictionTargetError extends Error {
  public readonly serverName: string;
  public readonly knownServerNames: readonly string[];

  constructor(serverName: string, knownServerNames: readonly string[]) {
    const knownList = knownServerNames.length === 0
      ? '<none>'
      : knownServerNames.join(', ');
    super(
      `Step mcpRestrictions references MCP server "${serverName}" which is not defined on the agent (known servers: ${knownList})`,
    );
    this.name = 'UnknownRestrictionTargetError';
    this.serverName = serverName;
    this.knownServerNames = knownServerNames;
  }
}

/** Raised when a step applies `denyTools` to a server whose agent-level
 *  binding does not carry an explicit `allowedTools`. Such state has no
 *  serializable representation in either `mcp-config.json` or
 *  `McpServerConfig` — there's no way to express "all tools minus X" at
 *  the downstream layer, so the deny list would be silently dropped at
 *  spawn time, creating an authorization gap. Authors must either add
 *  `allowedTools` to the binding (so the subtraction can materialize)
 *  or replace `denyTools` with `disable: true`. */
export class DenyToolsWithoutAllowedToolsError extends Error {
  public readonly serverName: string;
  public readonly denyTools: readonly string[];

  constructor(serverName: string, denyTools: readonly string[]) {
    super(
      `Step mcpRestrictions.${serverName}.denyTools is set (${denyTools.join(', ')}), ` +
      `but the agent's binding for "${serverName}" has no allowedTools to subtract from. ` +
      `Add allowedTools to the binding (so the deny list can be applied) or use disable: true.`,
    );
    this.name = 'DenyToolsWithoutAllowedToolsError';
    this.serverName = serverName;
    this.denyTools = denyTools;
  }
}

type ResolvedMcpServerShared = {
  /** Explicit allowlist after applying step-level denyTools subtraction.
   *  undefined means "all tools from the server". Never an empty array —
   *  servers whose allowlist was emptied by denyTools are dropped from
   *  the result. */
  allowedTools?: string[];
};

export type ResolvedStdioMcpServer = ResolvedMcpServerShared & {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type ResolvedHttpMcpServer = ResolvedMcpServerShared & {
  type: 'http';
  url: string;
  auth?: HttpAuthConfig;
};

export type ResolvedMcpServer = ResolvedStdioMcpServer | ResolvedHttpMcpServer;

export type ResolvedMcpConfig = {
  servers: Record<string, ResolvedMcpServer>;
};

/** Resolves an agent's MCP configuration for a specific workflow step.
 *
 *  Pure function — does not read from Firestore, does not mutate inputs.
 *  Step restrictions are strictly subtractive: they can only remove
 *  servers (disable) or tools (denyTools). Step 2 will feed this result
 *  into writeMcpConfig() at agent spawn time.
 *
 *  denyTools is only meaningful when the agent's binding already carries
 *  an explicit allowedTools (otherwise the subtraction has no materialized
 *  list to operate on and would silently lose the deny list at the
 *  downstream writer). Attempts to use denyTools without binding
 *  allowedTools throw DenyToolsWithoutAllowedToolsError. */
export function resolveEffectiveMcp(
  agent: AgentDefinition,
  step: WorkflowStep,
  catalog: Map<string, ToolCatalogEntry>,
): ResolvedMcpConfig {
  const servers: Record<string, ResolvedMcpServer> = {};
  const mcpServers = agent.mcpServers ?? {};
  const restrictions = step.mcpRestrictions ?? {};

  const knownServerNames = Object.keys(mcpServers);
  const knownSet = new Set(knownServerNames);
  for (const restrictionName of Object.keys(restrictions)) {
    if (knownSet.has(restrictionName) === false) {
      throw new UnknownRestrictionTargetError(restrictionName, knownServerNames);
    }
  }

  // Surface denyTools-without-allowedTools early, before any catalog
  // lookup: the resolver cannot materialize an explicit allowlist for
  // such bindings, so letting it through would silently drop the deny
  // list at serialization time.
  for (const [name, restriction] of Object.entries(restrictions)) {
    if (restriction?.disable === true) continue;
    const denyTools = restriction?.denyTools;
    if (denyTools === undefined || denyTools.length === 0) continue;
    const binding = mcpServers[name];
    if (binding !== undefined && binding.allowedTools === undefined) {
      throw new DenyToolsWithoutAllowedToolsError(name, denyTools);
    }
  }

  for (const [name, binding] of Object.entries(mcpServers)) {
    const restriction = restrictions[name];
    if (restriction?.disable === true) continue;

    const resolved = resolveBinding(name, binding, catalog);
    applyDenyTools(resolved, restriction?.denyTools);

    if (resolved.allowedTools !== undefined && resolved.allowedTools.length === 0) {
      continue;
    }

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

/** Apply a step-level denyTools subtraction to a resolved server. Safe
 *  by the time we reach here — resolveEffectiveMcp has already rejected
 *  bindings that lack allowedTools, so every call here has a materialized
 *  allowlist to filter. */
function applyDenyTools(
  resolved: ResolvedMcpServer,
  denyTools: readonly string[] | undefined,
): void {
  if (denyTools === undefined || denyTools.length === 0) return;
  const denySet = new Set(denyTools);
  resolved.allowedTools = (resolved.allowedTools ?? []).filter(
    tool => denySet.has(tool) === false,
  );
}
