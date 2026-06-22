import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentMcpBindings } from '@mediforce/platform-api/handlers';
import { ListAgentMcpBindingsInputSchema, type ListAgentMcpBindingsInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = createRouteAdapter<
  typeof ListAgentMcpBindingsInputSchema,
  ListAgentMcpBindingsInput,
  unknown,
  RouteContext
>(ListAgentMcpBindingsInputSchema, async (_req, ctx) => ({ id: (await ctx.params).id }), listAgentMcpBindings);
