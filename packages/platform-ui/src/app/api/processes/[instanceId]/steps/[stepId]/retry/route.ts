import { NextRequest, NextResponse } from 'next/server';
import { InvalidTransitionError } from '@mediforce/workflow-engine';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * POST /api/processes/:instanceId/steps/:stepId/retry
 *
 * Retries a single failed step: flips the instance back to 'running' on the
 * same step and fires the auto-runner. Variables are preserved — no rewind
 * of prior steps.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string; stepId: string }> },
): Promise<NextResponse> {
  try {
    const { instanceId, stepId } = await params;
    const { engine, instanceRepo, namespaceRepo, apiKeyRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo, apiKeyRepo);
    if (caller instanceof NextResponse) return caller;

    const instance = await instanceRepo.getById(instanceId);
    const denied = requireNamespaceAccess(caller, instance?.namespace);
    if (denied) return denied;

    const result = await engine.retryStep(instanceId, stepId, {
      id: 'api-user',
      role: 'operator',
    });

    const appUrl = getAppBaseUrl();
    fetch(`${appUrl}/api/processes/${instanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({ triggeredBy: 'api-user' }),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      instanceId,
      stepId,
      status: result.status,
    });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
