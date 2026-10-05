import { McpClientManager } from '@mediforce/mcp-client';
import type { McpServerConfig } from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin } from '../../auth';
import { NotFoundError, ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  DiscoverMcpToolsInputApi,
  DiscoverMcpToolsOutput,
} from '../../contract/mcp-tools';

const PROBE_SERVER_NAME = 'probe';
const PROBE_PREFIX = `${PROBE_SERVER_NAME}__`;

async function resolveServerConfig(
  input: DiscoverMcpToolsInputApi,
  scope: CallerScope,
): Promise<McpServerConfig> {
  if (input.type === 'http') {
    return { name: PROBE_SERVER_NAME, args: [], url: input.url };
  }
  const entry = await scope.toolCatalog.getById(input.namespace, input.catalogId);
  if (entry === null) {
    throw new NotFoundError(`Tool catalog entry '${input.catalogId}' not found`);
  }
  return {
    name: PROBE_SERVER_NAME,
    command: entry.command,
    args: entry.args ?? [],
    ...(entry.env !== undefined ? { env: entry.env } : {}),
  };
}

export async function discoverMcpTools(
  input: DiscoverMcpToolsInputApi,
  scope: CallerScope,
): Promise<DiscoverMcpToolsOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const manager = new McpClientManager([await resolveServerConfig(input, scope)]);
  try {
    const definitions = await manager.connect();
    return {
      tools: definitions.map((definition) => ({
        name: definition.function.name.slice(PROBE_PREFIX.length),
        ...(definition.function.description !== ''
          ? { description: definition.function.description }
          : {}),
      })),
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Failed to list MCP tools';
    throw new ValidationError(
      input.type === 'stdio'
        ? `Could not list tools: the server process failed to start or exited on the API host (${reason}). ` +
            'Catalog commands that only exist in the agent container image cannot be probed here.'
        : `Could not list tools: ${reason}`,
    );
  } finally {
    await manager.disconnect();
  }
}
