import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { buildProcessInstance } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn<(...args: unknown[]) => Promise<{ runs: ProcessInstance[] }>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { runs: { list: listMock } },
  ApiError,
}));

const { useProcessNameMap } = await import('../use-agent-runs');

describe('useProcessNameMap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts with an empty Map and populates it from runs.list', async () => {
    listMock.mockResolvedValue({
      runs: [
        buildProcessInstance({ id: 'inst-a', definitionName: 'workflow-a' }),
        buildProcessInstance({ id: 'inst-b', definitionName: 'workflow-b' }),
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    expect(result.current.size).toBe(0);

    await vi.waitFor(() => expect(result.current.size).toBe(2));
    expect(result.current.get('inst-a')).toBe('workflow-a');
    expect(result.current.get('inst-b')).toBe('workflow-b');
  });

  it('scopes runs.list to the handle namespace with limit 10000 (issue #588 workaround)', async () => {
    listMock.mockResolvedValue({ runs: [] });

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    expect(listMock).toHaveBeenCalledWith({ namespace: 'some-handle', limit: 10000 });
  });

  it('surfaces 4xx errors without retrying and stops polling', async () => {
    listMock.mockRejectedValue(new ApiError(403, 'forbidden'));

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    // Past the 5 s STANDARD interval — refetchInterval is disabled while errored.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('polls again after STANDARD_LIVE_INTERVAL_MS (5 s)', async () => {
    listMock.mockResolvedValue({
      runs: [buildProcessInstance({ id: 'inst-a', definitionName: 'workflow-a' })],
    });

    const { wrapper } = createQueryWrapper();
    renderHook(() => useProcessNameMap('some-handle'), { wrapper });

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5_500);
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });
});
