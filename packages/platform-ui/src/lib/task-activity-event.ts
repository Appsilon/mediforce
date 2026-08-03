import type { AuditEvent } from '@mediforce/platform-core';
import { formatStepName } from './format';

/** Real `task.*` actions that represent something a human did to a task.
 *  `task.created` is system-generated (workflow engine advancing a step) and
 *  `process.resumed_after_task` is a process-level side effect of
 *  `task.completed`, not a distinct task action — both excluded.
 *
 *  Passed server-side as the `actions` filter (`useNamespaceAuditEventsPage`)
 *  so a fetched page only ever contains what this table claims to show. */
export const TASK_ACTIVITY_ACTIONS = [
  'task.viewed',
  'task.claimed',
  'task.completed',
  'task.attachment_added',
  'task.attachment_deleted',
] as const;

const EVENT_NAMES: Record<string, string> = {
  'task.viewed': 'Viewed',
  'task.claimed': 'Claimed',
  'task.completed': 'Completed',
  'task.attachment_added': 'Added attachment',
  'task.attachment_deleted': 'Removed attachment',
};

export function formatTaskEventName(action: string): string {
  return EVENT_NAMES[action] ?? action;
}

/** Every task action's `inputSnapshot` carries the source `taskId` — see
 *  claim-task.ts / complete-task.ts / record-task-viewed.ts / the attachment
 *  handlers. Real link target, never a placeholder. */
export function taskIdFromEvent(event: AuditEvent): string | null {
  const taskId = event.inputSnapshot.taskId;
  return typeof taskId === 'string' ? taskId : null;
}

/** `stepId` is only in `inputSnapshot` for claim/complete/viewed — the
 *  attachment handlers don't load the parent task, so they can't stamp it.
 *  Falls back to the generic "Task" label rather than "no data": unlike the
 *  Details column elsewhere in Monitoring, this text is the content of a
 *  real, resolving link (`taskIdFromEvent` always has the taskId) — "no
 *  data" would misleadingly suggest the row itself is a placeholder. */
export function taskTitleFromEvent(event: AuditEvent): string {
  const stepId = event.inputSnapshot.stepId;
  return typeof stepId === 'string' ? formatStepName(stepId) : 'Task';
}
