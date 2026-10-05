import { z } from 'zod';

const NamespaceQuery = z.object({ namespace: z.string().min(1) });

/** Describes the server to probe: a Tool Catalog entry (stdio) or an
 *  unauthenticated HTTP URL. Authenticated HTTP servers cannot be probed. */
export const DiscoverMcpToolsInputApiSchema = z.discriminatedUnion('type', [
  NamespaceQuery.extend({
    type: z.literal('stdio'),
    catalogId: z.string().min(1),
  }),
  NamespaceQuery.extend({
    type: z.literal('http'),
    url: z.string().url(),
  }),
]);

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
