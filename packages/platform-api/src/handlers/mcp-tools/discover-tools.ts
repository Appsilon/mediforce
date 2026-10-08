import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { McpClientManager } from '@mediforce/mcp-client';
import { assertNamespaceAccess } from '../../auth';
import { ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  DiscoverMcpToolsInputApi,
  DiscoverMcpToolsOutput,
} from '../../contract/mcp-tools';

const PROBE_SERVER_NAME = 'probe';
const PROBE_PREFIX = `${PROBE_SERVER_NAME}__`;

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  if (isIP(lower) === 6) {
    return lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  const [first, second] = lower.split('.').map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

async function assertPublicHttpTarget(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('Tool discovery only supports http(s) URLs');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) !== 0
    ? [hostname]
    : (await lookup(hostname, { all: true }).catch(() => [])).map((record) => record.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ValidationError('Tool discovery is limited to publicly reachable servers');
  }
}

export async function discoverMcpTools(
  input: DiscoverMcpToolsInputApi,
  scope: CallerScope,
): Promise<DiscoverMcpToolsOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  await assertPublicHttpTarget(input.url);
  const manager = new McpClientManager([
    { name: PROBE_SERVER_NAME, args: [], url: input.url },
  ]);
  try {
    const definitions = await manager.connect();
    return {
      tools: definitions.map((definition) => ({
        name: definition.function.name.startsWith(PROBE_PREFIX)
          ? definition.function.name.slice(PROBE_PREFIX.length)
          : definition.function.name,
        ...(definition.function.description !== ''
          ? { description: definition.function.description }
          : {}),
      })),
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Failed to list MCP tools';
    throw new ValidationError(`Could not list tools: ${reason}`);
  } finally {
    await manager.disconnect();
  }
}
