import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentVersions } from '@mediforce/platform-api/handlers';
import {
  ListAgentVersionsInputSchema,
  type ListAgentVersionsInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createRouteAdapter<
  typeof ListAgentVersionsInputSchema,
  ListAgentVersionsInput,
  unknown,
  RouteContext
>(
  ListAgentVersionsInputSchema,
  async (_req, ctx) => ({ id: (await ctx.params).id }),
  listAgentVersions,
);
