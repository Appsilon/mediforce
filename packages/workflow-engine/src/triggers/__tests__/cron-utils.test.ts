import { describe, it, expect } from 'vitest';
import { validateCronSchedule, isDue } from '../cron-utils.js';

describe('validateCronSchedule', () => {
  it('accepts */15 * * * *', () => {
    expect(validateCronSchedule('*/15 * * * *')).toEqual({ valid: true });
  });

  it('accepts 0 * * * *', () => {
    expect(validateCronSchedule('0 * * * *')).toEqual({ valid: true });
  });

  it('accepts 0,15,30,45 * * * *', () => {
    expect(validateCronSchedule('0,15,30,45 * * * *')).toEqual({ valid: true });
  });

  it('accepts 0 9 * * 1-5', () => {
    expect(validateCronSchedule('0 9 * * 1-5')).toEqual({ valid: true });
  });

  it('accepts 30 6 1 * *', () => {
    expect(validateCronSchedule('30 6 1 * *')).toEqual({ valid: true });
  });

  it('rejects minutes not divisible by 15', () => {
    const result = validateCronSchedule('5 * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('divisible by 15');
  });

  it('rejects * in minute field (would include non-15-aligned)', () => {
    const result = validateCronSchedule('* * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('divisible by 15');
  });

  it('rejects 0,5 * * * *', () => {
    const result = validateCronSchedule('0,5 * * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('5');
  });

  it('rejects wrong number of fields', () => {
    const result = validateCronSchedule('0 * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('5 fields');
  });

  it('rejects out-of-range hour', () => {
    const result = validateCronSchedule('0 25 * * *');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('out of range');
  });

  it('rejects out-of-range day-of-week', () => {
    const result = validateCronSchedule('0 * * * 8');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('out of range');
  });

  it('rejects non-numeric values', () => {
    const result = validateCronSchedule('abc * * * *');
    expect(result.valid).toBe(false);
  });
});

describe('isDue — single-window (no lastTriggeredAt)', () => {
  it('returns true when schedule matches current 15-min window', () => {
    // 2026-03-12 09:00 UTC is a Thursday (dow=4)
    const now = new Date('2026-03-12T09:00:00Z');
    expect(isDue('0 9 * * *', now)).toBe(true);
  });

  it('rounds down to nearest 15-min boundary', () => {
    // 09:07 should round down to 09:00
    const now = new Date('2026-03-12T09:07:00Z');
    expect(isDue('0 9 * * *', now)).toBe(true);
  });

  it('returns false when minute does not match', () => {
    const now = new Date('2026-03-12T09:16:00Z');
    // Rounds to 15, schedule says 0
    expect(isDue('0 9 * * *', now)).toBe(false);
  });

  it('returns false when hour does not match', () => {
    const now = new Date('2026-03-12T10:00:00Z');
    expect(isDue('0 9 * * *', now)).toBe(false);
  });

  it('matches */15 every 15 minutes', () => {
    expect(isDue('*/15 * * * *', new Date('2026-03-12T09:00:00Z'))).toBe(true);
    expect(isDue('*/15 * * * *', new Date('2026-03-12T09:15:00Z'))).toBe(true);
    expect(isDue('*/15 * * * *', new Date('2026-03-12T09:30:00Z'))).toBe(true);
    expect(isDue('*/15 * * * *', new Date('2026-03-12T09:45:00Z'))).toBe(true);
  });

  it('matches day-of-week correctly', () => {
    // 2026-03-12 is Thursday (dow=4)
    expect(isDue('0 9 * * 4', new Date('2026-03-12T09:00:00Z'))).toBe(true);
    expect(isDue('0 9 * * 1', new Date('2026-03-12T09:00:00Z'))).toBe(false);
  });

  it('matches day-of-month correctly', () => {
    expect(isDue('0 9 12 * *', new Date('2026-03-12T09:00:00Z'))).toBe(true);
    expect(isDue('0 9 15 * *', new Date('2026-03-12T09:00:00Z'))).toBe(false);
  });

  it('matches month correctly', () => {
    expect(isDue('0 9 12 3 *', new Date('2026-03-12T09:00:00Z'))).toBe(true);
    expect(isDue('0 9 12 4 *', new Date('2026-03-12T09:00:00Z'))).toBe(false);
  });

  it('returns false for invalid schedule', () => {
    expect(isDue('bad', new Date())).toBe(false);
  });

  it('matches weekday range 1-5', () => {
    // Thursday = 4, should match 1-5
    expect(isDue('0 9 * * 1-5', new Date('2026-03-12T09:00:00Z'))).toBe(true);
    // Sunday = 0, should not match 1-5
    expect(isDue('0 9 * * 1-5', new Date('2026-03-15T09:00:00Z'))).toBe(false);
  });
});

describe('isDue — with lastTriggeredAt (gap-scanning)', () => {
  it('catches missed window: heartbeat at 09:17, last at 08:45, schedule 0 9', () => {
    const now = new Date('2026-03-12T09:17:00Z');
    const last = new Date('2026-03-12T08:45:00Z');
    // 09:00 occurred between 08:45 and 09:17
    expect(isDue('0 9 * * *', now, last)).toBe(true);
  });

  it('skips already-triggered window: last at 09:05, now at 09:17', () => {
    const now = new Date('2026-03-12T09:17:00Z');
    const last = new Date('2026-03-12T09:05:00Z');
    // 09:00 was before lastTriggeredAt, no new occurrence between 09:05 and 09:17
    expect(isDue('0 9 * * *', now, last)).toBe(false);
  });

  it('catches missed window across multi-hour gap', () => {
    const now = new Date('2026-03-12T09:17:00Z');
    const last = new Date('2026-03-12T05:29:00Z');
    // 06:00 occurred between 05:29 and 09:17 — daily-reads scenario
    expect(isDue('0 6 * * *', now, last)).toBe(true);
  });

  it('handles cross-midnight trigger', () => {
    const now = new Date('2026-03-13T00:20:00Z');
    const last = new Date('2026-03-12T23:45:00Z');
    // 00:00 occurred between 23:45 and 00:20
    expect(isDue('0 0 * * *', now, last)).toBe(true);
  });

  it('does not fire twice when called right after trigger', () => {
    const now = new Date('2026-03-12T09:14:00Z');
    const last = new Date('2026-03-12T09:02:00Z');
    // lastTriggeredAt is after 09:00, no new occurrence in (09:02, 09:14]
    expect(isDue('0 9 * * *', now, last)).toBe(false);
  });

  it('handles */15 schedule with gap', () => {
    const now = new Date('2026-03-12T10:00:00Z');
    const last = new Date('2026-03-12T09:00:00Z');
    // With */15: 09:15, 09:30, 09:45, 10:00 all fell in the gap
    expect(isDue('*/15 * * * *', now, last)).toBe(true);
  });

  it('caps scan at 24 hours for very old lastTriggeredAt', () => {
    const now = new Date('2026-03-15T09:00:00Z');
    const last = new Date('2026-03-12T09:00:00Z'); // 3 days ago
    // Should still find today's 09:00 (within the 24h cap)
    expect(isDue('0 9 * * *', now, last)).toBe(true);
  });

  it('respects day-of-week in gap scanning', () => {
    // 2026-03-15 is Sunday (dow=0), schedule is weekdays only
    const now = new Date('2026-03-15T09:17:00Z');
    const last = new Date('2026-03-15T08:45:00Z');
    // 09:00 Sunday should NOT match weekday-only schedule
    expect(isDue('0 9 * * 1-5', now, last)).toBe(false);
  });

  it('respects day-of-month in gap scanning', () => {
    // Schedule: 1st of month only
    const now = new Date('2026-03-12T09:17:00Z');
    const last = new Date('2026-03-12T08:45:00Z');
    expect(isDue('0 9 1 * *', now, last)).toBe(false);
  });

  it('fires when lastTriggeredAt equals a boundary exactly', () => {
    // lastTriggeredAt is exactly 08:00, next boundary is 08:15
    const now = new Date('2026-03-12T09:17:00Z');
    const last = new Date('2026-03-12T08:00:00Z');
    // 09:00 is in the gap
    expect(isDue('0 9 * * *', now, last)).toBe(true);
  });

  it('returns false for invalid schedule with lastTriggeredAt', () => {
    expect(isDue('bad', new Date(), new Date())).toBe(false);
  });
});
