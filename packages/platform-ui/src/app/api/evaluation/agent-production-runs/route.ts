import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentProductionRunsPage } from '@mediforce/platform-api/handlers';
import { ListAgentProductionRunsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/agent-production-runs — The finished production runs of the Steps that use an Agent, newest first. */
export const GET = createRouteAdapter(
  ListAgentProductionRunsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      agentId: params.get('agentId') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
    };
  },
  listAgentProductionRunsPage,
);
