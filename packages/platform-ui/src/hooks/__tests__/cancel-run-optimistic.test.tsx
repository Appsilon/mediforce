import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ProcessInstance } from '@mediforce/platform-core';
import { buildProcessInstance } from '@mediforce/platform-core/testing';
import { createQueryWrapper } from '@/test/react-query';
import { queryKeys } from '@/lib/query-keys';

const cancelMock = vi.fn<(...args: unknown[]) => Promise<{ run: ProcessInstance }>>();
const bulkCancelMock = vi.fn<(...args: unknown[]) => Promise<{ results: unknown[] }>>();
const archiveMock = vi.fn<(...args: unknown[]) => Promise<{ run: ProcessInstance }>>();

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    runs: {
      cancel: cancelMock,
      archive: archiveMock,
      bulkCancel: bulkCancelMock,
      bulkArchive: vi.fn(),
      start: vi.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { useCancelRun, useArchiveRun, useBulkCancelRuns } = await import('../use-run-mutations');

describe('useCancelRun — state-transition optimistic (ADR-0006 §6)', () => {
  beforeEach(() => {
    cancelMock.mockReset();
  });

  it('flips detail cache to status=failed + error="Cancelled by user" on mutate', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.run('r-1'), buildProcessInstance({ id: 'r-1', status: 'running' }));
    let resolveCancel: (v: { run: ProcessInstance }) => void = () => undefined;
    cancelMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve;
        }),
    );

    const { result } = renderHook(() => useCancelRun(), { wrapper });

    await act(async () => {
      result.current.mutate({ runId: 'r-1' });
    });

    const cached = queryClient.getQueryData<ProcessInstance>(queryKeys.run('r-1'));
    expect(cached?.status).toBe('failed');
    expect(cached?.error).toBe('Cancelled by user');

    await act(async () => {
      resolveCancel({ run: buildProcessInstance({ id: 'r-1', status: 'failed', error: 'Cancelled by user' }) });
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('replaces detail cache with server entity-echo on success', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.run('r-1'), buildProcessInstance({ id: 'r-1', status: 'running' }));
    const serverEntity = buildProcessInstance({
      id: 'r-1',
      status: 'failed',
      error: 'Cancelled by user',
      updatedAt: '2026-12-31T23:59:59.000Z',
    });
    cancelMock.mockResolvedValue({ run: serverEntity });

    const { result } = renderHook(() => useCancelRun(), { wrapper });

    await act(async () => {
      result.current.mutate({ runId: 'r-1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData<ProcessInstance>(queryKeys.run('r-1'))).toEqual(serverEntity);
  });

  it('restores the snapshot when the mutation throws', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    const original = buildProcessInstance({ id: 'r-1', status: 'running', error: null });
    queryClient.setQueryData(queryKeys.run('r-1'), original);
    cancelMock.mockRejectedValue(new Error('precondition_failed'));

    const { result } = renderHook(() => useCancelRun(), { wrapper });

    await act(async () => {
      result.current.mutate({ runId: 'r-1' });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData<ProcessInstance>(queryKeys.run('r-1'))).toEqual(original);
  });

  it('invalidates `["runs"]` prefix on settle so list slices refetch', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.run('r-1'), buildProcessInstance({ id: 'r-1', status: 'running' }));
    queryClient.setQueryData(queryKeys.runs.byHandle('alpha'), [
      buildProcessInstance({ id: 'r-1', status: 'running', namespace: 'alpha' }),
    ]);
    cancelMock.mockResolvedValue({
      run: buildProcessInstance({ id: 'r-1', status: 'failed', error: 'Cancelled by user' }),
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCancelRun(), { wrapper });
    await act(async () => {
      result.current.mutate({ runId: 'r-1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.runs.all() });
  });
});

describe('useArchiveRun — state-transition optimistic (ADR-0006 §6)', () => {
  beforeEach(() => {
    archiveMock.mockReset();
  });

  it('flips `archived` in the detail cache immediately', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    queryClient.setQueryData(queryKeys.run('r-1'), buildProcessInstance({ id: 'r-1', archived: false }));
    let resolveArchive: (v: { run: ProcessInstance }) => void = () => undefined;
    archiveMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveArchive = resolve;
        }),
    );

    const { result } = renderHook(() => useArchiveRun(), { wrapper });
    await act(async () => {
      result.current.mutate({ runId: 'r-1', archived: true });
    });

    expect(queryClient.getQueryData<ProcessInstance>(queryKeys.run('r-1'))?.archived).toBe(true);

    await act(async () => {
      resolveArchive({ run: buildProcessInstance({ id: 'r-1', archived: true }) });
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});

describe('useBulkCancelRuns — multi-cache-key invalidation (ADR-0006 §6)', () => {
  beforeEach(() => {
    bulkCancelMock.mockReset();
  });

  it('invalidates the `["runs"]` prefix on settle, no optimistic flip', async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    bulkCancelMock.mockResolvedValue({
      results: [
        { id: 'r-1', status: 'ok' },
        { id: 'r-2', status: 'ok' },
      ],
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useBulkCancelRuns(), { wrapper });
    await act(async () => {
      result.current.mutate({ runIds: ['r-1', 'r-2'] });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.runs.all() });
  });
});
