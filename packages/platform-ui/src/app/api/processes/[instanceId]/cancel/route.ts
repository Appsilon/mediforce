import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  try {
    const { instanceId } = await params;
    const { instanceRepo, namespaceRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo);
    if (caller instanceof NextResponse) return caller;

    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const denied = requireNamespaceAccess(caller, instance.namespace);
    if (denied) return denied;

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
