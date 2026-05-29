'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import type { WorkflowVersionSummary } from '@mediforce/platform-api/contract';
import { ApiError, mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';

function retryOn5xx(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
  return failureCount < 2;
}

/**
 * Version metadata list for a workflow in a namespace, react-query backed.
 *
 * ONE-SHOT per ADR-0006 §4 — `refetchOnWindowFocus: true` is enough; explicit
 * invalidations from workflow mutations (`register`, `delete`, `archive`,
 * `setDefaultVersion`) keep the cache fresh.
 *
 * The shape mirrors what the workspace version picker / archive list need:
 * version number, archived flag, optional title/description, step + trigger
 * counts. To fetch the full definition for a specific version use
 * `useWorkflowVersion(name, namespace, version)` (separate hook, single GET).
 */
export function useWorkflowVersions(
  name: string,
  namespace: string,
): {
  versions: WorkflowVersionSummary[];
  defaultVersion: number | null;
  latestVersion: number | null;
  effectiveVersion: number | null;
  loading: boolean;
  error: Error | null;
  refreshDefault: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  const enabled = name.length > 0 && namespace.length > 0;

  const query = useQuery({
    queryKey: enabled
      ? queryKeys.workflowVersions(namespace, name)
      : queryKeys.workflowVersions('__noop__', '__noop__'),
    queryFn: async () => {
      if (!enabled) throw new Error('unreachable: enabled gates this');
      return mediforce.workflows.versions({ name, namespace });
    },
    enabled,
    retry: retryOn5xx,
  });

  // Sort versions desc by `version` so callers iterate "latest first" without
  // re-sorting at every render. The server response order is not contractual.
  const versions = useMemo<WorkflowVersionSummary[]>(() => {
    return [...(query.data?.versions ?? [])].sort((a, b) => b.version - a.version);
  }, [query.data]);

  const defaultVersion = query.data?.defaultVersion ?? null;
  const latestVersion = versions[0]?.version ?? null;
  const effectiveVersion = defaultVersion ?? latestVersion;

  const refreshDefault = useCallback(async () => {
    if (!enabled) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workflowVersions(namespace, name),
    });
  }, [queryClient, namespace, name, enabled]);

  return {
    versions,
    defaultVersion,
    latestVersion,
    effectiveVersion,
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
    refreshDefault,
  };
}

/**
 * Single workflow definition (one version). ONE-SHOT — refetch on focus is
 * enough; mutations to the definition invalidate this key explicitly.
 */
export function useWorkflowVersion(
  name: string,
  namespace: string,
  version: number | null | undefined,
): { definition: WorkflowDefinition | null; loading: boolean; error: Error | null } {
  const enabled = name.length > 0 && namespace.length > 0 && version !== null && version !== undefined && version > 0;
  const query = useQuery({
    queryKey: enabled
      ? queryKeys.workflow(namespace, name, version)
      : (['workflow', '__noop__'] as const),
    queryFn: async () => {
      if (!enabled || version === null || version === undefined) {
        throw new Error('unreachable: enabled gates this');
      }
      const result = await mediforce.workflows.get({ name, namespace, version });
      return result.definition;
    },
    enabled,
    retry: retryOn5xx,
  });

  return {
    definition: query.data ?? null,
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
