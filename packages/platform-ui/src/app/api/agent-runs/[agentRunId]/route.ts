import { createRouteAdapter } from '@/lib/route-adapter';
import { getByIdAdapter } from '@mediforce/platform-api/handlers';
import { GetAgentRunInputSchema } from '@mediforce/platform-api/contract';
import type { GetAgentRunInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ agentRunId: string }>;
}

/**
 * GET /api/agent-runs/:agentRunId
 *
 * Single agent-run detail. Cross-workspace access surfaces as 404 — the
 * `scope.agentRuns.getById` wrapper returns null when the parent process
 * instance lives in a workspace the caller isn't a member of.
 */
export const GET = createRouteAdapter<typeof GetAgentRunInputSchema, GetAgentRunInput, unknown, RouteContext>(
  GetAgentRunInputSchema,
  async (_req, ctx) => ({ agentRunId: (await ctx.params).agentRunId }),
  getByIdAdapter((input, scope) => scope.agentRuns.getById(input.agentRunId), 'Agent run not found', 'run'),
);
