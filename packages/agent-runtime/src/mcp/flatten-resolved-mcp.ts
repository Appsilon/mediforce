import type { McpServerConfig, ResolvedMcpConfig } from '@mediforce/platform-core';

/** Flatten a ResolvedMcpConfig into the legacy McpServerConfig[] shape
 *  that McpClientManager (cowork chat route) and any stray consumers
 *  still expect. The server name, which is the map key in the resolved
 *  config, becomes the `name` field.
 *
 *  Returns an empty array when the resolved config has no servers. */
export function flattenResolvedMcpToLegacy(
  resolved: ResolvedMcpConfig,
): McpServerConfig[] {
  return Object.entries(resolved.servers).map(([name, server]) => {
    if (server.type === 'stdio') {
      return {
        name,
        command: server.command,
        args: server.args ?? [],
        ...(server.env !== undefined ? { env: server.env } : {}),
        ...(server.allowedTools !== undefined ? { allowedTools: server.allowedTools } : {}),
      };
    }
    return {
      name,
      url: server.url,
      args: [],
      ...(server.allowedTools !== undefined ? { allowedTools: server.allowedTools } : {}),
    };
  });
}
