import { NextResponse } from 'next/server';
import { AgentMcpBindingSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
): Promise<NextResponse> {
  const { id, name } = await params;

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

  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.getById(id);
  if (agent === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (agent.kind !== 'cowork') {
    return NextResponse.json(
      { error: 'MCP bindings are only supported on cowork agents.' },
      { status: 400 },
    );
  }

  const nextMcpServers = { ...(agent.mcpServers ?? {}), [name]: parsed.data };
  const updated = await agentDefinitionRepo.update(id, { mcpServers: nextMcpServers });
  return NextResponse.json({ mcpServers: updated.mcpServers ?? {} });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
): Promise<NextResponse> {
  const { id, name } = await params;
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.getById(id);
  if (agent === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (agent.kind !== 'cowork') {
    return NextResponse.json(
      { error: 'MCP bindings are only supported on cowork agents.' },
      { status: 400 },
    );
  }

  const rest = { ...(agent.mcpServers ?? {}) };
  delete rest[name];
  const updated = await agentDefinitionRepo.update(id, { mcpServers: rest });
  return NextResponse.json({ mcpServers: updated.mcpServers ?? {} });
}
