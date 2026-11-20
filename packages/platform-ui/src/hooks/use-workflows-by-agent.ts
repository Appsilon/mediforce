'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

/** One step of a workflow's runnable version naming the agent asked about. */
export interface WorkflowAgentUsageStep {
  stepId: string;
  pinnedVersion: number | null;
}

/** One workflow whose runnable version has a step naming the agent. */
export interface WorkflowAgentUsage {
  namespace: string;
  name: string;
  title: string | undefined;
  version: number;
  steps: WorkflowAgentUsageStep[];
}

/**
 * Workflows currently running the given Agent — the Agent page's "Used by"
 * answer, read from each workflow's runnable version rather than its run
 * history (see `findWorkflowAgentUsage`).
 */
export function useWorkflowsByAgent(
  agentId: string | null,
): { workflows: WorkflowAgentUsage[] | undefined; loading: boolean; error: Error | null } {
  const enabled = agentId !== null;
  const query = useQuery({
    queryKey: queryKeys.workflowAgentUsage(agentId ?? ''),
    queryFn: async () => {
      const res = await apiFetch(`/api/workflow-definitions/by-agent?agentId=${encodeURIComponent(agentId as string)}`);
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
      const body = (await res.json()) as { workflows: WorkflowAgentUsage[] };
      return body.workflows;
    },
    enabled,
    retry: stopRetryOn4xx,
  });

  return {
    workflows: query.data,
    loading: enabled && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}
