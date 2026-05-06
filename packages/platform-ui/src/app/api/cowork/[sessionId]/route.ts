import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * GET /api/cowork/:sessionId
 *
 * Returns the cowork session including conversation history and current artifact.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await params;
  const { coworkSessionRepo, instanceRepo, namespaceRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(req, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const instance = await instanceRepo.getById(session.processInstanceId);
  const denied = requireNamespaceAccess(caller, instance?.namespace);
  if (denied) return denied;

  return NextResponse.json(session);
}
