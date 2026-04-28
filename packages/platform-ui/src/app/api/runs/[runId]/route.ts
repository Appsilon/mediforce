import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

/**
 * Polling endpoint for webhook + manual triggers:
 *   GET /api/runs/<runId>  →  { runId, status, currentStepId, finalOutput }
 *
 * `finalOutput` resolves to the most recent step's output once the run has
 * completed (status='completed') or failed (status='failed'). For running
 * instances it stays `null` so callers can distinguish "still working" from
 * "done with empty output". Same backing store as /api/processes/<id>; this
 * route is the public-facing alias for webhook-driven runs (decision B5).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await params;
  const { instanceRepo } = getPlatformServices();
  const instance = await instanceRepo.getById(runId);

  if (!instance) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  let finalOutput: unknown = null;
  if (instance.status === 'completed' || instance.status === 'failed') {
    // Walk executions in reverse insertion order — repository preserves
    // execution order, and timestamp-based sort is unreliable when chained
    // actions complete inside the same millisecond (which the in-memory
    // repo can produce, and Firestore can produce on hot paths too).
    const executions = await instanceRepo.getStepExecutions(runId);
    for (let i = executions.length - 1; i >= 0; i--) {
      const exec = executions[i];
      if (exec.status === 'completed' && exec.output !== null && exec.output !== undefined) {
        finalOutput = exec.output;
        break;
      }
    }
  }

  return NextResponse.json({
    runId,
    status: instance.status,
    currentStepId: instance.currentStepId,
    error: instance.error,
    finalOutput,
  });
}
