import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { buildProcessInstance } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';
import { queryKeys } from '@/lib/query-keys';

const listMock = vi.fn<(...args: unknown[]) => Promise<{ runs: ProcessInstance[] }>>();
const getMock = vi.fn<(...args: unknown[]) => Promise<ProcessInstance>>();

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    runs: { list: listMock },
    processes: { get: getMock },
  },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

const { useProcessInstances, useProcessInstance } = await import('../use-process-instances');

describe('useProcessInstances — react-query backed', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it('passes the namespace filter through to `mediforce.runs.list`', async () => {
    listMock.mockResolvedValue({
      runs: [
        buildProcessInstance({ id: 'a-1', namespace: 'appsilon' }),
        buildProcessInstance({ id: 'a-2', namespace: 'appsilon' }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useProcessInstances('all', undefined, false, 'appsilon'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'appsilon' }));
    expect(result.current.data.map((r) => r.id)).toEqual(['a-1', 'a-2']);
  });

  it('hides archived runs by default, keeps them when showArchived=true', async () => {
    listMock.mockResolvedValue({
      runs: [
        buildProcessInstance({ id: 'live', namespace: 'alpha', archived: false }),
        buildProcessInstance({ id: 'arch', namespace: 'alpha', archived: true }),
      ],
    });
    const { wrapper } = createQueryWrapper();

    const hidden = renderHook(
      () => useProcessInstances('all', undefined, false, 'alpha'),
      { wrapper },
    );
    await waitFor(() => expect(hidden.result.current.loading).toBe(false));
    expect(hidden.result.current.data.map((r) => r.id)).toEqual(['live']);

    const shown = renderHook(
      () => useProcessInstances('all', undefined, true, 'alpha'),
      { wrapper },
    );
    await waitFor(() => expect(shown.result.current.loading).toBe(false));
    expect(shown.result.current.data.map((r) => r.id).sort()).toEqual(['arch', 'live']);
  });

  it('is disabled when namespace is the empty string (avoids cross-workspace cache pollution)', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useProcessInstances('all', undefined, false, ''),
      { wrapper },
    );
    expect(listMock).not.toHaveBeenCalled();
    // Reports loading=true so callers keep the skeleton on while the route
    // param is still resolving — prevents the "no runs" flash before the
    // first fetch even starts.
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('forwards the status filter to the API (apiStatus !== "all")', async () => {
    listMock.mockResolvedValue({ runs: [] });
    const { wrapper } = createQueryWrapper();

    renderHook(
      () => useProcessInstances('running', undefined, false, 'alpha'),
      { wrapper },
    );

    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
  });

  it('stops polling after a 4xx error (PRD §9 rule 4)', async () => {
    const { ApiError } = await import('@/lib/mediforce');
    listMock.mockRejectedValue(new (ApiError as new (status: number, msg: string) => Error)(403, 'forbidden'));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { wrapper } = createQueryWrapper();

    renderHook(() => useProcessInstances('all', undefined, false, 'alpha'), { wrapper });

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});

describe('useProcessInstance — single-run CRITICAL LIVE polling', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('populates the cache under queryKeys.run(id)', async () => {
    const instance = buildProcessInstance({ id: 'r-1', status: 'running' });
    getMock.mockResolvedValue(instance);
    const { wrapper, queryClient } = createQueryWrapper();

    const { result } = renderHook(() => useProcessInstance('r-1'), { wrapper });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(queryClient.getQueryData<ProcessInstance>(queryKeys.run('r-1'))).toEqual(instance);
  });

  it('returns notFound=true on 404 and clears the error field', async () => {
    const { ApiError } = await import('@/lib/mediforce');
    getMock.mockRejectedValue(new (ApiError as new (status: number, msg: string) => Error)(404, 'not found'));
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useProcessInstance('r-missing'), { wrapper });
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('does not fire when instanceId is null', () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useProcessInstance(null), { wrapper });
    expect(getMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
