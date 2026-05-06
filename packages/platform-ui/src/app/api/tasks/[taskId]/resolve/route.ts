import { NextRequest, NextResponse } from 'next/server';
import { resolveTask, isResolveError } from '@/lib/resolve-task';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * POST /api/tasks/:taskId/resolve
 *
 * Thin HTTP wrapper around resolveTask(). See resolve-task.ts for logic.
 *
 * Body shapes:
 * - Verdict:     { "verdict": "approve" | "revise", "comment": "..." }
 * - Params:      { "paramValues": { ... } }
 * - File upload: { "attachments": [{ name, size, type, storagePath, downloadUrl }] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const { humanTaskRepo, instanceRepo, namespaceRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo);
    if (caller instanceof NextResponse) return caller;

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const instance = await instanceRepo.getById(task.processInstanceId);
    const denied = requireNamespaceAccess(caller, instance?.namespace);
    if (denied) return denied;

    const body = (await req.json()) as Record<string, unknown>;

    const result = await resolveTask(taskId, body);

    if (isResolveError(result)) {
      return NextResponse.json(
        { error: result.error },
        { status: result.httpStatus },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
