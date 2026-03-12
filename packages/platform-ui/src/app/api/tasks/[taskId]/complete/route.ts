import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';

/**
 * POST /api/tasks/:taskId/complete
 *
 * Body: { "verdict": "approve" | "revise", "comment": "..." }
 *
 * Completes a claimed task, resumes the process, advances to the next step,
 * and triggers the auto-runner for subsequent agent steps.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const body = (await req.json()) as {
      verdict?: string;
      comment?: string;
    };

    const verdict = body.verdict;
    if (verdict !== 'approve' && verdict !== 'revise') {
      return NextResponse.json(
        { error: 'verdict must be "approve" or "revise"' },
        { status: 400 },
      );
    }

    const comment = body.comment ?? '';

    const { humanTaskRepo, instanceRepo, auditRepo, engine } =
      getPlatformServices();

    // 1. Load and validate task
    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'claimed') {
      return NextResponse.json(
        { error: `Cannot complete a ${task.status} task — must be claimed first` },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const completionData = {
      verdict,
      comment,
      completedBy: task.assignedUserId,
      completedAt: now,
    };

    // 2. Mark task as completed
    await humanTaskRepo.complete(taskId, completionData);

    // 3. Write audit event
    await auditRepo.append({
      actorId: task.assignedUserId ?? 'api-user',
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.completed',
      description: `Task '${taskId}' completed with verdict '${verdict}' for step '${task.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, verdict, comment, stepId: task.stepId },
      outputSnapshot: { status: 'completed', completionData },
      basis: 'User submitted verdict via API',
      entityType: 'humanTask',
      entityId: taskId,
      processInstanceId: task.processInstanceId,
    });

    // 4. Resume the paused process instance
    const instance = await instanceRepo.getById(task.processInstanceId);
    if (!instance) {
      return NextResponse.json(
        { error: `Process instance '${task.processInstanceId}' not found` },
        { status: 404 },
      );
    }

    if (instance.status !== 'paused') {
      return NextResponse.json(
        { error: `Process instance is '${instance.status}', expected 'paused'` },
        { status: 409 },
      );
    }

    // Set instance back to running so advanceStep works
    await instanceRepo.update(task.processInstanceId, {
      status: 'running',
      pauseReason: null,
      updatedAt: now,
    });

    // 5. Advance to next step — include agent output for L3 review tasks
    const stepOutput: Record<string, unknown> = { verdict, comment, taskId };
    const agentReviewData = task.completionData as Record<string, unknown> | null;
    if (agentReviewData?.reviewType === 'agent_output_review') {
      const agentOutput = agentReviewData.agentOutput as Record<string, unknown> | undefined;
      if (agentOutput?.result) {
        stepOutput.agentOutput = agentOutput.result;
      }
    }

    await engine.advanceStep(
      task.processInstanceId,
      stepOutput,
      { id: task.assignedUserId ?? 'api-user', role: 'human' },
    );

    // 6. Write process resumed audit event
    await auditRepo.append({
      actorId: task.assignedUserId ?? 'api-user',
      actorType: 'user',
      actorRole: 'operator',
      action: 'process.resumed_after_task',
      description: `Process '${task.processInstanceId}' resumed after task verdict '${verdict}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        taskId,
        verdict,
        processInstanceId: task.processInstanceId,
      },
      outputSnapshot: {},
      basis: 'Task completion via API triggered process advancement',
      entityType: 'processInstance',
      entityId: task.processInstanceId,
      processInstanceId: task.processInstanceId,
    });

    // 7. Fire-and-forget: trigger auto-runner for next steps
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9003';
    fetch(`${appUrl}/api/processes/${task.processInstanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({
        triggeredBy: task.assignedUserId ?? 'api-user',
      }),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      taskId,
      verdict,
      processInstanceId: task.processInstanceId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
