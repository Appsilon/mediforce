import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from '@tanstack/react-query';
import { snapshotCache } from '@/lib/optimistic';
import { queryKeys } from '@/lib/query-keys';
import type {
  CreateNamespaceInput,
  CreateNamespaceOutput,
  GetMeOutput,
  MeNamespace,
} from '@mediforce/platform-api/contract';

const createMock = vi.fn<(input: CreateNamespaceInput) => Promise<CreateNamespaceOutput>>();
vi.mock('@/lib/mediforce', () => ({
  mediforce: { namespaces: { create: createMock } },
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { mediforce } = await import('@/lib/mediforce');

function makeBundle(): GetMeOutput {
  return {
    user: { uid: 'uid-marek', email: 'marek@example.test', displayName: 'Marek' },
    namespaces: [{ handle: 'marek', type: 'personal', displayName: 'Marek', role: 'owner' }],
  };
}

function useOptimisticCreate() {
  const qc = useQueryClient();
  return useMutation<CreateNamespaceOutput, Error, CreateNamespaceInput, { restore: () => void }>({
    mutationFn: (input) => mediforce.namespaces.create(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.users.me() });
      const { restore } = snapshotCache(qc, [queryKeys.users.me()]);
      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        const placeholder: MeNamespace = {
          handle: input.handle,
          type: 'organization',
          displayName: input.displayName,
          role: 'owner',
        };
        return { ...prev, namespaces: [placeholder, ...prev.namespaces] };
      });
      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSuccess: (data) => {
      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        const echo: MeNamespace = {
          handle: data.namespace.handle,
          type: data.namespace.type,
          displayName: data.namespace.displayName,
          role: 'owner',
        };
        const others = prev.namespaces.filter((n) => n.handle !== data.namespace.handle);
        return { ...prev, namespaces: [echo, ...others] };
      });
    },
  });
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(queryKeys.users.me(), makeBundle());
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, qc };
}

describe('namespaces.create optimistic update (list-affecting template)', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prepends optimistic placeholder, then replaces with server-echo on success', async () => {
    createMock.mockResolvedValue({
      namespace: {
        handle: 'acme',
        type: 'organization',
        displayName: 'Acme Co.',
        createdAt: '2026-05-28T00:00:00.000Z',
      },
    });
    const { wrapper, qc } = makeWrapper();

    const { result } = renderHook(() => useOptimisticCreate(), { wrapper });

    const promise = result.current.mutateAsync({ handle: 'acme', displayName: 'Acme Co.' });

    await waitFor(() => {
      const cached = qc.getQueryData<GetMeOutput>(queryKeys.users.me());
      expect(cached?.namespaces[0]?.handle).toBe('acme');
    });

    await promise;

    const final = qc.getQueryData<GetMeOutput>(queryKeys.users.me());
    expect(final?.namespaces).toHaveLength(2);
    expect(final?.namespaces[0]?.handle).toBe('acme');
    expect(final?.namespaces[0]?.role).toBe('owner');
  });

  it('rolls the cache back when the create call fails', async () => {
    createMock.mockRejectedValue(new Error('conflict'));
    const { wrapper, qc } = makeWrapper();
    const before = qc.getQueryData<GetMeOutput>(queryKeys.users.me());

    const { result } = renderHook(() => useOptimisticCreate(), { wrapper });

    await expect(result.current.mutateAsync({ handle: 'acme', displayName: 'Acme Co.' })).rejects.toThrow('conflict');

    const after = qc.getQueryData<GetMeOutput>(queryKeys.users.me());
    expect(after).toEqual(before);
  });
});
