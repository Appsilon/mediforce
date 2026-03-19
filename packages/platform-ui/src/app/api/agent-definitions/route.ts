import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

export async function GET(): Promise<NextResponse> {
  const { agentDefinitionRepo } = getPlatformServices();
  const agents = await agentDefinitionRepo.list();
  return NextResponse.json({ agents });
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as Record<string, unknown>;
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.create({
    name: body.name as string,
    iconName: body.iconName as string,
    description: body.description as string,
    inputDescription: (body.inputDescription as string) ?? '',
    outputDescription: (body.outputDescription as string) ?? '',
    foundationModel: body.foundationModel as string,
    systemPrompt: body.systemPrompt as string,
    skillFileNames: (body.skillFileNames as string[]) ?? [],
  });
  return NextResponse.json({ agent }, { status: 201 });
}
