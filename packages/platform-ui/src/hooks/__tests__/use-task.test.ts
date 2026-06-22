import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const getMock = vi.fn<(...args: unknown[]) => Promise<HumanTask>>();
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { tasks: { get: getMock } },
  ApiError,
}));

const { useTask } = await import('../use-task');

describe('useTask', () => {
  beforeEach(() => {
    getMock.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not call the API when taskId is undefined', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTask(undefined), { wrapper });

    expect(result.current.task).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('fetches and exposes the task once the request resolves', async () => {
    getMock.mockResolvedValue(buildHumanTask({ id: 't-1', status: 'pending' }));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useTask('t-1'), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMock).toHaveBeenCalledWith({ taskId: 't-1' });
    expect(result.current.task?.id).toBe('t-1');
    expect(result.current.error).toBeNull();
  });

  it('surfaces non-404 errors without leaving loading stuck', async () => {
    // 4xx (non-404) — fast-fail per the retry policy, no transient-retry wait.
    const err = new ApiError(403, 'forbidden');
    getMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(result.current.notFound).toBe(false);
    expect(result.current.task).toBeNull();
  });

  it('signals notFound=true for 404 without surfacing the error', async () => {
    getMock.mockRejectedValue(new ApiError(404, 'Task not found'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.task).toBeNull();
  });

  it('stops polling once the query has errored', async () => {
    getMock.mockRejectedValue(new ApiError(400, 'Invalid input'));
    const { wrapper } = createQueryWrapper();

    renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 4xx (fast-fail)', async () => {
    getMock.mockRejectedValue(new ApiError(400, 'Invalid input'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Default retry would call 3x (1 + 2 retries). Custom retry returns false
    // for 4xx, so call count is 1.
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('keeps polling while the task is non-terminal (CRITICAL LIVE 1.5s)', async () => {
    getMock.mockResolvedValue(buildHumanTask({ id: 't-1', status: 'pending' }));
    const { wrapper } = createQueryWrapper();

    renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(3));
  });

  it('stops polling once the task reaches a terminal status (completed)', async () => {
    getMock.mockResolvedValueOnce(buildHumanTask({ id: 't-1', status: 'pending' }));
    getMock.mockResolvedValue(buildHumanTask({ id: 't-1', status: 'completed' }));
    const { wrapper } = createQueryWrapper();

    renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the task reaches a terminal status (cancelled)', async () => {
    getMock.mockResolvedValueOnce(buildHumanTask({ id: 't-1', status: 'pending' }));
    getMock.mockResolvedValue(buildHumanTask({ id: 't-1', status: 'cancelled' }));
    const { wrapper } = createQueryWrapper();

    renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1600);
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
