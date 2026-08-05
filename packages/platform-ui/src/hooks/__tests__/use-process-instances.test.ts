import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { buildProcessInstance } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';
import { queryKeys } from '@/lib/query-keys';

const getMock = vi.fn<(...args: unknown[]) => Promise<ProcessInstance>>();

vi.mock('@/lib/mediforce', () => ({
  mediforce: { processes: { get: getMock } },
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

const { useProcessInstance } = await import('../use-process-instances');

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
