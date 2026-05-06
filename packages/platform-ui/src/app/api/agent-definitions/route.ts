import { NextResponse } from 'next/server';
import { CreateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, filterByNamespace, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(request: Request): Promise<NextResponse> {
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const agents = await agentDefinitionRepo.list();
  const filtered = filterByNamespace(caller, agents as Array<{ namespace?: string } & Record<string, unknown>>);
  return NextResponse.json({ agents: filtered });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { agentDefinitionRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const body = await request.json();
  const input = CreateAgentDefinitionInputSchema.parse(body);

  const ns = (body as Record<string, unknown>).namespace;
  if (typeof ns === 'string') {
    const denied = requireNamespaceAccess(caller, ns);
    if (denied) return denied;
  }

  const agent = await agentDefinitionRepo.create(input);
  return NextResponse.json({ agent }, { status: 201 });
}
