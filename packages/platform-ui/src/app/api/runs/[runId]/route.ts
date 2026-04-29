import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

/**
 * Polling endpoint for webhook + manual triggers:
 *   GET /api/runs/<runId>
 *     → { runId, status, currentStepId, error, finalOutput,
 *         definitionName, definitionNamespace }
 *
 * `finalOutput` resolves to the most recent step's output once the run has
 * completed (status='completed') or failed (status='failed'). For running
 * instances it stays `null` so callers can distinguish "still working" from
 * "done with empty output". Same backing store as /api/processes/<id>; this
 * route is the public-facing alias for webhook-driven runs (decision B5).
 *
 * `definitionName` and `definitionNamespace` let clients (CLI, scripts,
 * MCP servers) construct the human-facing URL — `<baseUrl>/<namespace>/
 * processes/<runId>` — without a second roundtrip to list workflows.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await params;
  const { instanceRepo, processRepo } = getPlatformServices();
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

  // Resolve namespace from the instance's workflow definition. Definition
  // versions are stored as strings on the instance — coerce on the way in.
  // Failure here is non-fatal: the run record is still returnable without a
  // namespace; clients that need the URL handle a null gracefully.
  let definitionNamespace: string | null = null;
  const versionNumber = Number(instance.definitionVersion);
  if (Number.isInteger(versionNumber) && versionNumber > 0) {
    const definition = await processRepo.getWorkflowDefinition(
      instance.definitionName,
      versionNumber,
    );
    definitionNamespace = definition?.namespace ?? null;
  }

  return NextResponse.json({
    runId,
    status: instance.status,
    currentStepId: instance.currentStepId,
    error: instance.error,
    finalOutput,
    definitionName: instance.definitionName,
    definitionNamespace,
  });
}
