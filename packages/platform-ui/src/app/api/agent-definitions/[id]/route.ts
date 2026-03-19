import { NextResponse } from 'next/server';
import { UpdateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.getById(id);
  if (!agent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ agent });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json();
  const input = UpdateAgentDefinitionInputSchema.parse(body);
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.update(id, input);
  return NextResponse.json({ agent });
}
