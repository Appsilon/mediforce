import { createRouteAdapter } from '@/lib/route-adapter';
import { listScores } from '@mediforce/platform-api/handlers';
import {
  ListScoresInputSchema,
  type ListScoresInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/scores
 *
 * Accepted query params: `namespace`, `agentRunId`, `runId`, `stepId`
 * (requires `runId`), `name`, `limit` (1..1000, default 100). Newest first.
 */
export const GET = createRouteAdapter<typeof ListScoresInputSchema, ListScoresInput>(
  ListScoresInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      agentRunId: params.get('agentRunId') ?? undefined,
      runId: params.get('runId') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      name: params.get('name') ?? undefined,
      limit: params.get('limit') ?? undefined,
    };
  },
  listScores,
);
