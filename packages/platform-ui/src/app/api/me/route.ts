import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

export async function GET(request: Request): Promise<NextResponse> {
  const { namespaceRepo, apiKeyRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;

  if (caller.kind === 'apiKey') {
    return NextResponse.json({
      kind: 'apiKey',
      namespaces: [],
    });
  }

  return NextResponse.json({
    kind: 'user',
    uid: caller.uid,
    namespaces: [...caller.namespaces].sort(),
  });
}
