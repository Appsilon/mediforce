import { NextResponse } from 'next/server';
import { CreateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { listAgentDefinitions } from '@mediforce/platform-api/handlers';
import { ListAgentDefinitionsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/agent-definitions — list every registered agent definition.
 */
export const GET = createRouteAdapter(
  ListAgentDefinitionsInputSchema,
  () => ({}),
  (input) =>
    listAgentDefinitions(input, {
      agentDefinitionRepo: getPlatformServices().agentDefinitionRepo,
    }),
);

/**
 * POST /api/agent-definitions — create a new agent definition.
 * Mutation, still inline until Phase 2.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  const input = CreateAgentDefinitionInputSchema.parse(body);
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.create(input);
  return NextResponse.json({ agent }, { status: 201 });
}
