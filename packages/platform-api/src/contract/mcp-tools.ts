import { z } from 'zod';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

/** An unauthenticated HTTP MCP server to probe. Authenticated HTTP servers
 *  and stdio catalog entries cannot be probed (stdio would spawn arbitrary
 *  commands on the API host). */
export const DiscoverMcpToolsInputApiSchema = NamespaceQuery.extend({
  type: z.literal('http'),
  url: z.string().url(),
});

export const DiscoverMcpToolsOutputSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
    }),
  ),
});

export type DiscoverMcpToolsInputApi = z.infer<typeof DiscoverMcpToolsInputApiSchema>;
export type DiscoverMcpToolsOutput = z.infer<typeof DiscoverMcpToolsOutputSchema>;
