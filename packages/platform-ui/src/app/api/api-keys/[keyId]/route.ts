import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ keyId: string }> },
): Promise<NextResponse> {
  const { namespaceRepo, apiKeyRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;
  if (caller.kind !== 'user') {
    return NextResponse.json({ error: 'Per-user auth required' }, { status: 403 });
  }

  const { keyId } = await params;
  const keys = await apiKeyRepo.listByUser(caller.uid);
  const key = keys.find((k) => k.id === keyId);
  if (!key) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  const revoked = await apiKeyRepo.revoke(keyId);
  if (!revoked) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
