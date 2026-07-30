import { describe, it, expect } from 'vitest';
import { buildAuditEvent } from '@mediforce/platform-core/testing';
import {
  isTaskActivityEvent,
  formatTaskEventName,
  taskIdFromEvent,
  taskTitleFromEvent,
  filterTaskActivity,
} from '../task-activity-event';

describe('isTaskActivityEvent', () => {
  it('[DATA] accepts the five known task actions', () => {
    for (const action of [
      'task.viewed',
      'task.claimed',
      'task.completed',
      'task.attachment_added',
      'task.attachment_deleted',
    ]) {
      expect(isTaskActivityEvent(buildAuditEvent({ action }))).toBe(true);
    }
  });

  it('[DATA] rejects task.created (system-generated) and everything else', () => {
    expect(isTaskActivityEvent(buildAuditEvent({ action: 'task.created' }))).toBe(false);
    expect(isTaskActivityEvent(buildAuditEvent({ action: 'process.resumed_after_task' }))).toBe(false);
    expect(isTaskActivityEvent(buildAuditEvent({ action: 'user.signed_in' }))).toBe(false);
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

describe('filterTaskActivity', () => {
  const events = [
    buildAuditEvent({ actorId: 'u-1', action: 'task.claimed', timestamp: '2026-01-10T10:00:00.000Z' }),
    buildAuditEvent({ actorId: 'u-2', action: 'task.completed', timestamp: '2026-01-15T10:00:00.000Z' }),
  ];

  it('[DATA] filters by actor', () => {
    const result = filterTaskActivity(events, { actorId: 'u-1', action: null, fromDate: null, toDate: null });
    expect(result).toHaveLength(1);
    expect(result[0]!.actorId).toBe('u-1');
  });

  it('[DATA] filters by action', () => {
    const result = filterTaskActivity(events, { actorId: null, action: 'task.completed', fromDate: null, toDate: null });
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe('task.completed');
  });

  it('[DATA] filters by inclusive date range', () => {
    const result = filterTaskActivity(events, {
      actorId: null,
      action: null,
      fromDate: '2026-01-12',
      toDate: '2026-01-20',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.actorId).toBe('u-2');
  });
});
