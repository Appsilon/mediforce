import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentValidations } from '@mediforce/platform-api/handlers';
import { ListAgentValidationsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/evaluation/qualification/agents — every evaluable agent's
 * validation status in the namespace, one request instead of one per agent.
 */
export const GET = createRouteAdapter(
  ListAgentValidationsInputSchema,
  (req) => ({ namespace: req.nextUrl.searchParams.get('namespace') ?? undefined }),
  listAgentValidations,
);
