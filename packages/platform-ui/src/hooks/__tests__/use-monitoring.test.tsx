import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { MonitoringSummary } from '@mediforce/platform-api/contract';
import { createQueryWrapper } from '@/test/react-query';

const summaryMock = vi.fn<(...args: unknown[]) => Promise<{ summary: MonitoringSummary }>>();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { monitoring: { summary: summaryMock } },
  ApiError: class ApiError extends Error {},
}));

const { useMonitoringSummary } = await import('../use-monitoring');

const EMPTY_SUMMARY: MonitoringSummary = {
  runs: { running: 0, paused: 0, completed_24h: 0, failed_24h: 0, archived_total: 0 },
  tasks: { pending: 0, claimed: 0, stuck_count: 0 },
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

  it('surfaces errors without staying stuck loading', async () => {
    summaryMock.mockRejectedValue(new Error('boom'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMonitoringSummary('team-alpha'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
