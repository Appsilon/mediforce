const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Convert a cron expression to a human-readable description.
 * Handles common patterns; falls back to the raw expression for exotic ones.
 */
export function formatCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute / every N minutes
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (minute === '*') return 'Every minute';
    if (minute.startsWith('*/')) {
      const interval = Number(minute.slice(2));
      return interval === 1 ? 'Every minute' : `Every ${interval} minutes`;
    }
  }

  // Every N hours
  if (minute !== '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute.padStart(2, '0')}`;
  }
  if (minute !== '*' && hour?.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = Number(hour.slice(2));
    return interval === 1 ? `Every hour at :${minute.padStart(2, '0')}` : `Every ${interval} hours`;
  }

  const time = formatTime(hour, minute);
  if (!time) return expression;

  // Specific days of week
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = parseDaysOfWeek(dayOfWeek);
    if (!days) return `${time}, ${expression}`;

    if (days === 'weekdays') return `Weekdays at ${time}`;
    if (days === 'weekends') return `Weekends at ${time}`;
    return `${days} at ${time}`;
  }

  // Daily
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${time}`;
  }

  // Specific day of month
  if (dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
    const day = Number(dayOfMonth);
    if (Number.isNaN(day)) return expression;
    const suffix = ordinalSuffix(day);
    return `Monthly on the ${day}${suffix} at ${time}`;
  }

  return expression;
}

function formatTime(hour: string, minute: string): string | null {
  const h = Number(hour);
  const m = Number(minute);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function parseDaysOfWeek(field: string): string | null {
  // Handle ranges like 1-5, lists like 1,3,5, and combinations
  const indices: Set<number> = new Set();

  for (const part of field.split(',')) {
    const range = part.match(/^(\d)-(\d)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let i = start; i <= end; i++) indices.add(i);
    } else {
      const num = Number(part);
      if (Number.isNaN(num) || num < 0 || num > 7) return null;
      indices.add(num === 7 ? 0 : num); // normalize Sunday
    }
  }

  const sorted = [...indices].sort((a, b) => a - b);

  // Check for common patterns
  if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'weekdays';
  if (sorted.length === 2 && sorted.join(',') === '0,6') return 'weekends';

  return sorted.map((d) => DAYS_OF_WEEK[d]).filter(Boolean).join(', ');
}

function ordinalSuffix(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  if (mod10 === 1) return 'st';
  if (mod10 === 2) return 'nd';
  if (mod10 === 3) return 'rd';
  return 'th';
}
