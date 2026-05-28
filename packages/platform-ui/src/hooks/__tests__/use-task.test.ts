import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const getMock = vi.fn<(...args: unknown[]) => Promise<HumanTask>>();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { tasks: { get: getMock } },
  ApiError: class ApiError extends Error {},
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

  it('surfaces errors without leaving loading stuck', async () => {
    const err = new Error('not found');
    getMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useTask('t-1'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(result.current.task).toBeNull();
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
