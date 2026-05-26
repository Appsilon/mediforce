'use server';

import { getPlatformServices } from '@/lib/platform-services';
import { getAdminAuth } from '@mediforce/platform-infra';
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
  verdict: string,
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

// --------------------------------------------------------------------------
// completeAssignmentTask — submit per-item assignments for an assignment-table
// human task. The dispatch step downstream consumes `stepOutput.assignments`.
// --------------------------------------------------------------------------
interface AssignmentPayload {
  assignments: Array<{
    itemId: string;
    assigneeId: string;
    assigneeKind: 'human' | 'agent';
    priority: string;
    note?: string;
    raw?: Record<string, unknown>;
  }>;
}

export async function completeAssignmentTask(
  taskId: string,
  payload: AssignmentPayload,
  idToken: string = '',
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const result = await resolveTask(taskId, { assignments: payload.assignments }, uid);
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
// completeTableEditorTask — submit per-row cell values for a table-editor human
// task. Downstream steps consume `stepOutput.rows`, each `{ itemId, values }`.
// --------------------------------------------------------------------------
interface TableEditorPayload {
  rows: Array<{ itemId: string; values: Record<string, unknown> }>;
}

export async function completeTableEditorTask(
  taskId: string,
  payload: TableEditorPayload,
  idToken: string = '',
): Promise<{ success: boolean; error?: string }> {
  const auth = await requireUserId(idToken);
  if ('error' in auth) return { success: false, error: auth.error };
  const { uid } = auth;

  try {
    const result = await resolveTask(taskId, { rows: payload.rows }, uid);
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
