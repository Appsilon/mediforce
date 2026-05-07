import { NextResponse } from 'next/server';
import { UpdateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(
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

  const denied = agent.namespace ? requireNamespaceAccess(caller, agent.namespace) : null;
  if (denied) return denied;

  return NextResponse.json({ agent });
}

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

  const denied = agent.namespace ? requireNamespaceAccess(caller, agent.namespace) : null;
  if (denied) return denied;

  const body = await request.json();
  const input = UpdateAgentDefinitionInputSchema.parse(body);
  const updated = await agentDefinitionRepo.update(id, input);
  return NextResponse.json({ agent: updated });
}
