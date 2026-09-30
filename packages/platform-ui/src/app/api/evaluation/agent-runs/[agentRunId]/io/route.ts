import type { z } from 'zod';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getAgentRunIo } from '@mediforce/platform-api/handlers';
import { GetAgentRunIoInputSchema } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ agentRunId: string }>;
}

/** GET /api/evaluation/agent-runs/:agentRunId/io — What the run's step was given and what it returned. */
export const GET = createRouteAdapter<typeof GetAgentRunIoInputSchema, z.infer<typeof GetAgentRunIoInputSchema>, unknown, RouteContext>(
  GetAgentRunIoInputSchema,
  async (_req, ctx) => ({ agentRunId: (await ctx.params).agentRunId }),
  getAgentRunIo,
);
