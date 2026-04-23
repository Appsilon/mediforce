'use server';

import { getPlatformServices } from '@/lib/platform-services';
import { getAdminFirestore } from '@mediforce/platform-infra';
import { resolveTask, isResolveError } from '@/lib/resolve-task';

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
    const db = getAdminFirestore();
    const now = new Date().toISOString();
    await db.collection('humanTasks').doc(taskId).update({
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
// completeParamsTask — submit param values, resume process, advance step
// --------------------------------------------------------------------------
export async function completeParamsTask(
  taskId: string,
  paramValues: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await resolveTask(taskId, { paramValues });
    if (isResolveError(result)) {
      return { success: false, error: result.error };
    }
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
  selectedIndex?: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const body: Record<string, unknown> = { verdict, comment };
    if (selectedIndex !== undefined) {
      body.selectedIndex = selectedIndex;
    }
    const result = await resolveTask(taskId, body);
    if (isResolveError(result)) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// --------------------------------------------------------------------------
// completeUploadTask — submit files, resume process, advance step
// --------------------------------------------------------------------------
interface FileInfo {
  name: string;
  size: number;
  type: string;
  storagePath?: string;
  downloadUrl?: string;
}

export async function completeUploadTask(
  taskId: string,
  files: FileInfo[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await resolveTask(taskId, { attachments: files });
    if (isResolveError(result)) {
      return { success: false, error: result.error };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
