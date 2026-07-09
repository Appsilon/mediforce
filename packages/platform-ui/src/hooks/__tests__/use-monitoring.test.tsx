import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import { createQueryWrapper } from '@/test/react-query';

const summaryMock = vi.fn<(...args: unknown[]) => Promise<{ summary: MonitoringSummary }>>();
class ApiErrorMock extends Error {
  constructor(public status: number) {
    super(`ApiError ${String(status)}`);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { monitoring: { summary: summaryMock } },
  ApiError: ApiErrorMock,
}));

const { useMonitoringSummary } = await import('../use-monitoring');

const EMPTY_SUMMARY: MonitoringSummary = {
  runs: { running: 0, paused: 0, completed: 0, failed: 0 },
  tasks: { pending: 0, claimed: 0 },
  roleTaskCounts: {},
};

beforeEach(() => {
  summaryMock.mockReset();
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
