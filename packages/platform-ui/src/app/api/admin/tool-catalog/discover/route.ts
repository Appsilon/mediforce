import { createRouteAdapter } from '@/lib/route-adapter';
import {
  DiscoverMcpToolsInputApiSchema,
  type DiscoverMcpToolsInputApi,
} from '@mediforce/platform-api/contract';
import { discoverMcpTools } from '@mediforce/platform-api/handlers';

export const POST = createRouteAdapter<
  typeof DiscoverMcpToolsInputApiSchema,
  DiscoverMcpToolsInputApi
>(
  DiscoverMcpToolsInputApiSchema,
  async (req) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ...body,
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
    };
  },
  discoverMcpTools,
);
