import { createRouteAdapter } from '@/lib/route-adapter';
import { getAgentRunCardStatusCounts } from '@mediforce/platform-api/handlers';
import {
  GetAgentRunCardStatusCountsInputSchema,
  type GetAgentRunCardStatusCountsInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/agent-runs/card-status-counts
 *
 * Grouped `AgentRunCardStatus` counts for the Agents tab's KPI cards — see
 * `GetAgentRunCardStatusCountsInputSchema`'s docstring. Workspace gating
 * lives in `scope.agentRuns.countByCardStatus`.
 */
export const GET = createRouteAdapter<
  typeof GetAgentRunCardStatusCountsInputSchema,
  GetAgentRunCardStatusCountsInput
>(
  GetAgentRunCardStatusCountsInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    const processInstanceIds = params.getAll('processInstanceId');
    return {
      namespace: params.get('namespace') ?? undefined,
      status: params.get('status') ?? undefined,
      processInstanceIds: processInstanceIds.length > 0 ? processInstanceIds : undefined,
    };
  },
  getAgentRunCardStatusCounts,
);
