'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  DeleteNamespaceInput,
  DeleteNamespaceOutput,
  GetMeOutput,
  GetNamespaceOutput,
  LeaveNamespaceInput,
  LeaveNamespaceOutput,
  RemoveNamespaceMemberInput,
  RemoveNamespaceMemberOutput,
  UpdateNamespaceInput,
  UpdateNamespaceMemberRoleInput,
  UpdateNamespaceMemberRoleOutput,
  UpdateNamespaceOutput,
} from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { snapshotCache } from '@/lib/optimistic';
import { queryKeys } from '@/lib/query-keys';

/**
 * PATCH /api/namespaces/:handle — write workspace metadata (displayName,
 * bio, icon, logo, brand colors). Optimistic patch on `['namespace', handle]` so the UI flips
 * immediately; the entity-echo replaces the cache in `onSuccess`. Falls
 * back to the snapshot on error.
 *
 * Also invalidates `['users', 'me']` so the sidebar switcher picks up the
 * new displayName/icon next tick.
 */
export function useUpdateNamespace(handle: string) {
  const qc = useQueryClient();
  return useMutation<
    UpdateNamespaceOutput,
    Error,
    UpdateNamespaceInput,
    { restore: () => void }
  >({
    mutationFn: (input) => mediforce.namespaces.update(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.namespace(handle) });
      const { restore } = snapshotCache(qc, [queryKeys.namespace(handle), queryKeys.users.me()]);
      qc.setQueryData<GetNamespaceOutput | undefined>(queryKeys.namespace(handle), (prev) => {
        if (prev === undefined) return prev;
        return {
          ...prev,
          namespace: {
            ...prev.namespace,
            ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
            ...(input.icon !== undefined ? { icon: input.icon } : {}),
            ...(input.logo !== undefined ? { logo: input.logo } : {}),
            ...(input.brandPrimaryColor !== undefined ? { brandPrimaryColor: input.brandPrimaryColor } : {}),
            ...(input.brandAccentColor !== undefined ? { brandAccentColor: input.brandAccentColor } : {}),
            ...(input.bio !== undefined ? { bio: input.bio } : {}),
          },
        };
      });
      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSuccess: (data) => {
      qc.setQueryData<GetNamespaceOutput | undefined>(queryKeys.namespace(handle), (prev) => {
        if (prev === undefined) return { namespace: data.namespace, members: [] };
        return { ...prev, namespace: data.namespace };
      });
      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        return {
          ...prev,
          namespaces: prev.namespaces.map((n) =>
            n.handle === data.namespace.handle
              ? {
                  ...n,
                  displayName: data.namespace.displayName,
                  ...(data.namespace.icon !== undefined ? { icon: data.namespace.icon } : {}),
                  ...(data.namespace.avatarUrl !== undefined ? { avatarUrl: data.namespace.avatarUrl } : {}),
                  ...(data.namespace.logo !== undefined ? { logo: data.namespace.logo } : {}),
                  ...(data.namespace.brandPrimaryColor !== undefined ? { brandPrimaryColor: data.namespace.brandPrimaryColor } : {}),
                  ...(data.namespace.brandAccentColor !== undefined ? { brandAccentColor: data.namespace.brandAccentColor } : {}),
                }
              : n,
          ),
        };
      });
    },
  });
}

/**
 * PATCH /api/namespaces/:handle/members/:uid — flip member ↔ admin.
 * Optimistic role swap on `['namespace', handle]`'s members array;
 * entity-echo overwrites the matched member in `onSuccess`.
 */
export function useUpdateMemberRole(handle: string) {
  const qc = useQueryClient();
  return useMutation<
    UpdateNamespaceMemberRoleOutput,
    Error,
    UpdateNamespaceMemberRoleInput,
    { restore: () => void }
  >({
    mutationFn: (input) => mediforce.namespaces.updateMemberRole(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.namespace(handle) });
      const { restore } = snapshotCache(qc, [queryKeys.namespace(handle)]);
      qc.setQueryData<GetNamespaceOutput | undefined>(queryKeys.namespace(handle), (prev) => {
        if (prev === undefined) return prev;
        return {
          ...prev,
          members: prev.members.map((m) => (m.uid === input.uid ? { ...m, role: input.role } : m)),
        };
      });
      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSuccess: (data) => {
      qc.setQueryData<GetNamespaceOutput | undefined>(queryKeys.namespace(handle), (prev) => {
        if (prev === undefined) return prev;
        return {
          ...prev,
          members: prev.members.map((m) => (m.uid === data.member.uid ? data.member : m)),
        };
      });
    },
  });
}

/**
 * DELETE /api/namespaces/:handle/members/:uid — remove a member from the
 * workspace. Optimistically filters them out of the `['namespace', handle]`
 * members list; restores on error.
 */
export function useRemoveMember(handle: string) {
  const qc = useQueryClient();
  return useMutation<
    RemoveNamespaceMemberOutput,
    Error,
    RemoveNamespaceMemberInput,
    { restore: () => void }
  >({
    mutationFn: (input) => mediforce.namespaces.removeMember(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.namespace(handle) });
      const { restore } = snapshotCache(qc, [queryKeys.namespace(handle)]);
      qc.setQueryData<GetNamespaceOutput | undefined>(queryKeys.namespace(handle), (prev) => {
        if (prev === undefined) return prev;
        return { ...prev, members: prev.members.filter((m) => m.uid !== input.uid) };
      });
      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
  });
}

/**
 * POST /api/namespaces/:handle/leave — caller self-removes. Drops the
 * namespace from `['users', 'me']` immediately, then removes the cached
 * namespace detail on success.
 */
export function useLeaveNamespace() {
  const qc = useQueryClient();
  return useMutation<
    LeaveNamespaceOutput,
    Error,
    LeaveNamespaceInput,
    { restore: () => void }
  >({
    mutationFn: (input) => mediforce.namespaces.leave(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.users.me() });
      const { restore } = snapshotCache(qc, [
        queryKeys.users.me(),
        queryKeys.namespace(input.handle),
      ]);
      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        return { ...prev, namespaces: prev.namespaces.filter((n) => n.handle !== input.handle) };
      });
      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSuccess: (data) => {
      qc.removeQueries({ queryKey: queryKeys.namespace(data.handle) });
    },
  });
}

/**
 * DELETE /api/namespaces/:handle — cascade delete (owner only). Mirrors
 * the leave flow on the cache side: drops the namespace from `['users',
 * 'me']` and removes the namespace detail entry on success.
 */
export function useDeleteNamespace() {
  const qc = useQueryClient();
  return useMutation<
    DeleteNamespaceOutput,
    Error,
    DeleteNamespaceInput,
    { restore: () => void }
  >({
    mutationFn: (input) => mediforce.namespaces.delete(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: queryKeys.users.me() });
      const { restore } = snapshotCache(qc, [
        queryKeys.users.me(),
        queryKeys.namespace(input.handle),
      ]);
      qc.setQueryData<GetMeOutput | undefined>(queryKeys.users.me(), (prev) => {
        if (prev === undefined) return prev;
        return { ...prev, namespaces: prev.namespaces.filter((n) => n.handle !== input.handle) };
      });
      return { restore };
    },
    onError: (_err, _input, ctx) => {
      ctx?.restore();
    },
    onSuccess: (data) => {
      qc.removeQueries({ queryKey: queryKeys.namespace(data.handle) });
    },
  });
}
