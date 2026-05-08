import { NextResponse } from 'next/server';
import { CreateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(request: Request): Promise<NextResponse> {
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const agents = await agentDefinitionRepo.list();
  const filtered = caller.kind === 'apiKey'
    ? agents
    : agents.filter((agent) => {
        if (agent.visibility === 'public') return true;
        return typeof agent.namespace === 'string' && caller.namespaces.has(agent.namespace);
      });
  return NextResponse.json({ agents: filtered });
}

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
