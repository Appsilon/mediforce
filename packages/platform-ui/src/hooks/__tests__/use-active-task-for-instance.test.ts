import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';

const listMock = vi.fn<(...args: unknown[]) => Promise<{ tasks: HumanTask[] }>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
vi.mock('@/lib/mediforce', () => ({
  mediforce: { tasks: { list: listMock } },
  ApiError,
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  where: vi.fn(),
  orderBy: vi.fn(),
}));

const { useActiveTaskForInstance } = await import('../use-tasks');

describe('useActiveTaskForInstance', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call the API when instanceId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveTaskForInstance(null), { wrapper });

    expect(result.current.task).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('returns the first non-deleted actionable task for the instance', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 't-stale', deleted: true }),
        buildHumanTask({ id: 't-live' }),
      ],
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveTaskForInstance('inst-a'), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(listMock).toHaveBeenCalledWith({
      instanceId: 'inst-a',
      status: ['pending', 'claimed'],
    });
    expect(result.current.task?.id).toBe('t-live');
  });

  it('returns null + clears loading when the API returns no tasks', async () => {
    listMock.mockResolvedValue({ tasks: [] });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveTaskForInstance('inst-a'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.task).toBeNull();
  });

  it('surfaces 4xx errors immediately (retry policy gates on 5xx)', async () => {
    listMock.mockRejectedValue(new ApiError(403, 'forbidden'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useActiveTaskForInstance('inst-a'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(result.current.task).toBeNull();
  });

  it('switches in-flight requests when instanceId changes without leaking stale data', async () => {
    let resolveFirst: ((value: { tasks: HumanTask[] }) => void) | null = null;
    listMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    listMock.mockResolvedValueOnce({
      tasks: [buildHumanTask({ id: 't-b', processInstanceId: 'inst-b' })],
    });

    const { wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useActiveTaskForInstance(id),
      { wrapper, initialProps: { id: 'inst-a' as string | null } },
    );

    rerender({ id: 'inst-b' });
    await waitFor(() => expect(result.current.task?.id).toBe('t-b'));

    resolveFirst?.({ tasks: [buildHumanTask({ id: 't-stale' })] });
    expect(result.current.task?.id).toBe('t-b');
  });
});
