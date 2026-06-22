import { createRouteAdapter } from '@/lib/route-adapter';
import { deleteAgent, getByIdAdapter, updateAgent } from '@mediforce/platform-api/handlers';
import {
  GetAgentInputSchema,
  DeleteAgentInputSchema,
  UpdateAgentInputSchema,
  UpdateAgentBodySchema,
  type GetAgentInput,
  type DeleteAgentInput,
  type UpdateAgentInput,
  type UpdateAgentBody,
} from '@mediforce/platform-api/contract';
import { z } from 'zod';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/agents/:id — 404 if missing or private to another workspace.
 */
export const GET = createRouteAdapter<typeof GetAgentInputSchema, GetAgentInput, unknown, RouteContext>(
  GetAgentInputSchema,
  async (_req, ctx) => ({ id: (await ctx.params).id }),
  getByIdAdapter(
    (input, scope) => scope.agentDefinitions.getById(input.id),
    (input) => `Agent ${input.id} not found`,
    'agent',
  ),
);

const UpdateAgentRouteInputSchema = z.object({
  id: UpdateAgentInputSchema.shape.id,
  body: UpdateAgentBodySchema,
});
type UpdateAgentRouteInput = UpdateAgentInput & { body: UpdateAgentBody };

export const PUT = createRouteAdapter<typeof UpdateAgentRouteInputSchema, UpdateAgentRouteInput, unknown, RouteContext>(
  UpdateAgentRouteInputSchema,
  async (req, ctx) => ({
    id: (await ctx.params).id,
    body: (await req.json().catch(() => ({}))) as UpdateAgentBody,
  }),
  updateAgent,
);

export const DELETE = createRouteAdapter<typeof DeleteAgentInputSchema, DeleteAgentInput, unknown, RouteContext>(
  DeleteAgentInputSchema,
  async (_req, ctx) => ({ id: (await ctx.params).id }),
  deleteAgent,
);
