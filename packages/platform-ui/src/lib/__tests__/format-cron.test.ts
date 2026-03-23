import { describe, it, expect } from 'vitest';
import { formatCron } from '../format-cron';

describe('formatCron', () => {
  it('[DATA] formats weekday schedule', () => {
    expect(formatCron('0 8 * * 1-5')).toBe('Weekdays at 08:00');
  });

  it('[DATA] formats weekend schedule', () => {
    expect(formatCron('30 9 * * 0,6')).toBe('Weekends at 09:30');
  });

  it('[DATA] formats daily schedule', () => {
    expect(formatCron('0 6 * * *')).toBe('Daily at 06:00');
  });

  it('[DATA] formats specific days', () => {
    expect(formatCron('0 12 * * 1,3,5')).toBe('Monday, Wednesday, Friday at 12:00');
  });

  it('[DATA] formats every minute', () => {
    expect(formatCron('* * * * *')).toBe('Every minute');
  });

  it('[DATA] formats every N minutes', () => {
    expect(formatCron('*/5 * * * *')).toBe('Every 5 minutes');
  });

  it('[DATA] formats every hour', () => {
    expect(formatCron('0 */1 * * *')).toBe('Every hour at :00');
  });

  it('[DATA] formats every N hours', () => {
    expect(formatCron('0 */3 * * *')).toBe('Every 3 hours');
  });

  it('[DATA] formats monthly schedule', () => {
    expect(formatCron('0 9 1 * *')).toBe('Monthly on the 1st at 09:00');
  });

  it('[DATA] formats monthly with ordinal suffix', () => {
    expect(formatCron('0 9 15 * *')).toBe('Monthly on the 15th at 09:00');
    expect(formatCron('0 9 2 * *')).toBe('Monthly on the 2nd at 09:00');
    expect(formatCron('0 9 3 * *')).toBe('Monthly on the 3rd at 09:00');
    expect(formatCron('0 9 11 * *')).toBe('Monthly on the 11th at 09:00');
  });

  it('[DATA] returns raw expression for unsupported patterns', () => {
    expect(formatCron('invalid')).toBe('invalid');
  });

  it('[DATA] handles afternoon times', () => {
    expect(formatCron('30 14 * * 1-5')).toBe('Weekdays at 14:30');
  });
});
