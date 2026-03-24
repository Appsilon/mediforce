import { describe, it, expect } from 'vitest';
import { buildStepExecution } from '@mediforce/platform-core/testing';
import {
  formatDuration,
  formatStepName,
  computeWallClockDuration,
  computeActiveProcessingTime,
} from '../format';

describe('formatDuration', () => {
  it('[DATA] formats 0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('[DATA] formats sub-second durations', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('[DATA] rounds to nearest second', () => {
    expect(formatDuration(1500)).toBe('2s');
  });

  it('[DATA] formats exact seconds', () => {
    expect(formatDuration(30000)).toBe('30s');
  });

  it('[DATA] formats minutes with remaining seconds', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  it('[DATA] formats exact minutes', () => {
    expect(formatDuration(120000)).toBe('2m');
  });

  it('[DATA] formats large durations', () => {
    expect(formatDuration(3661000)).toBe('61m 1s');
  });
});

describe('formatStepName', () => {
  it('[DATA] formats hyphenated step IDs', () => {
    expect(formatStepName('validate-data')).toBe('Validate Data');
  });

  it('[DATA] formats underscored step IDs', () => {
    expect(formatStepName('run_analysis')).toBe('Run Analysis');
  });

  it('[DATA] formats mixed separators', () => {
    expect(formatStepName('run-data_check')).toBe('Run Data Check');
  });

  it('[DATA] formats single word', () => {
    expect(formatStepName('intake')).toBe('Intake');
  });
});

describe('computeWallClockDuration', () => {
  const createdAt = '2026-01-15T10:00:00Z';

  it('[DATA] computes duration from createdAt to latest completedAt', () => {
    const steps = [
      buildStepExecution({
        stepId: 'step-1',
        startedAt: '2026-01-15T10:00:00Z',
        completedAt: '2026-01-15T10:02:00Z',
      }),
      buildStepExecution({
        stepId: 'step-2',
        startedAt: '2026-01-15T10:03:00Z',
        completedAt: '2026-01-15T10:10:00Z',
      }),
    ];

    const result = computeWallClockDuration(createdAt, steps);
    // 10 minutes = 600_000ms
    expect(result).toBe(600_000);
  });

  it('[DATA] handles single completed step', () => {
    const steps = [
      buildStepExecution({
        startedAt: '2026-01-15T10:00:00Z',
        completedAt: '2026-01-15T10:05:00Z',
      }),
    ];

    const result = computeWallClockDuration(createdAt, steps);
    expect(result).toBe(300_000);
  });

  it('[DATA] returns null when no steps have completedAt', () => {
    const steps = [
      buildStepExecution({
        status: 'running',
        completedAt: null,
      }),
    ];

    const result = computeWallClockDuration(createdAt, steps);
    expect(result).toBeNull();
  });

  it('[DATA] returns null for empty array', () => {
    const result = computeWallClockDuration(createdAt, []);
    expect(result).toBeNull();
  });

  it('[DATA] ignores pending steps without completedAt', () => {
    const steps = [
      buildStepExecution({
        stepId: 'step-1',
        startedAt: '2026-01-15T10:00:00Z',
        completedAt: '2026-01-15T10:03:00Z',
      }),
      buildStepExecution({
        stepId: 'step-2',
        status: 'running',
        completedAt: null,
      }),
    ];

    const result = computeWallClockDuration(createdAt, steps);
    // Uses the only completed step: 3 minutes
    expect(result).toBe(180_000);
  });
});

describe('computeActiveProcessingTime', () => {
  it('[DATA] sums duration of all completed steps', () => {
    const steps = [
      buildStepExecution({
        stepId: 'step-1',
        startedAt: '2026-01-15T10:00:00Z',
        completedAt: '2026-01-15T10:02:00Z',
      }),
      buildStepExecution({
        stepId: 'step-2',
        startedAt: '2026-01-15T10:05:00Z',
        completedAt: '2026-01-15T10:08:00Z',
      }),
    ];

    // 2 min + 3 min = 5 min = 300_000ms
    expect(computeActiveProcessingTime(steps)).toBe(300_000);
  });

  it('[DATA] skips steps without completedAt', () => {
    const steps = [
      buildStepExecution({
        stepId: 'step-1',
        startedAt: '2026-01-15T10:00:00Z',
        completedAt: '2026-01-15T10:02:00Z',
      }),
      buildStepExecution({
        stepId: 'step-2',
        status: 'running',
        startedAt: '2026-01-15T10:05:00Z',
        completedAt: null,
      }),
    ];

    // Only step-1: 2 min = 120_000ms
    expect(computeActiveProcessingTime(steps)).toBe(120_000);
  });

  it('[DATA] returns 0 when no steps are completed', () => {
    const steps = [
      buildStepExecution({
        status: 'running',
        completedAt: null,
      }),
    ];

    expect(computeActiveProcessingTime(steps)).toBe(0);
  });

  it('[DATA] returns 0 for empty array', () => {
    expect(computeActiveProcessingTime([])).toBe(0);
  });
});
