import { NextResponse } from 'next/server';
import { AgentMcpBindingSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
): Promise<NextResponse> {
  const { id, name } = await params;
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = AgentMcpBindingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const agent = await agentDefinitionRepo.getById(id);
  if (agent === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const denied = agent.namespace ? requireNamespaceAccess(caller, agent.namespace) : null;
  if (denied) return denied;

  const nextMcpServers = { ...(agent.mcpServers ?? {}), [name]: parsed.data };
  const updated = await agentDefinitionRepo.update(id, { mcpServers: nextMcpServers });
  return NextResponse.json({ mcpServers: updated.mcpServers ?? {} });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
): Promise<NextResponse> {
  const { id, name } = await params;
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const agent = await agentDefinitionRepo.getById(id);
  if (agent === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const denied = agent.namespace ? requireNamespaceAccess(caller, agent.namespace) : null;
  if (denied) return denied;

  const rest = { ...(agent.mcpServers ?? {}) };
  delete rest[name];
  const updated = await agentDefinitionRepo.update(id, { mcpServers: rest });
  return NextResponse.json({ mcpServers: updated.mcpServers ?? {} });
}
