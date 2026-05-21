import { NextResponse } from 'next/server';
import { UpdateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { resolveCallerIdentity, requireNamespaceAccess, type CallerIdentity } from '@/lib/api-auth';
import { getAgentDefinition } from '@mediforce/platform-api/handlers';
import { GetAgentDefinitionInputSchema } from '@mediforce/platform-api/contract';
import type { GetAgentDefinitionInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function canMutate(caller: CallerIdentity, agent: { namespace?: string }): NextResponse | null {
  if (caller.kind === 'apiKey') return null;
  if (typeof agent.namespace !== 'string') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return requireNamespaceAccess(caller, agent.namespace);
}

/**
 * GET /api/agent-definitions/:id
 *
 * 404 for missing ids (surfaces before visibility checks). For private
 * agents, the caller must be in the agent's namespace; public agents are
 * always readable.
 */
export const GET = createRouteAdapter<
  typeof GetAgentDefinitionInputSchema,
  GetAgentDefinitionInput,
  unknown,
  RouteContext
>(
  GetAgentDefinitionInputSchema,
  async (_req, ctx) => ({ id: (await ctx.params).id }),
  getAgentDefinition,
);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const agent = await agentDefinitionRepo.getById(id);
  if (!agent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const denied = canMutate(caller, agent);
  if (denied) return denied;

  const body = await request.json();
  const input = UpdateAgentDefinitionInputSchema.parse(body);
  const updated = await agentDefinitionRepo.update(id, input);
  return NextResponse.json({ agent: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const agent = await agentDefinitionRepo.getById(id);
  if (!agent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const denied = canMutate(caller, agent);
  if (denied) return denied;

  await agentDefinitionRepo.delete(id);
  return NextResponse.json({ success: true });
}
