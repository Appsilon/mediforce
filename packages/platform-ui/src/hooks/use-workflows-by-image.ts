'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-fetch';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';

/** One workflow **version** that pins at least one of the images asked about,
 *  with the step ids that pin it. */
export interface WorkflowImageMatch {
  name: string;
  namespace: string;
  title: string | undefined;
  version: number;
  /**
   * The version a run starts from: the default version if it is live,
   * otherwise the newest live one (`pickRunnableVersion`). Only `scope: 'all'`
   * returns anything else, so the default answer is all live.
   */
  live: boolean;
  /** The version runs fall back to once this one is archived; `null` when none
   *  would be left, so archiving it archives the whole workflow. */
  fallbackVersion: number | null;
  /** The workflow explicitly pins this version as its default. Archiving one of
   *  those would leave it pointing at a version that cannot run, so the delete
   *  flow offers a different remedy for it. */
  isDefault: boolean;
  archived: boolean;
  steps: string[];
  /** Which of the requested images this version uses — what makes a version
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
 *
 * `scope` decides how wide the answer is: `live` (the default) reports only
 * versions a run can start from, `all` reports every version and includes
 * archived workflows. The two are cached separately, since one is a subset of
 * the other and a reader switching between them must not see the wrong one.
 */
export function useWorkflowsByImage(
  images: readonly string[],
  enabled: boolean,
  scope: 'live' | 'all' = 'live',
): { workflows: WorkflowImageMatch[] | undefined; loading: boolean; error: Error | null } {
  const query = useQuery({
    queryKey: [...queryKeys.workflowsByImage(images), scope],
    queryFn: async () => {
      const params = new URLSearchParams(images.map((image) => ['image', image]));
      // `all` widens the answer from "what breaks" to "everything that mentions
      // these images" — every version, archived included. Only the delete flow
      // wants that; a "used by" panel listing superseded versions is noise.
      if (scope === 'all') params.set('scope', 'all');
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
