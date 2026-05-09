import { NextResponse } from 'next/server';
import { UpdateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess, type CallerIdentity } from '@/lib/api-auth';

function canRead(caller: CallerIdentity, agent: { namespace?: string; visibility: string }): NextResponse | null {
  if (caller.kind === 'apiKey') return null;
  if (agent.visibility === 'public') return null;
  if (typeof agent.namespace === 'string' && caller.namespaces.has(agent.namespace)) return null;
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

function canMutate(caller: CallerIdentity, agent: { namespace?: string }): NextResponse | null {
  if (caller.kind === 'apiKey') return null;
  if (typeof agent.namespace !== 'string') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return requireNamespaceAccess(caller, agent.namespace);
}

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

  const denied = canRead(caller, agent);
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

  const denied = canMutate(caller, agent);
  if (denied) return denied;

  const body = await request.json();
  const input = UpdateAgentDefinitionInputSchema.parse(body);
  const updated = await agentDefinitionRepo.update(id, input);
  return NextResponse.json({ agent: updated });
}

export async function PATCH(
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
