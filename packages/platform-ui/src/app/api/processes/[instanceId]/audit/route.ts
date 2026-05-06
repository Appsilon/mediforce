import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  try {
    const { instanceId } = await params;
    const { auditRepo, instanceRepo, namespaceRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo);
    if (caller instanceof NextResponse) return caller;

    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const denied = requireNamespaceAccess(caller, instance.namespace);
    if (denied) return denied;

    const events = await auditRepo.getByProcess(instanceId);
    return NextResponse.json(events);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
