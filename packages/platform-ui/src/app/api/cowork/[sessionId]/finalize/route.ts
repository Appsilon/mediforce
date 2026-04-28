import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';

/**
 * POST /api/cowork/:sessionId/finalize
 *
 * Finalizes a cowork session: validates artifact, marks session finalized,
 * resumes the process instance, advances workflow, and triggers auto-runner.
 *
 * Body: { artifact: Record<string, unknown> }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse> {
  const { sessionId } = await params;
  const { coworkSessionRepo, instanceRepo, auditRepo, engine } = getPlatformServices();

  const session = await coworkSessionRepo.getById(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status !== 'active') {
    return NextResponse.json(
      { error: `Cannot finalize a ${session.status} session` },
      { status: 409 },
    );
  }

  const body = await req.json() as { artifact?: Record<string, unknown> };
  const artifact = body.artifact;

  if (!artifact || typeof artifact !== 'object') {
    return NextResponse.json(
      { error: 'artifact object required in body' },
      { status: 400 },
    );
  }

  // Finalize the session
  await coworkSessionRepo.finalize(sessionId, artifact);

  const now = new Date().toISOString();

  await auditRepo.append({
    actorId: 'api-user',
    actorType: 'user',
    actorRole: 'operator',
    action: 'cowork.session.finalized',
    description: `Cowork session '${sessionId}' finalized for step '${session.stepId}'`,
    timestamp: now,
    inputSnapshot: { sessionId, stepId: session.stepId },
    outputSnapshot: { artifactKeys: Object.keys(artifact) },
    basis: 'Cowork session finalized via API',
    entityType: 'coworkSession',
    entityId: sessionId,
    processInstanceId: session.processInstanceId,
  });

  // Resume paused process
  const instance = await instanceRepo.getById(session.processInstanceId);
  if (!instance) {
    return NextResponse.json(
      { error: `Process instance '${session.processInstanceId}' not found` },
      { status: 404 },
    );
  }

  if (instance.status !== 'paused') {
    return NextResponse.json(
      { error: `Process instance is '${instance.status}', expected 'paused'` },
      { status: 409 },
    );
  }

  await instanceRepo.update(session.processInstanceId, {
    status: 'running',
    pauseReason: null,
    updatedAt: now,
  });

  // Advance to next step with artifact as step output
  await engine.advanceStep(session.processInstanceId, artifact, {
    id: 'api-user',
    role: 'human',
  });

  // Trigger auto-runner for subsequent steps
  const appUrl = getAppBaseUrl();
  fetch(`${appUrl}/api/processes/${session.processInstanceId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
    },
    body: JSON.stringify({ triggeredBy: 'cowork-finalize' }),
  }).catch(() => {});

  const updatedInstance = await instanceRepo.getById(session.processInstanceId);

  return NextResponse.json({
    ok: true,
    sessionId,
    resolvedStepId: session.stepId,
    processInstanceId: session.processInstanceId,
    nextStepId: updatedInstance?.currentStepId ?? null,
    status: updatedInstance?.status ?? 'unknown',
  });
}
