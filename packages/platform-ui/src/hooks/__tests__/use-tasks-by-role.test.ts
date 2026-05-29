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

// Stub use-collection so loading the module doesn't pull Firestore SDK in.
vi.mock('../use-collection', () => ({
  useCollection: () => ({ data: [], loading: false, error: null }),
}));

const { useMyActionableTasksByRole, useCompletedTasksByRole } = await import('../use-tasks');

describe('useMyActionableTasksByRole', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /api/tasks with the role + ACTIONABLE_STATUSES filter', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 't1', assignedUserId: null }),
        buildHumanTask({ id: 't2', assignedUserId: 'u-other' }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasksByRole('reviewer'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({
      role: 'reviewer',
      status: ['pending', 'claimed'],
    });
    expect(result.current.data.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('filters out tasks claimed by other users when currentUserId is set', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 't1', assignedUserId: null }),
        buildHumanTask({ id: 't2', assignedUserId: 'u-me' }),
        buildHumanTask({ id: 't3', assignedUserId: 'u-other' }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useMyActionableTasksByRole('reviewer', 'u-me'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('strips deleted tasks regardless of currentUserId', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 't1', deleted: true }),
        buildHumanTask({ id: 't2', deleted: false }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasksByRole('reviewer'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((t) => t.id)).toEqual(['t2']);
  });

  it('surfaces 4xx errors immediately (retry policy gates on 5xx)', async () => {
    const err = new ApiError(403, 'forbidden');
    listMock.mockRejectedValue(err);
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasksByRole('reviewer'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(err);
    expect(result.current.data).toEqual([]);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

describe('useCompletedTasksByRole', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('GETs with status=completed and sorts by completedAt desc', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 'older', completedAt: '2026-04-01T00:00:00.000Z' }),
        buildHumanTask({ id: 'newer', completedAt: '2026-05-01T00:00:00.000Z' }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useCompletedTasksByRole('reviewer'), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ role: 'reviewer', status: ['completed'] });
    expect(result.current.data.map((t) => t.id)).toEqual(['newer', 'older']);
  });
});
