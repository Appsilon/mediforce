import { describe, it, expect } from 'vitest';
import { buildAuditEvent } from '@mediforce/platform-core/testing';
import {
  TASK_ACTIVITY_ACTIONS,
  formatTaskEventName,
  taskIdFromEvent,
  taskTitleFromEvent,
} from '../task-activity-event';

describe('TASK_ACTIVITY_ACTIONS', () => {
  it('[DATA] is the five known task actions, passed server-side as the actions filter', () => {
    expect([...TASK_ACTIVITY_ACTIONS]).toEqual([
      'task.viewed',
      'task.claimed',
      'task.completed',
      'task.attachment_added',
      'task.attachment_deleted',
    ]);
  });
});

describe('formatTaskEventName', () => {
  it('[DATA] maps known actions to platform-consistent labels', () => {
    expect(formatTaskEventName('task.viewed')).toBe('Viewed');
    expect(formatTaskEventName('task.claimed')).toBe('Claimed');
    expect(formatTaskEventName('task.completed')).toBe('Completed');
    expect(formatTaskEventName('task.attachment_added')).toBe('Added attachment');
    expect(formatTaskEventName('task.attachment_deleted')).toBe('Removed attachment');
  });
});

describe('taskIdFromEvent', () => {
  it('[DATA] reads taskId from inputSnapshot for every task action', () => {
    const event = buildAuditEvent({
      action: 'task.claimed',
      inputSnapshot: { taskId: 'task-1', userId: 'u-1', stepId: 'review' },
    });
    expect(taskIdFromEvent(event)).toBe('task-1');
  });

  it('[DATA] returns null when the snapshot has no taskId', () => {
    expect(taskIdFromEvent(buildAuditEvent({ action: 'task.claimed', inputSnapshot: {} }))).toBeNull();
  });
});

describe('taskTitleFromEvent', () => {
  it('[DATA] shows the formatted step name when the snapshot carries stepId', () => {
    const event = buildAuditEvent({
      action: 'task.completed',
      inputSnapshot: { taskId: 'task-1', stepId: 'manager-approval' },
    });
    expect(taskTitleFromEvent(event)).toBe('Manager Approval');
  });

  it('[DATA] falls back to the generic "Task" label for attachment events (no stepId captured)', () => {
    const event = buildAuditEvent({
      action: 'task.attachment_added',
      inputSnapshot: { taskId: 'task-1', name: 'report.pdf', sizeBytes: 1024 },
    });
    expect(taskTitleFromEvent(event)).toBe('Task');
  });
});
