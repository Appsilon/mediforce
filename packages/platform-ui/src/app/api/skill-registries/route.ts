import { NextResponse } from 'next/server';
import { CreateSkillRegistryInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(request: Request): Promise<NextResponse> {
  const { skillRegistryRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const all = await skillRegistryRepo.list();
  const filtered = caller.kind === 'apiKey'
    ? all
    : all.filter((reg) =>
        typeof reg.namespace === 'string' && caller.namespaces.has(reg.namespace),
      );
  return NextResponse.json({ skillRegistries: filtered });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { skillRegistryRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const body = await request.json();
  const input = CreateSkillRegistryInputSchema.parse(body);

  if (typeof input.namespace === 'string') {
    const denied = requireNamespaceAccess(caller, input.namespace);
    if (denied) return denied;
  }

  const skillRegistry = await skillRegistryRepo.create(input);
  return NextResponse.json({ skillRegistry }, { status: 201 });
}
