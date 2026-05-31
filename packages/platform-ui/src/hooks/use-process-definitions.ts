'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import type { WorkflowRunSummary } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { stopRetryOn4xx } from '@/lib/retry';

export interface DefinitionVersion {
  version: string;
  stepCount: number;
  triggerCount: number;
  title?: string;
  description?: string;
}

export interface DefinitionGroup {
  name: string;
  title?: string;
  description?: string;
  latestVersion: string;
  versions: DefinitionVersion[];
  stepCount: number;
  hasManualTrigger: boolean;
  repo?: { url: string; branch?: string; directory?: string };
  url?: string;
  archived?: boolean;
  namespace?: string;
  visibility?: string;
  runSummary: WorkflowRunSummary;
}

/**
 * Workspace-home workflow cards data. ONE-SHOT per ADR-0006 §4 —
 * `refetchOnWindowFocus: true` (default) is enough; mutations to workflows
 * (`workflows.register`, `workflows.delete`, etc.) invalidate the cache.
 *
 * Source is `mediforce.workflows.list({})` which returns the latest version
 * per `(name, namespace)` group; consumers on workspace home don't iterate
 * historical versions. For full version pickers use `useWorkflowVersions`
 * (separate hook, separate endpoint).
 */
export function useProcessDefinitions(includeCompletedRuns: boolean = true) {
  const query = useQuery({
    queryKey: ['workflows', 'list', includeCompletedRuns] as const,
    queryFn: async () => {
      const result = await mediforce.workflows.list({ includeCompletedRuns });
      return result.definitions;
    },
    retry: stopRetryOn4xx,
  });

  const groups = query.data ?? [];

  const latestDocs = useMemo((): Map<string, WorkflowDefinition> => {
    const result = new Map<string, WorkflowDefinition>();
    for (const g of groups) {
      if (g.definition === null) continue;
      result.set(`${g.namespace}:${g.name}`, g.definition);
    }
    return result;
  }, [groups]);

  const definitions = useMemo((): DefinitionGroup[] => {
    return groups
      .filter((g) => g.definition !== null)
      .map((g) => {
        // `definition !== null` guarded above; non-null narrowing for the type system.
        const def = g.definition as WorkflowDefinition;
        const latestVersion = String(g.latestVersion);
        return {
          name: g.name,
          title: def.title,
          description: def.description,
          latestVersion,
          versions: [
            {
              version: latestVersion,
              stepCount: def.steps.length,
              triggerCount: def.triggers.length,
              title: def.title,
              description: def.description,
            },
          ],
          stepCount: def.steps.length,
          hasManualTrigger: def.triggers.some((t) => t.type === 'manual'),
          repo: def.repo,
          url: def.url,
          archived: def.archived,
          namespace: g.namespace,
          visibility: def.visibility,
          runSummary: g.runSummary,
        };
      });
  }, [groups]);

  const stepsByDefinition = useMemo((): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const doc of latestDocs.values()) {
      result.set(
        doc.name,
        doc.steps.filter((step) => step.type !== 'terminal').map((step) => step.id),
      );
    }
    return result;
  }, [latestDocs]);

  return {
    definitions,
    stepsByDefinition,
    latestDocs,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
