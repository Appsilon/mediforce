import { NextResponse } from 'next/server';
import { CreateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';
import { listAgentDefinitions } from '@mediforce/platform-api/handlers';
import { ListAgentDefinitionsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/agent-definitions
 *
 * List agent definitions visible to the caller. Workspace + visibility
 * filtering lives in `scope.agentDefinitions`.
 */
export const GET = createRouteAdapter(
  ListAgentDefinitionsInputSchema,
  () => ({}),
  listAgentDefinitions,
);

export async function POST(request: Request): Promise<NextResponse> {
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const body = await request.json();
  const input = CreateAgentDefinitionInputSchema.parse(body);

  if (typeof input.namespace === 'string') {
    const denied = requireNamespaceAccess(caller, input.namespace);
    if (denied) return denied;
  }

  const agent = await agentDefinitionRepo.create(input);
  return NextResponse.json({ agent }, { status: 201 });
}
