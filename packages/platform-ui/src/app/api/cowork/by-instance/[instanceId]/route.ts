import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

/**
 * GET /api/cowork/by-instance/:instanceId
 *
 * Returns the most recent active cowork session for a given process instance.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  const { instanceId } = await params;
  const { coworkSessionRepo } = getPlatformServices();

  const session = await coworkSessionRepo.findMostRecentActive(instanceId);
  if (!session) {
    return NextResponse.json(
      { error: `No active cowork session found for instance '${instanceId}'` },
      { status: 404 },
    );
  }

  return NextResponse.json(session);
}
