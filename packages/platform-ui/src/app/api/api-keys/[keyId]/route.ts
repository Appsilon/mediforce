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

  const { keyId } = await params;
  const url = new URL(request.url);
  const queryUserId = url.searchParams.get('userId');

  if (caller.kind === 'apiKey') {
    if (!queryUserId) {
      return NextResponse.json(
        { error: 'Global API key requires ?userId=<uid> parameter' },
        { status: 400 },
      );
    }
    const keys = await apiKeyRepo.listByUser(queryUserId);
    if (!keys.some((k) => k.id === keyId)) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }
  } else {
    const ownerUid = queryUserId ?? caller.uid;
    const keys = await apiKeyRepo.listByUser(ownerUid);
    if (!keys.some((k) => k.id === keyId)) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }
  }

  const revoked = await apiKeyRepo.revoke(keyId);
  if (!revoked) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
