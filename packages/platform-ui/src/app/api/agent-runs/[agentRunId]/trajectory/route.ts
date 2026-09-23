import { createRouteAdapter } from '@/lib/route-adapter';
import { getAgentTrajectory } from '@mediforce/platform-api/handlers';
import {
  GetAgentTrajectoryInputSchema,
  type GetAgentTrajectoryInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ agentRunId: string }>;
}

/**
 * GET /api/agent-runs/:agentRunId/trajectory
 *
 * The Agent Run's Agent Trajectory (ADR-0023 D8). An unknown run and a run in
 * a workspace the caller is not a member of are both 404.
 */
export const GET = createRouteAdapter<
  typeof GetAgentTrajectoryInputSchema,
  GetAgentTrajectoryInput,
  unknown,
  RouteContext
>(
  GetAgentTrajectoryInputSchema,
  async (_req, ctx) => ({ agentRunId: (await ctx.params).agentRunId }),
  getAgentTrajectory,
);
