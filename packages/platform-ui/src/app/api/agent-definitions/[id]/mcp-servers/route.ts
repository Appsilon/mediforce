import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.getById(id);
  if (agent === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ mcpServers: agent.mcpServers ?? {} });
}
