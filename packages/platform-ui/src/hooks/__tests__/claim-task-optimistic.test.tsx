import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useMutation } from '@tanstack/react-query';
import type { HumanTask } from '@mediforce/platform-core';
import { buildHumanTask } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';
import { queryKeys } from '@/lib/query-keys';
import { snapshotCache } from '@/lib/optimistic';

const claimMock = vi.fn<(...args: unknown[]) => Promise<{ task: HumanTask }>>();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { tasks: { claim: claimMock } },
  ApiError: class ApiError extends Error {},
}));

const { mediforce } = await import('@/lib/mediforce');

/**
 * Mirrors the state-transition wiring in `components/tasks/claim-button.tsx`
 * so the test exercises the canonical optimistic template, not a parallel
 * implementation. Future mutations on other domains are expected to follow
 * the same shape; this test is the contract for "optimistic update behaves
 * correctly".
 */
function useClaimMutation(qc: import('@tanstack/react-query').QueryClient, taskId: string) {
  return useMutation({
    mutationFn: () => mediforce.tasks.claim({ taskId }),
    onMutate: async () => {
      const detailKey = queryKeys.task(taskId);
      await qc.cancelQueries({ queryKey: detailKey });
      const { restore } = snapshotCache(qc, [detailKey]);
      qc.setQueryData<HumanTask | undefined>(detailKey, (old) => (old ? { ...old, status: 'claimed' } : old));
      return { restore };
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.task(data.task.id), data.task);
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
  });
}

describe('claim mutation — state-transition optimistic template (ADR-0006 §6)', () => {
  beforeEach(() => {
    claimMock.mockReset();
  });

  it('patches the detail cache to status=claimed on mutate', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.task('t-1'), buildHumanTask({ id: 't-1', status: 'pending' }));
    let resolveClaim: (value: { task: HumanTask }) => void = () => undefined;
    claimMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClaim = resolve;
        }),
    );

    const { result } = renderHook(() => useClaimMutation(queryClient, 't-1'), { wrapper });

    await act(async () => {
      result.current.mutate();
    });

    const cached = queryClient.getQueryData<HumanTask>(queryKeys.task('t-1'));
    expect(cached?.status).toBe('claimed');

    // Let the in-flight mutation resolve so the test doesn't leak a promise.
    await act(async () => {
      resolveClaim({ task: buildHumanTask({ id: 't-1', status: 'claimed' }) });
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('replaces the detail cache with the server entity-echo on success', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.task('t-1'), buildHumanTask({ id: 't-1', status: 'pending' }));
    const serverEntity = buildHumanTask({ id: 't-1', status: 'claimed', assignedUserId: 'u-server' });
    claimMock.mockResolvedValue({ task: serverEntity });

    const { result } = renderHook(() => useClaimMutation(queryClient, 't-1'), { wrapper });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData<HumanTask>(queryKeys.task('t-1'))).toEqual(serverEntity);
  });

  it('restores the snapshot when the mutation throws', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const original = buildHumanTask({ id: 't-1', status: 'pending', assignedUserId: null });
    queryClient.setQueryData(queryKeys.task('t-1'), original);
    claimMock.mockRejectedValue(new Error('precondition_failed'));

    const { result } = renderHook(() => useClaimMutation(queryClient, 't-1'), { wrapper });

    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData<HumanTask>(queryKeys.task('t-1'))).toEqual(original);
  });
});
