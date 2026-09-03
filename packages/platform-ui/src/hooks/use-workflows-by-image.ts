'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

/** One workflow whose latest version pins at least one of the images asked
 *  about, with the step ids that pin it. */
export interface WorkflowImageMatch {
  name: string;
  namespace: string;
  title: string | undefined;
  version: number;
  steps: string[];
  /** Which of the requested images this workflow uses — what makes a version
   *  nobody pins visible as unused. */
  images: string[];
}

/**
 * Workflows using any of the given images — the "used by" answer.
 *
 * Lazy: `enabled` is what an expandable row passes, so the scan behind
 * `/api/workflow-definitions/by-image` (every workflow definition, no index on
 * `steps[].agent.image`) is paid only for the row somebody opened. One request
 * for the whole set rather than one per image, so an entry with six versions
 * costs one scan, not six.
 */
export function useWorkflowsByImage(
  images: readonly string[],
  enabled: boolean,
): { workflows: WorkflowImageMatch[] | undefined; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: queryKeys.workflowsByImage(images),
    queryFn: async () => {
      const params = new URLSearchParams(images.map((image) => ['image', image]));
      const res = await apiFetch(`/api/workflow-definitions/by-image?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
      const body = (await res.json()) as { workflows: WorkflowImageMatch[] };
      return body.workflows;
    },
    enabled: enabled && images.length > 0,
    retry: stopRetryOn4xx,
  });

  return {
    workflows: query.data,
    // `isPending` stays true for a query that never runs, so the caller's own
    // gate is folded in here rather than leaving a disabled query rendering as
    // a spinner that never resolves.
    loading: query.isPending && enabled && images.length > 0,
    error: (query.error as Error | null) ?? null,
  };
}
