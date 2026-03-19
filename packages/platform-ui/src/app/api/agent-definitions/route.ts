import { NextResponse } from 'next/server';
import { CreateAgentDefinitionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

export async function GET(): Promise<NextResponse> {
  const { agentDefinitionRepo } = getPlatformServices();
  const agents = await agentDefinitionRepo.list();
  return NextResponse.json({ agents });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json();
  const input = CreateAgentDefinitionInputSchema.parse(body);
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.create(input);
  return NextResponse.json({ agent }, { status: 201 });
}
