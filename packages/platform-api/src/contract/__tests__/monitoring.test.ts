import { describe, it, expect } from 'vitest';
import {
  MonitoringSummaryInputSchema,
  MonitoringSummarySchema,
  GetMonitoringSummaryOutputSchema,
} from '../monitoring.js';

describe('MonitoringSummaryInputSchema', () => {
  it('requires a non-empty handle', () => {
    expect(MonitoringSummaryInputSchema.safeParse({ handle: '' }).success).toBe(false);
    expect(MonitoringSummaryInputSchema.safeParse({ handle: 'acme' }).success).toBe(true);
  });
});

describe('MonitoringSummarySchema', () => {
  it('accepts a fully zero summary', () => {
    const result = MonitoringSummarySchema.safeParse({
      runs: { running: 0, paused: 0, completed_24h: 0, failed_24h: 0, archived_total: 0 },
      tasks: { pending: 0, claimed: 0, stuck_count: 0 },
      roleTaskCounts: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative counters', () => {
    const result = MonitoringSummarySchema.safeParse({
      runs: { running: -1, paused: 0, completed_24h: 0, failed_24h: 0, archived_total: 0 },
      tasks: { pending: 0, claimed: 0, stuck_count: 0 },
      roleTaskCounts: {},
    });
    expect(result.success).toBe(false);
  });

  it('preserves role buckets in roleTaskCounts', () => {
    const result = MonitoringSummarySchema.safeParse({
      runs: { running: 1, paused: 0, completed_24h: 2, failed_24h: 0, archived_total: 0 },
      tasks: { pending: 3, claimed: 1, stuck_count: 0 },
      roleTaskCounts: { reviewer: { pending: 2, claimed: 1 }, approver: { pending: 1, claimed: 0 } },
    });
    expect(result.success).toBe(true);
  });
});

describe('GetMonitoringSummaryOutputSchema', () => {
  it('wraps a summary under `summary`', () => {
    const result = GetMonitoringSummaryOutputSchema.safeParse({
      summary: {
        runs: { running: 0, paused: 0, completed_24h: 0, failed_24h: 0, archived_total: 0 },
        tasks: { pending: 0, claimed: 0, stuck_count: 0 },
        roleTaskCounts: {},
      },
    });
    expect(result.success).toBe(true);
  });
});
