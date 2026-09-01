import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useSetMemberRoles } from '@/hooks/use-namespace-mutations';
import type {
  ListNamespaceMembersOutput,
  SetNamespaceMemberRolesInput,
  SetNamespaceMemberRolesOutput,
} from '@mediforce/platform-api/contract';

const setMemberRolesMock = vi.hoisted(() =>
  vi.fn<(input: SetNamespaceMemberRolesInput) => Promise<SetNamespaceMemberRolesOutput>>(),
);
vi.mock('@/lib/mediforce', () => ({
  mediforce: { namespaces: { setMemberRoles: setMemberRolesMock } },
  ApiError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

function makeRoster(): ListNamespaceMembersOutput {
  return {
    members: [
      {
        uid: 'uid-owner',
        role: 'owner',
        joinedAt: '2026-01-01T00:00:00.000Z',
        displayName: 'Owner',
        email: null,
        lastSignInTime: null,
        grants: [],
      },
      {
        uid: 'uid-alice',
        role: 'member',
        joinedAt: '2026-02-01T00:00:00.000Z',
        displayName: 'Alice',
        email: null,
        lastSignInTime: null,
        grants: [{ role: 'approver', workflowName: 'tealflow' }],
      },
    ],
  };
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(queryKeys.namespaceMembers('acme'), makeRoster());
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { wrapper: Wrapper, qc };
}

function grantsOf(qc: QueryClient, uid: string) {
  const cached = qc.getQueryData<ListNamespaceMembersOutput>(queryKeys.namespaceMembers('acme'));
  return cached?.members.find((member) => member.uid === uid)?.grants;
}

describe('useSetMemberRoles optimistic update (state-transition template)', () => {
  beforeEach(() => setMemberRolesMock.mockReset());

  it('optimistically writes the new grants; the server echo replaces them in onSuccess', async () => {
    let resolve!: (output: SetNamespaceMemberRolesOutput) => void;
    setMemberRolesMock.mockImplementationOnce(
      () => new Promise<SetNamespaceMemberRolesOutput>((r) => { resolve = r; }),
    );
    const { wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useSetMemberRoles('acme'), { wrapper });

    const grants = [
      { role: 'approver', workflowName: 'tealflow' },
      { role: 'reviewer', workflowName: null },
    ];
    act(() => {
      result.current.mutate({ handle: 'acme', uid: 'uid-alice', grants });
    });

    await waitFor(() => expect(grantsOf(qc, 'uid-alice')).toEqual(grants));

    resolve({ handle: 'acme', uid: 'uid-alice', grants });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(grantsOf(qc, 'uid-alice')).toEqual(grants);
    // Other rows are untouched: the write names one member.
    expect(grantsOf(qc, 'uid-owner')).toEqual([]);
  });

  it('restores the original grants on error', async () => {
    setMemberRolesMock.mockRejectedValueOnce(new Error('boom'));
    const { wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => useSetMemberRoles('acme'), { wrapper });

    act(() => {
      result.current.mutate({ handle: 'acme', uid: 'uid-alice', grants: [] });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    // A failed clear must not leave the roster showing "no roles" — the next
    // admin to read this row would grant off a set the server never accepted.
    expect(grantsOf(qc, 'uid-alice')).toEqual([{ role: 'approver', workflowName: 'tealflow' }]);
  });
});
