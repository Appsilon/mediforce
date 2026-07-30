import type { AuditEvent } from '@mediforce/platform-core';
import { formatStepName } from './format';

/** Real `task.*` actions that represent something a human did to a task.
 *  `task.created` is system-generated (workflow engine advancing a step) and
 *  `process.resumed_after_task` is a process-level side effect of
 *  `task.completed`, not a distinct task action — both excluded. */
const TASK_ACTIVITY_ACTIONS = new Set([
  'task.viewed',
  'task.claimed',
  'task.completed',
  'task.attachment_added',
  'task.attachment_deleted',
]);

export function isTaskActivityEvent(event: AuditEvent): boolean {
  return TASK_ACTIVITY_ACTIONS.has(event.action);
}

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

export interface TaskActivityFilters {
  actorId: string | null;
  action: string | null;
  /** `YYYY-MM-DD`, as produced by `<input type="date">` — inclusive of the
   *  whole local day. */
  fromDate: string | null;
  toDate: string | null;
}

export function filterTaskActivity(
  events: AuditEvent[],
  filters: TaskActivityFilters,
): AuditEvent[] {
  const from = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00.000`) : null;
  const to = filters.toDate ? new Date(`${filters.toDate}T23:59:59.999`) : null;

  return events.filter((event) => {
    if (filters.actorId !== null && event.actorId !== filters.actorId) return false;
    if (filters.action !== null && event.action !== filters.action) return false;
    const eventTime = new Date(event.timestamp);
    if (from !== null && eventTime < from) return false;
    if (to !== null && eventTime > to) return false;
    return true;
  });
}
