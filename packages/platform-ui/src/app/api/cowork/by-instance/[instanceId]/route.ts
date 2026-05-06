import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * GET /api/cowork/by-instance/:instanceId
 *
 * Returns the most recent active cowork session for a given process instance.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  const { instanceId } = await params;
  const { coworkSessionRepo, instanceRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(req, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const instance = await instanceRepo.getById(instanceId);
  const denied = requireNamespaceAccess(caller, instance?.namespace);
  if (denied) return denied;

  const session = await coworkSessionRepo.findMostRecentActive(instanceId);
  if (!session) {
    return NextResponse.json(
      { error: `No active cowork session found for instance '${instanceId}'` },
      { status: 404 },
    );
  }

  return NextResponse.json(session);
}
