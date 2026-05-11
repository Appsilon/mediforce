import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * GET /api/tasks/:taskId
 *
 * Returns full task details including completionData (agent output for review tasks).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const { humanTaskRepo, instanceRepo, namespaceRepo, apiKeyRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo, apiKeyRepo);
    if (caller instanceof NextResponse) return caller;

    const task = await humanTaskRepo.getById(taskId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const instance = await instanceRepo.getById(task.processInstanceId);
    const denied = requireNamespaceAccess(caller, instance?.namespace);
    if (denied) return denied;

    return NextResponse.json(task);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
