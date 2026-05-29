import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useUpdateMemberRole } from '@/hooks/use-namespace-mutations';
import type {
  GetNamespaceOutput,
  UpdateNamespaceMemberRoleInput,
  UpdateNamespaceMemberRoleOutput,
} from '@mediforce/platform-api/contract';

const updateMemberRoleMock = vi.hoisted(() =>
  vi.fn<(input: UpdateNamespaceMemberRoleInput) => Promise<UpdateNamespaceMemberRoleOutput>>(),
);
vi.mock('@/lib/mediforce', () => ({
  mediforce: { namespaces: { updateMemberRole: updateMemberRoleMock } },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

function makeBundle(): GetNamespaceOutput {
  return {
    namespace: {
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    members: [
      { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
      { uid: 'uid-member', role: 'member', joinedAt: '2026-02-01T00:00:00.000Z' },
    ],
  };
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(queryKeys.namespace('acme'), makeBundle());
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, qc };
}

describe('useUpdateMemberRole optimistic update (state-transition template)', () => {
  beforeEach(() => updateMemberRoleMock.mockReset());
  afterEach(() => updateMemberRoleMock.mockReset());

  it('optimistically flips role; server entity-echo replaces it in onSuccess', async () => {
    let resolve!: (output: UpdateNamespaceMemberRoleOutput) => void;
    updateMemberRoleMock.mockImplementationOnce(
      () => new Promise<UpdateNamespaceMemberRoleOutput>((r) => { resolve = r; }),
    );
    const { wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useUpdateMemberRole('acme'), { wrapper });

    act(() => {
      result.current.mutate({ handle: 'acme', uid: 'uid-member', role: 'admin' });
    });

    // Optimistic: cache reflects the new role immediately.
    await waitFor(() => {
      const cached = qc.getQueryData<GetNamespaceOutput>(queryKeys.namespace('acme'));
      expect(cached?.members.find((m) => m.uid === 'uid-member')?.role).toBe('admin');
    });

    resolve({
      member: {
        uid: 'uid-member',
        role: 'admin',
        displayName: 'Echoed Name',
        joinedAt: '2026-02-01T00:00:00.000Z',
      },
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = qc.getQueryData<GetNamespaceOutput>(queryKeys.namespace('acme'));
    expect(cached?.members.find((m) => m.uid === 'uid-member')).toMatchObject({
      role: 'admin',
      displayName: 'Echoed Name',
    });
  });

  it('restores the original cache on error', async () => {
    updateMemberRoleMock.mockRejectedValueOnce(new Error('boom'));
    const { wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useUpdateMemberRole('acme'), { wrapper });

    act(() => {
      result.current.mutate({ handle: 'acme', uid: 'uid-member', role: 'admin' });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = qc.getQueryData<GetNamespaceOutput>(queryKeys.namespace('acme'));
    expect(cached?.members.find((m) => m.uid === 'uid-member')?.role).toBe('member');
  });
});
