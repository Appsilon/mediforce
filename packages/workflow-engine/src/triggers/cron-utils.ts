/**
 * Cron schedule utilities for 5-field cron expressions.
 * Fields: minute hour day-of-month month day-of-week
 *
 * Constraint: minute values must be divisible by 15 (0, 15, 30, 45)
 * to align with the 15-minute heartbeat interval.
 */

const ALLOWED_MINUTES = new Set([0, 15, 30, 45]);
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MAX_SCAN_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CronValidationResult {
  valid: boolean;
  error?: string;
}

interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

function parseField(field: string, min: number, max: number): number[] | string {
  if (field === '*') {
    const values: number[] = [];
    for (let i = min; i <= max; i++) {
      values.push(i);
    }
    return values;
  }

  // Handle step values: */n or m-n/s
  if (field.includes('/')) {
    const [range, stepStr] = field.split('/');
    const step = parseInt(stepStr, 10);
    if (Number.isNaN(step) || step < 1) {
      return `Invalid step value: ${stepStr}`;
    }

    let start = min;
    let end = max;

    if (range !== '*') {
      if (range.includes('-')) {
        const [lo, hi] = range.split('-').map(Number);
        if (Number.isNaN(lo) || Number.isNaN(hi)) {
          return `Invalid range: ${range}`;
        }
        start = lo;
        end = hi;
      } else {
        start = parseInt(range, 10);
        if (Number.isNaN(start)) {
          return `Invalid value: ${range}`;
        }
      }
    }

    if (start < min || end > max) {
      return `Value out of range [${min}-${max}]: ${field}`;
    }

    const values: number[] = [];
    for (let i = start; i <= end; i += step) {
      values.push(i);
    }
    return values;
  }

  // Handle comma-separated values and ranges
  const parts = field.split(',');
  const values: number[] = [];

  for (const part of parts) {
    if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (Number.isNaN(lo) || Number.isNaN(hi)) {
        return `Invalid range: ${part}`;
      }
      if (lo < min || hi > max) {
        return `Value out of range [${min}-${max}]: ${part}`;
      }
      for (let i = lo; i <= hi; i++) {
        values.push(i);
      }
    } else {
      const num = parseInt(part, 10);
      if (Number.isNaN(num)) {
        return `Invalid value: ${part}`;
      }
      if (num < min || num > max) {
        return `Value out of range [${min}-${max}]: ${part}`;
      }
      values.push(num);
    }
  }

  return values;
}

function parseCron(schedule: string): ParsedCron | string {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    return `Expected 5 fields, got ${fields.length}`;
  }

  const minutes = parseField(fields[0], 0, 59);
  if (typeof minutes === 'string') return `minute: ${minutes}`;

  const hours = parseField(fields[1], 0, 23);
  if (typeof hours === 'string') return `hour: ${hours}`;

  const daysOfMonth = parseField(fields[2], 1, 31);
  if (typeof daysOfMonth === 'string') return `day-of-month: ${daysOfMonth}`;

  const months = parseField(fields[3], 1, 12);
  if (typeof months === 'string') return `month: ${months}`;

  const daysOfWeek = parseField(fields[4], 0, 6);
  if (typeof daysOfWeek === 'string') return `day-of-week: ${daysOfWeek}`;

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

export function validateCronSchedule(schedule: string): CronValidationResult {
  const result = parseCron(schedule);
  if (typeof result === 'string') {
    return { valid: false, error: result };
  }

  // Enforce 15-minute alignment on minute values
  const invalidMinutes = result.minutes.filter((m) => !ALLOWED_MINUTES.has(m));
  if (invalidMinutes.length > 0) {
    return {
      valid: false,
      error: `Minute values must be divisible by 15 (0, 15, 30, 45). Invalid: ${invalidMinutes.join(', ')}`,
    };
  }

  return { valid: true };
}

/** Check whether a specific instant matches a parsed cron schedule (UTC). */
function matchesInstant(parsed: ParsedCron, instant: Date): boolean {
  const minute = Math.floor(instant.getUTCMinutes() / 15) * 15;
  const hour = instant.getUTCHours();
  const dayOfMonth = instant.getUTCDate();
  const month = instant.getUTCMonth() + 1; // JS months are 0-indexed
  const dayOfWeek = instant.getUTCDay(); // 0 = Sunday

  return (
    parsed.minutes.includes(minute) &&
    parsed.hours.includes(hour) &&
    parsed.daysOfMonth.includes(dayOfMonth) &&
    parsed.months.includes(month) &&
    parsed.daysOfWeek.includes(dayOfWeek)
  );
}

/** Round timestamp down to the nearest 15-minute boundary (UTC). */
function floorTo15Min(ms: number): number {
  return Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
}

/** Round timestamp up to the next 15-minute boundary (UTC). */
function ceilTo15Min(ms: number): number {
  return Math.ceil(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
}

/**
 * Check whether a cron schedule is due.
 *
 * Without `lastTriggeredAt`: checks if `now` falls in a matching 15-minute window (original behavior).
 * With `lastTriggeredAt`: scans all 15-minute boundaries in (lastTriggeredAt, now] to find any match.
 * This makes cron resilient to irregular heartbeat intervals — missed windows are caught on the next beat.
 * Scan is capped at 24 hours to prevent runaway iteration.
 */
export function isDue(schedule: string, now: Date, lastTriggeredAt?: Date): boolean {
  const parsed = parseCron(schedule);
  if (typeof parsed === 'string') {
    return false;
  }

  if (!lastTriggeredAt) {
    return matchesInstant(parsed, now);
  }

  // Scan 15-minute boundaries in (lastTriggeredAt, now]
  const scanStart = Math.max(lastTriggeredAt.getTime(), now.getTime() - MAX_SCAN_MS);
  const cursor0 = ceilTo15Min(scanStart + 1); // first boundary strictly after scanStart
  const end = floorTo15Min(now.getTime());

  for (let cursor = cursor0; cursor <= end; cursor += FIFTEEN_MIN_MS) {
    if (matchesInstant(parsed, new Date(cursor))) {
      return true;
    }
  }

  return false;
}
