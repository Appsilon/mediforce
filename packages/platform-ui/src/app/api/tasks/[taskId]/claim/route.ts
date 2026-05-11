import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';

/**
 * POST /api/tasks/:taskId/claim
 *
 * Body: { "userId": "api-user" }
 *
 * Claims a pending task for the given user. Task must be in 'pending' status.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  try {
    const { taskId } = await params;
    const body = (await req.json()) as { userId?: string };
    const userId = body.userId ?? 'api-user';

    const { humanTaskRepo, instanceRepo, auditRepo, namespaceRepo, apiKeyRepo } = getPlatformServices();

    const caller = await resolveCallerIdentity(req, namespaceRepo, apiKeyRepo);
    if (caller instanceof NextResponse) return caller;

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const instance = await instanceRepo.getById(task.processInstanceId);
    const denied = requireNamespaceAccess(caller, instance?.namespace);
    if (denied) return denied;

    if (task.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot claim a ${task.status} task` },
        { status: 409 },
      );
    }

    const claimed = await humanTaskRepo.claim(taskId, userId);

    const now = new Date().toISOString();
    await auditRepo.append({
      actorId: userId,
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.claimed',
      description: `User '${userId}' claimed task '${taskId}' for step '${task.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, userId, stepId: task.stepId },
      outputSnapshot: { status: 'claimed', assignedUserId: userId },
      basis: 'User claimed task via API',
      entityType: 'humanTask',
      entityId: taskId,
      processInstanceId: task.processInstanceId,
    });

    return NextResponse.json(claimed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
