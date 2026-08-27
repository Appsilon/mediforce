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

const { useMyActionableTasksByRole, useMyActionableTasks, useMyCompletedTasks } = await import('../use-tasks');

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

  it('strips deleted tasks', async () => {
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

describe('useMyActionableTasks', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('asks for the whole workspace queue by default — the run-level maps need it', async () => {
    listMock.mockResolvedValue({ tasks: [] });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ status: ['pending', 'claimed'] });
  });

  it('asks for the actionable slice when the caller scopes it', async () => {
    listMock.mockResolvedValue({ tasks: [] });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasks({ actionable: true }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({
      status: ['pending', 'claimed'],
      actionable: true,
    });
  });

  /**
   * Two different server answers; one cache entry between them would show the
   * workspace view under the "For me" label after a toggle.
   */
  it('caches the two scopes apart', async () => {
    listMock.mockResolvedValue({ tasks: [] });
    const { wrapper } = createQueryWrapper();

    const { result, rerender } = renderHook(
      ({ actionable }: { actionable: boolean }) => useMyActionableTasks({ actionable }),
      { wrapper, initialProps: { actionable: true } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ actionable: false });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it('drops soft-deleted tasks', async () => {
    listMock.mockResolvedValue({
      tasks: [
        buildHumanTask({ id: 't1', deleted: true }),
        buildHumanTask({ id: 't2', deleted: false }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((t) => t.id)).toEqual(['t2']);
  });
});

// PRD §9 rule 4: polling must stop on 4xx — one parametrised test covers the
// shared refetchInterval gate across all four STANDARD LIVE task hooks.
describe('polling stops on 4xx error (PRD §9 rule 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['useMyActionableTasksByRole', () => useMyActionableTasksByRole('reviewer')],
    ['useMyActionableTasks', () => useMyActionableTasks()],
    ['useMyCompletedTasks', () => useMyCompletedTasks()],
  ] as const)('%s stops polling after a 4xx error', async (_name, hookFactory) => {
    listMock.mockRejectedValue(new ApiError(403, 'forbidden'));
    const { wrapper } = createQueryWrapper();

    renderHook(hookFactory, { wrapper });

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));

    // Advance well past the STANDARD_LIVE_INTERVAL_MS (5 s) — poll must not fire again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * The inbox lives at `/[handle]/tasks`, so "which workspace" is part of the
 * question it asks. Without it the caller-scope axis answers across every
 * workspace the caller belongs to, and the page then links each row under the
 * handle in the URL — a task from another workspace resolves to a workflow that
 * does not exist there and 404s.
 */
describe('caller-scope queues, narrowed to one workspace', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ tasks: [] });
  });

  it('passes the namespace through on the actionable queue', async () => {
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useMyActionableTasks({ actionable: true, namespaces: ['db'] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({
      status: ['pending', 'claimed'],
      actionable: true,
      namespace: ['db'],
    });
  });

  it('passes the namespace through on the completed queue', async () => {
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyCompletedTasks({ namespaces: ['db'] }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ status: ['completed'], namespace: ['db'] });
  });

  it('omits the namespace entirely when none is given', async () => {
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasks(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ status: ['pending', 'claimed'] });
  });

  /**
   * Two workspaces are two server answers; sharing a cache entry would show
   * one workspace's queue under the other's handle after a switch.
   */
  it('caches two workspaces apart', async () => {
    const { wrapper } = createQueryWrapper();

    const { result, rerender } = renderHook(
      ({ namespaces }: { namespaces: string[] }) => useMyActionableTasks({ namespaces }),
      { wrapper, initialProps: { namespaces: ['db'] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ namespaces: ['other'] });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(listMock).toHaveBeenLastCalledWith({
      status: ['pending', 'claimed'],
      namespace: ['other'],
    });
  });
});

/**
 * The multi-workspace selection the inbox filter produces (issue #1251
 * follow-up): several workspaces are one question, not one request each.
 */
describe('caller-scope queues across several workspaces', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ tasks: [] });
  });

  it('asks once for the whole selection', async () => {
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useMyActionableTasks({ actionable: true, namespaces: ['db', 'empty'] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith({
      status: ['pending', 'claimed'],
      actionable: true,
      namespace: ['db', 'empty'],
    });
  });

  /**
   * Widening the selection is a different server answer, so it must not be
   * served from the narrower one's cache entry.
   */
  it('caches a widened selection apart from the narrow one', async () => {
    const { wrapper } = createQueryWrapper();

    const { result, rerender } = renderHook(
      ({ namespaces }: { namespaces: string[] }) => useMyActionableTasks({ namespaces }),
      { wrapper, initialProps: { namespaces: ['db'] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ namespaces: ['db', 'empty'] });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it('omits the axis entirely for "All workspaces"', async () => {
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useMyActionableTasks({ actionable: true }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith({ status: ['pending', 'claimed'], actionable: true });
  });
});
