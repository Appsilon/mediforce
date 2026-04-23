import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  try {
    const { instanceId } = await params;
    const { instanceRepo } = getPlatformServices();

    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    if (instance.status !== 'running' && instance.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot cancel instance in status '${instance.status}'` },
        { status: 409 },
      );
    }

    await instanceRepo.update(instanceId, {
      status: 'failed',
      error: 'Cancelled by user',
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ instanceId, status: 'failed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
