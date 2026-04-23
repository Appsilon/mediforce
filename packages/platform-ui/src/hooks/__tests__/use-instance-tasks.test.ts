import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';

const listMock = vi.fn<(...args: unknown[]) => Promise<{ tasks: HumanTask[] }>>();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { tasks: { list: listMock } },
  ApiError: class ApiError extends Error {},
}));

const { useInstanceTasks } = await import('../use-instance-tasks');

describe('useInstanceTasks', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call the API when instanceId is undefined', async () => {
    const { result } = renderHook(() => useInstanceTasks(undefined));

    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('fetches, populates and clears loading when instanceId is provided', async () => {
    listMock.mockResolvedValue({ tasks: [buildHumanTask({ id: 't1' }), buildHumanTask({ id: 't2' })] });

    const { result } = renderHook(() => useInstanceTasks('inst-a'));

    expect(result.current.loading).toBe(true);
    expect(listMock).toHaveBeenCalledWith({ instanceId: 'inst-a' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(result.current.error).toBeNull();
  });

  it('surfaces errors without leaving loading stuck', async () => {
    const err = new Error('boom');
    listMock.mockRejectedValue(err);

    const { result } = renderHook(() => useInstanceTasks('inst-a'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(result.current.tasks).toEqual([]);
  });

  it('ignores a stale response when instanceId changed before it resolved', async () => {
    // First fetch — never resolves in time
    let resolveFirst: ((value: { tasks: HumanTask[] }) => void) | null = null;
    listMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useInstanceTasks(id),
      { initialProps: { id: 'inst-a' } },
    );

    // Second fetch — resolves immediately with different data
    listMock.mockResolvedValueOnce({ tasks: [buildHumanTask({ id: 't-new', processInstanceId: 'inst-b' })] });
    rerender({ id: 'inst-b' });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t-new']);

    // Late first response arrives — must be ignored.
    await act(async () => {
      resolveFirst?.({ tasks: [buildHumanTask({ id: 'stale' })] });
    });
    expect(result.current.tasks.map((t) => t.id)).toEqual(['t-new']);
  });

  it('clears state when instanceId becomes undefined again', async () => {
    listMock.mockResolvedValue({ tasks: [buildHumanTask({ id: 't1' })] });

    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useInstanceTasks(id),
      { initialProps: { id: 'inst-a' as string | undefined } },
    );

    await waitFor(() => expect(result.current.tasks).toHaveLength(1));

    rerender({ id: undefined });

    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
