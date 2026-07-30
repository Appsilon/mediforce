import { describe, it, expect } from 'vitest';
import { buildAuditEvent } from '@mediforce/platform-core/testing';
import {
  isUserActivityEvent,
  formatEventName,
  formatEventDetails,
} from '../user-activity-event';

describe('isUserActivityEvent', () => {
  it('[DATA] accepts the four known actions', () => {
    for (const action of ['user.signed_in', 'instance.started', 'instance.cancelled', 'task.completed']) {
      expect(isUserActivityEvent(buildAuditEvent({ action }))).toBe(true);
    }
  });

  it('[DATA] rejects everything else', () => {
    expect(isUserActivityEvent(buildAuditEvent({ action: 'agent.created' }))).toBe(false);
  });
});

describe('formatEventName', () => {
  it('[DATA] maps known actions to platform-consistent labels', () => {
    expect(formatEventName('user.signed_in')).toBe('Sign in');
    expect(formatEventName('instance.started')).toBe('Workflow triggered');
    expect(formatEventName('instance.cancelled')).toBe('Workflow cancelled');
    expect(formatEventName('task.completed')).toBe('Task completed');
  });
});

describe('formatEventDetails', () => {
  it('[DATA] sign-in via password shows IP and browser', () => {
    const event = buildAuditEvent({
      action: 'user.signed_in',
      inputSnapshot: { method: 'password', ipAddress: '203.0.113.5', userAgent: 'Mozilla/5.0 (Test)' },
    });
    expect(formatEventDetails(event, new Map())).toBe('IP 203.0.113.5 · Mozilla/5.0 (Test)');
  });

  it('[DATA] sign-in via password with no captured IP/UA falls back to "no data"', () => {
    const event = buildAuditEvent({
      action: 'user.signed_in',
      inputSnapshot: { method: 'password', ipAddress: null, userAgent: null },
    });
    expect(formatEventDetails(event, new Map())).toBe('no data');
  });

  it('[DATA] sign-in via OAuth shows the provider, not "no data"', () => {
    const event = buildAuditEvent({
      action: 'user.signed_in',
      inputSnapshot: { method: 'oauth', provider: 'google' },
    });
    expect(formatEventDetails(event, new Map())).toBe('Signed in via google (SSO)');
  });

  it('[DATA] workflow triggered shows the resolved workflow name', () => {
    const event = buildAuditEvent({
      action: 'instance.started',
      processInstanceId: 'inst-1',
    });
    const processNames = new Map([['inst-1', 'Supply Chain Review']]);
    expect(formatEventDetails(event, processNames)).toBe('Supply Chain Review');
  });

  it('[DATA] workflow cancelled falls back to "no data" when the name is unresolved', () => {
    const event = buildAuditEvent({
      action: 'instance.cancelled',
      processInstanceId: 'inst-unknown',
    });
    expect(formatEventDetails(event, new Map())).toBe('no data');
  });

  it('[DATA] task completed shows the formatted step name', () => {
    // Real writers (complete-task.ts) only ever stamp `stepId` inside
    // `inputSnapshot` — the top-level `AuditEvent.stepId` field is never set
    // by any handler, so reading it here would always fall back to "no data".
    const event = buildAuditEvent({
      action: 'task.completed',
      inputSnapshot: { taskId: 'task-1', stepId: 'manager-approval' },
    });
    expect(formatEventDetails(event, new Map())).toBe('Manager Approval');
  });

  it('[DATA] task completed falls back to "no data" when the snapshot has no stepId', () => {
    const event = buildAuditEvent({ action: 'task.completed', inputSnapshot: {} });
    expect(formatEventDetails(event, new Map())).toBe('no data');
  });
});
