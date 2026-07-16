import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';
import { buildHumanTask, buildProcessInstance } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const summaryMock = vi.fn<(...args: unknown[]) => Promise<{ summary: MonitoringSummary }>>();
const runsListMock = vi.fn<(...args: unknown[]) => Promise<{ runs: ProcessInstance[] }>>();
const tasksListMock = vi.fn<(...args: unknown[]) => Promise<{ tasks: HumanTask[] }>>();
class ApiErrorMock extends Error {
  constructor(public status: number) {
    super(`ApiError ${String(status)}`);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    monitoring: { summary: summaryMock },
    runs: { list: runsListMock },
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
  runsListMock.mockReset();
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
  it('composes counts from the summary and rows from runs/tasks, scoped to the handle', async () => {
    summaryMock.mockResolvedValue({
      summary: {
        runs: { running: 2, paused: 1, completed: 3, failed: 1 },
        tasks: { pending: 1, claimed: 1 },
        roleTaskCounts: { reviewer: { pending: 1, claimed: 1 } },
      },
    });
    runsListMock.mockResolvedValue({
      runs: [
        buildProcessInstance({ id: 'r-1', status: 'paused', createdAt: '2024-01-02T00:00:00.000Z' }),
        buildProcessInstance({ id: 'r-2', status: 'created', createdAt: '2024-01-01T00:00:00.000Z' }),
      ],
    });
    tasksListMock.mockResolvedValue({
      tasks: [buildHumanTask({ id: 't-1', assignedRole: 'reviewer' })],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMonitoringData('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(runsListMock).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'team-alpha' }));
    expect(tasksListMock).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'team-alpha', status: ['pending', 'claimed'] }),
    );
    expect(result.current.statusCounts).toEqual({
      running: 2,
      paused: 1,
      failed: 1,
      completed: 3,
      created: 1,
    });
    expect(result.current.stuckProcesses.map((p) => p.id)).toEqual(['r-1']);
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t-1']);
    expect(result.current.roleCounts).toEqual([
      { role: 'reviewer', pending: 1, claimed: 1, total: 2 },
    ]);
  });

  it('does not fetch when handle is undefined', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMonitoringData(undefined), { wrapper });

    expect(summaryMock).not.toHaveBeenCalled();
    expect(runsListMock).not.toHaveBeenCalled();
    expect(tasksListMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });
});
