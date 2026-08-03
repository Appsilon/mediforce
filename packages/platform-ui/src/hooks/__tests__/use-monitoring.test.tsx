import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const summaryMock = vi.fn<(...args: unknown[]) => Promise<{ summary: MonitoringSummary }>>();
const tasksListMock = vi.fn<(...args: unknown[]) => Promise<{ tasks: HumanTask[] }>>();
class ApiErrorMock extends Error {
  constructor(public status: number) {
    super(`ApiError ${String(status)}`);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    monitoring: { summary: summaryMock },
    tasks: { list: tasksListMock },
  },
  ApiError: ApiErrorMock,
}));

const { useMonitoringSummary, useMonitoringData } = await import('../use-monitoring');

const EMPTY_SUMMARY: MonitoringSummary = {
  runs: { running: 0, paused: 0, completed: 0, failed: 0 },
  tasks: { pending: 0, claimed: 0 },
  roleTaskCounts: {},
};

beforeEach(() => {
  summaryMock.mockReset();
  tasksListMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useMonitoringSummary', () => {
  it('is disabled when handle is missing', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useMonitoringSummary(undefined), { wrapper });
    expect(summaryMock).not.toHaveBeenCalled();
  });

  it('GETs the summary endpoint with the handle param', async () => {
    summaryMock.mockResolvedValue({
      summary: { ...EMPTY_SUMMARY, runs: { ...EMPTY_SUMMARY.runs, running: 3 } },
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMonitoringSummary('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(summaryMock).toHaveBeenCalledWith({ handle: 'team-alpha' });
    expect(result.current.data?.runs.running).toBe(3);
  });

  it('surfaces a 403 ApiError without retrying or staying stuck loading', async () => {
    const err = new ApiErrorMock(403);
    summaryMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMonitoringSummary('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(summaryMock).toHaveBeenCalledTimes(1);
  });
});

describe('useMonitoringData', () => {
  it('composes tasks, scoped to the handle, and keeps the summary request alive', async () => {
    summaryMock.mockResolvedValue({
      summary: {
        runs: { running: 2, paused: 1, completed: 3, failed: 1 },
        tasks: { pending: 1, claimed: 1 },
        roleTaskCounts: { reviewer: { pending: 1, claimed: 1 } },
      },
    });
    tasksListMock.mockResolvedValue({
      tasks: [buildHumanTask({ id: 't-1', assignedRole: 'reviewer' })],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMonitoringData('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.tasks.map((t) => t.id)).toEqual(['t-1']));

    // Still calls the summary endpoint — the request itself stays wired per
    // ADR-0006 §4 NICE LIVE even though nothing in MonitoringData reads its
    // value directly anymore (Workflows tab reads mediforce.runs.statusCounts
    // instead — a real SQL aggregation, not a client-side tally).
    expect(summaryMock).toHaveBeenCalledWith({ handle: 'team-alpha' });
    expect(tasksListMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'team-alpha', status: ['pending', 'claimed'] }),
    );
  });

  it('does not fetch when handle is undefined', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMonitoringData(undefined), { wrapper });

    expect(summaryMock).not.toHaveBeenCalled();
    expect(tasksListMock).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
  });
});
