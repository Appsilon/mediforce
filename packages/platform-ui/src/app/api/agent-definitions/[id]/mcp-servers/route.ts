import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { agentDefinitionRepo, namespaceRepo, apiKeyRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;

  const agent = await agentDefinitionRepo.getById(id);
  if (agent === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const denied = agent.namespace ? requireNamespaceAccess(caller, agent.namespace) : null;
  if (denied) return denied;

  return NextResponse.json({ mcpServers: agent.mcpServers ?? {} });
}
