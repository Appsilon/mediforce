import { createRouteAdapter } from '@/lib/route-adapter';
import { listStepAgentRuns } from '@mediforce/platform-api/handlers';
import { ListStepAgentRunsInputSchema } from '@mediforce/platform-api/contract';

/** GET /api/evaluation/agent-runs — The Step's finished production Agent Runs, newest first. */
export const GET = createRouteAdapter(
  ListStepAgentRunsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflowName: params.get('workflowName') ?? undefined,
      stepId: params.get('stepId') ?? undefined,
      limit: params.get('limit') ?? undefined,
    };
  },
  listStepAgentRuns,
);
