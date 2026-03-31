import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';

/**
 * GET /api/cowork/:sessionId
 *
 * Returns the cowork session including conversation history and current artifact.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const { coworkSessionRepo } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json(session);
}
