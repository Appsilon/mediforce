'use server';

import { getPlatformServices } from '@/lib/platform-services';
import { getAdminFirestore, getAdminAuth } from '@mediforce/platform-infra';
import { resolveTask, isResolveError } from '@/lib/resolve-task';

// --------------------------------------------------------------------------
// Private helper — verify Firebase ID token and return the uid
// --------------------------------------------------------------------------
async function requireUserId(idToken: string): Promise<{ uid: string } | { error: string }> {
  if (!idToken) return { error: 'Authentication required' };
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return { uid: decoded.uid };
  } catch {
    return { error: 'Invalid authentication token' };
  }
}

// --------------------------------------------------------------------------
// claimTask — assign a pending task to the given user
// --------------------------------------------------------------------------
export async function claimTask(
  taskId: string,
  idToken: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const { humanTaskRepo, auditRepo } = getPlatformServices();

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'pending') {
      return { success: false, error: `Cannot claim a ${task.status} task` };
    }

    await humanTaskRepo.claim(taskId, uid);

    const now = new Date().toISOString();
    await auditRepo.append({
      actorId: uid,
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.claimed',
      description: `User '${uid}' claimed task '${taskId}' for step '${task.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, userId: uid, stepId: task.stepId },
      outputSnapshot: { status: 'claimed', assignedUserId: uid },
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
  idToken: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const { humanTaskRepo, auditRepo } = getPlatformServices();

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'claimed') {
      return { success: false, error: `Cannot unclaim a ${task.status} task` };
    }

    if (task.assignedUserId !== uid) {
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
      actorId: uid,
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.unclaimed',
      description: `User '${uid}' unclaimed task '${taskId}' for step '${task.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, userId: uid, stepId: task.stepId },
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
  idToken: string,
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const result = await resolveTask(taskId, { paramValues }, uid);
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
  idToken: string = '',
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const body: Record<string, unknown> = { verdict, comment };
    if (selectedIndex !== undefined) {
      body.selectedIndex = selectedIndex;
    }
    const result = await resolveTask(taskId, body, uid);
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
  idToken: string = '',
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const result = await resolveTask(taskId, { attachments: files }, uid);
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
