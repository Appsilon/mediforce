import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';

/**
 * GET /api/cowork/by-instance/:instanceId
 *
 * Returns the most recent active cowork session for a given process instance.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { instanceId } = await params;
  const { coworkSessionRepo } = getPlatformServices();

  const sessions = await coworkSessionRepo.getByInstanceId(instanceId);
  const activeSessions = sessions.filter((s) => s.status === 'active');

  if (activeSessions.length === 0) {
    return NextResponse.json(
      { error: `No active cowork session found for instance '${instanceId}'` },
      { status: 404 },
    );
  }

  // Return the most recent active session (last in the list)
  const session = activeSessions[activeSessions.length - 1];

  return NextResponse.json(session);
}
