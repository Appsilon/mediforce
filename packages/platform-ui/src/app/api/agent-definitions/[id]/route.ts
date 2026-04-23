import { NextResponse } from 'next/server';
import { UpdateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { getAgentDefinition } from '@mediforce/platform-api/handlers';
import { GetAgentDefinitionInputSchema } from '@mediforce/platform-api/contract';
import type { GetAgentDefinitionInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/agent-definitions/:id — single agent definition. Missing → 404.
 */
export const GET = createRouteAdapter<
  typeof GetAgentDefinitionInputSchema,
  GetAgentDefinitionInput,
  RouteContext
>(
  GetAgentDefinitionInputSchema,
  async (_req, ctx) => ({ id: (await ctx.params).id }),
  (input) =>
    getAgentDefinition(input, {
      agentDefinitionRepo: getPlatformServices().agentDefinitionRepo,
    }),
);

/**
 * PUT /api/agent-definitions/:id — update. Mutation, still inline until Phase 2.
 */
export async function PUT(
  request: Request,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json();
  const input = UpdateAgentDefinitionInputSchema.parse(body);
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.update(id, input);
  return NextResponse.json({ agent });
}
