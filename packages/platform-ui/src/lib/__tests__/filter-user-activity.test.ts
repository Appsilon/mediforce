import { describe, it, expect } from 'vitest';
import { buildAuditEvent } from '@mediforce/platform-core/testing';
import { filterUserActivity, type UserActivityFilters } from '../user-activity-event';

const NO_FILTERS: UserActivityFilters = { actorId: null, action: null, fromDate: null, toDate: null };

describe('filterUserActivity', () => {
  it('[DATA] returns everything when no filter is set', () => {
    const events = [
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in', timestamp: '2026-01-05T10:00:00.000Z' }),
      buildAuditEvent({ actorId: 'u2', action: 'task.completed', timestamp: '2026-01-06T10:00:00.000Z' }),
    ];
    expect(filterUserActivity(events, NO_FILTERS)).toHaveLength(2);
  });

  it('[DATA] filters by actorId', () => {
    const events = [
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in' }),
      buildAuditEvent({ actorId: 'u2', action: 'user.signed_in' }),
    ];
    const result = filterUserActivity(events, { ...NO_FILTERS, actorId: 'u1' });
    expect(result).toHaveLength(1);
    expect(result[0]?.actorId).toBe('u1');
  });

  it('[DATA] filters by event action', () => {
    const events = [
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in' }),
      buildAuditEvent({ actorId: 'u1', action: 'task.completed' }),
    ];
    const result = filterUserActivity(events, { ...NO_FILTERS, action: 'task.completed' });
    expect(result).toHaveLength(1);
    expect(result[0]?.action).toBe('task.completed');
  });

  it('[DATA] filters by date range (inclusive of both boundary days)', () => {
    // Boundaries are constructed the same way the implementation parses
    // fromDate/toDate (local time, no explicit offset) so the test is
    // correct under any runner timezone, not just UTC. Excluded events sit
    // a full calendar day outside the range at local noon — far enough from
    // midnight to stay excluded across any real-world UTC offset.
    const inRangeStart = new Date('2026-01-05T12:00:00.000').toISOString();
    const inRangeEnd = new Date('2026-01-06T12:00:00.000').toISOString();
    const beforeRange = new Date('2026-01-04T12:00:00.000').toISOString();
    const afterRange = new Date('2026-01-07T12:00:00.000').toISOString();
    const events = [
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in', timestamp: beforeRange }),
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in', timestamp: inRangeStart }),
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in', timestamp: inRangeEnd }),
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in', timestamp: afterRange }),
    ];
    const result = filterUserActivity(events, { ...NO_FILTERS, fromDate: '2026-01-05', toDate: '2026-01-06' });
    expect(result.map((e) => e.timestamp)).toEqual([inRangeStart, inRangeEnd]);
  });

  it('[DATA] combines all filters (AND, not OR)', () => {
    const timestamp = new Date('2026-01-05T12:00:00.000').toISOString();
    const events = [
      buildAuditEvent({ actorId: 'u1', action: 'user.signed_in', timestamp }),
      buildAuditEvent({ actorId: 'u1', action: 'task.completed', timestamp }),
      buildAuditEvent({ actorId: 'u2', action: 'user.signed_in', timestamp }),
    ];
    const result = filterUserActivity(events, {
      actorId: 'u1',
      action: 'user.signed_in',
      fromDate: '2026-01-05',
      toDate: '2026-01-05',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.actorId).toBe('u1');
    expect(result[0]?.action).toBe('user.signed_in');
  });
});
