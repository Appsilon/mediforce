'use client';

import { useMemo } from 'react';
import { pickDemoRun, type DemoRunCandidate } from '@/lib/demo';
import { useProcessInstancesPage } from './use-process-instances-page';

/**
 * The best run this workspace has for a scenario to open.
 *
 * `enabled` is false on every page that is not mid-scenario, so the query is
 * not a cost the rest of the app pays. Dry runs are excluded: a walkthrough of
 * what happened should not open a run whose steps were mocked.
 */
export function useDemoRun(namespace: string, enabled: boolean): DemoRunCandidate | null {
  const { data } = useProcessInstancesPage({
    namespace: enabled ? namespace : '',
    dryRun: false,
    archived: false,
    sort: 'started',
    direction: 'desc',
  });

  return useMemo(() => {
    if (!enabled) return null;
    return pickDemoRun(
      data.map((run) => ({
        id: run.id,
        definitionName: run.definitionName,
        status: run.status,
        startedAt: run.createdAt,
      })),
    );
  }, [data, enabled]);
}
