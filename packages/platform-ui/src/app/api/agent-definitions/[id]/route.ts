import { NextResponse } from 'next/server';
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
  const body = (await request.json()) as Record<string, unknown>;
  const { agentDefinitionRepo } = getPlatformServices();
  const agent = await agentDefinitionRepo.update(id, {
    name: body.name as string | undefined,
    iconName: body.iconName as string | undefined,
    description: body.description as string | undefined,
    foundationModel: body.foundationModel as string | undefined,
    systemPrompt: body.systemPrompt as string | undefined,
    skillFileNames: body.skillFileNames as string[] | undefined,
  });
  return NextResponse.json({ agent });
}
