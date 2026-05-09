import { NextResponse } from 'next/server';
import { UpdateSkillRegistryInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess, type CallerIdentity } from '@/lib/api-auth';

function canRead(caller: CallerIdentity, registry: { namespace?: string }): NextResponse | null {
  if (caller.kind === 'apiKey') return null;
  if (typeof registry.namespace === 'string' && caller.namespaces.has(registry.namespace)) return null;
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

function canMutate(caller: CallerIdentity, registry: { namespace?: string }): NextResponse | null {
  if (caller.kind === 'apiKey') return null;
  if (typeof registry.namespace !== 'string') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return requireNamespaceAccess(caller, registry.namespace);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { skillRegistryRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const skillRegistry = await skillRegistryRepo.getById(id);
  if (!skillRegistry) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const denied = canRead(caller, skillRegistry);
  if (denied) return denied;
  return NextResponse.json({ skillRegistry });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { skillRegistryRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const existing = await skillRegistryRepo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const denied = canMutate(caller, existing);
  if (denied) return denied;

  const body = await request.json();
  const input = UpdateSkillRegistryInputSchema.parse(body);
  const updated = await skillRegistryRepo.update(id, input);
  return NextResponse.json({ skillRegistry: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const { skillRegistryRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const existing = await skillRegistryRepo.getById(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const denied = canMutate(caller, existing);
  if (denied) return denied;

  await skillRegistryRepo.delete(id);
  return NextResponse.json({ success: true });
}
