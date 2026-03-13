'use server';

import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
import { doc, updateDoc } from 'firebase/firestore';
import { getFirestoreDb } from '@mediforce/platform-infra';

// --------------------------------------------------------------------------
// claimTask — assign a pending task to the given user
// --------------------------------------------------------------------------
export async function claimTask(
  taskId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { humanTaskRepo, auditRepo } = getPlatformServices();

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'pending') {
      return { success: false, error: `Cannot claim a ${task.status} task` };
    }

    await humanTaskRepo.claim(taskId, userId);

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
      basis: 'User claimed task via UI',
      entityType: 'humanTask',
      entityId: taskId,
      processInstanceId: task.processInstanceId,
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// --------------------------------------------------------------------------
// unclaimTask — release a claimed task back to the queue
// --------------------------------------------------------------------------
export async function unclaimTask(
  taskId: string,
  userId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { humanTaskRepo, auditRepo } = getPlatformServices();

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'claimed') {
      return { success: false, error: `Cannot unclaim a ${task.status} task` };
    }

    if (task.assignedUserId !== userId) {
      return { success: false, error: 'Only the claimer can unclaim this task' };
    }

    // HumanTaskRepository has no unclaim method — update Firestore directly
    const db = getFirestoreDb();
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'humanTasks', taskId), {
      status: 'pending',
      assignedUserId: null,
      updatedAt: now,
    });

    await auditRepo.append({
      actorId: userId,
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.unclaimed',
      description: `User '${userId}' unclaimed task '${taskId}' for step '${task.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, userId, stepId: task.stepId },
      outputSnapshot: { status: 'pending', assignedUserId: null },
      basis: 'User unclaimed task via UI',
      entityType: 'humanTask',
      entityId: taskId,
      processInstanceId: task.processInstanceId,
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// --------------------------------------------------------------------------
// completeTask — submit verdict, resume process, advance step, trigger runner
// --------------------------------------------------------------------------
export async function completeTask(
  taskId: string,
  verdict: 'approve' | 'revise',
  comment: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { humanTaskRepo, instanceRepo, auditRepo, engine } =
      getPlatformServices();

    // 1. Load and validate task
    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'claimed') {
      return {
        success: false,
        error: `Cannot complete a ${task.status} task — must be claimed first`,
      };
    }

    const now = new Date().toISOString();
    const completionData = {
      verdict,
      comment,
      completedBy: task.assignedUserId,
      completedAt: now,
    };

    // 2. Mark task as completed in Firestore
    await humanTaskRepo.complete(taskId, completionData);

    // 3. Write task completion audit event
    await auditRepo.append({
      actorId: task.assignedUserId ?? 'user',
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.completed',
      description: `Task '${taskId}' completed with verdict '${verdict}' for step '${task.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, verdict, comment, stepId: task.stepId },
      outputSnapshot: { status: 'completed', completionData },
      basis: 'User submitted verdict via UI',
      entityType: 'humanTask',
      entityId: taskId,
      processInstanceId: task.processInstanceId,
    });

    // 4. Resume the paused process instance
    const instance = await instanceRepo.getById(task.processInstanceId);
    if (!instance) {
      return {
        success: false,
        error: `Process instance '${task.processInstanceId}' not found`,
      };
    }

    if (instance.status !== 'paused') {
      return {
        success: false,
        error: `Process instance is '${instance.status}', expected 'paused'`,
      };
    }

    // Set instance back to running so advanceStep won't throw InvalidTransitionError
    await instanceRepo.update(task.processInstanceId, {
      status: 'running',
      pauseReason: null,
      updatedAt: now,
    });

    // 5. Advance to the next step in the workflow
    // For L3 agent review tasks, include the agent output so downstream steps can access it
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
      { id: task.assignedUserId ?? 'user', role: 'human' },
    );

    // 6. Write process resumed audit event
    await auditRepo.append({
      actorId: task.assignedUserId ?? 'user',
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
      basis: 'Task completion triggered process advancement',
      entityType: 'processInstance',
      entityId: task.processInstanceId,
      processInstanceId: task.processInstanceId,
    });

    // 7. Fire-and-forget: trigger auto-runner to continue with next steps
    const appUrl =
      getAppBaseUrl();
    fetch(`${appUrl}/api/processes/${task.processInstanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({
        triggeredBy: task.assignedUserId ?? 'user',
      }),
    }).catch(() => {
      // Fire-and-forget — swallow errors; auto-runner will pick up on next poll
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
