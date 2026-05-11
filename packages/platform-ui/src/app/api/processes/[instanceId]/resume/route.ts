import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * POST /api/processes/:instanceId/resume
 *
 * Resumes a paused instance (e.g. after agent escalation) and re-triggers the auto-runner.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  try {
    const { instanceId } = await params;
    const { instanceRepo, auditRepo, namespaceRepo, apiKeyRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo, apiKeyRepo);
    if (caller instanceof NextResponse) return caller;

    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const denied = requireNamespaceAccess(caller, instance.namespace);
    if (denied) return denied;

    if (instance.status !== 'paused') {
      return NextResponse.json(
        { error: `Instance is '${instance.status}', expected 'paused'` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    await instanceRepo.update(instanceId, {
      status: 'running',
      pauseReason: null,
      error: null,
      updatedAt: now,
    });

    await auditRepo.append({
      actorId: 'api-user',
      actorType: 'user',
      actorRole: 'operator',
      action: 'process.resumed',
      description: `Process '${instanceId}' manually resumed via API`,
      timestamp: now,
      inputSnapshot: { previousPauseReason: instance.pauseReason },
      outputSnapshot: { status: 'running' },
      basis: 'Manual resume via API',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
    });

    // Fire-and-forget: trigger auto-runner
    const appUrl = getAppBaseUrl();
    fetch(`${appUrl}/api/processes/${instanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({ triggeredBy: 'api-user' }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, instanceId, status: 'running' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
