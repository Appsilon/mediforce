import { createRouteAdapter } from '@/lib/route-adapter';
import {
  upsertAgentMcpBinding,
  deleteAgentMcpBinding,
} from '@mediforce/platform-api/handlers';
import {
  UpsertAgentMcpBindingInputSchema,
  DeleteAgentMcpBindingInputSchema,
  type UpsertAgentMcpBindingInput,
  type DeleteAgentMcpBindingInput,
} from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string; name: string }>;
}

export const PUT = createRouteAdapter<
  typeof UpsertAgentMcpBindingInputSchema,
  UpsertAgentMcpBindingInput,
  unknown,
  RouteContext
>(
  UpsertAgentMcpBindingInputSchema,
  async (req, ctx) => {
    const { id, name } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return { id, name, binding: body };
  },
  upsertAgentMcpBinding,
);

export const DELETE = createRouteAdapter<
  typeof DeleteAgentMcpBindingInputSchema,
  DeleteAgentMcpBindingInput,
  unknown,
  RouteContext
>(
  DeleteAgentMcpBindingInputSchema,
  async (_req, ctx) => {
    const { id, name } = await ctx.params;
    return { id, name };
  },
  deleteAgentMcpBinding,
);
