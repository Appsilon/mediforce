import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RunNameEntry } from '@mediforce/platform-core';
import { createQueryWrapper } from '@/test/react-query';

const listNamesMock = vi.fn<(...args: unknown[]) => Promise<{ runs: RunNameEntry[] }>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { runs: { listNames: listNamesMock } },
  ApiError,
}));

const { useProcessNameMap } = await import('../use-agent-runs');

describe('useProcessNameMap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listNamesMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts with an empty Map and populates it from runs.listNames', async () => {
    listNamesMock.mockResolvedValue({
      runs: [
        { id: 'inst-a', definitionName: 'workflow-a' },
        { id: 'inst-b', definitionName: 'workflow-b' },
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    expect(result.current.size).toBe(0);

    await vi.waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get('inst-a')).toBe('workflow-a');
    expect(result.current.get('inst-b')).toBe('workflow-b');
  });

  it('scopes runs.listNames to the handle namespace (projected endpoint, issue #588)', async () => {
    listNamesMock.mockResolvedValue({ runs: [] });

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    await vi.waitFor(() => expect(listNamesMock).toHaveBeenCalledTimes(1));
    expect(listNamesMock).toHaveBeenCalledWith({ namespace: 'some-handle' });
  });

  it('surfaces 4xx errors without retrying and stops polling', async () => {
    listNamesMock.mockRejectedValue(new ApiError(403, 'forbidden'));

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    await vi.waitFor(() => expect(listNamesMock).toHaveBeenCalledTimes(1));

    // Past the 30 s NICE interval — refetchInterval is disabled while errored.
    await vi.advanceTimersByTimeAsync(35_000);
    expect(listNamesMock).toHaveBeenCalledTimes(1);
  });

  it('polls again after NICE_LIVE_INTERVAL_MS (30 s)', async () => {
    listNamesMock.mockResolvedValue({
      runs: [{ id: 'inst-a', definitionName: 'workflow-a' }],
    });

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    await vi.waitFor(() => expect(listNamesMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(31_000);
    await vi.waitFor(() => expect(listNamesMock).toHaveBeenCalledTimes(2));
  });
});
