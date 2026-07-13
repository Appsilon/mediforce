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
const { useMyCompletedTasks } = await import('../use-tasks');

describe('useMyCompletedTasks', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in loading state and clears once data arrives', async () => {
    listMock.mockResolvedValue({ tasks: [] });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCompletedTasks(), { wrapper });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ status: ['completed'] });
  });

  it('drops soft-deleted tasks and sorts by completedAt desc', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 'older', completedAt: '2026-05-01T00:00:00Z' }),
        buildHumanTask({ id: 'deleted', completedAt: '2026-05-29T00:00:00Z', deleted: true }),
        buildHumanTask({ id: 'newest', completedAt: '2026-05-28T00:00:00Z' }),
      ],
    });

    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCompletedTasks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((t) => t.id)).toEqual(['newest', 'older']);
  });

  it('surfaces 4xx errors immediately and clears loading', async () => {
    const err = new ApiError(403, 'forbidden');
    listMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCompletedTasks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(result.current.data).toEqual([]);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('returns a stable shape when the API returns an empty list', async () => {
    listMock.mockResolvedValue({ tasks: [] });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMyCompletedTasks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});
