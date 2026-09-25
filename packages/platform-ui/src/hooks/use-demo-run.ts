'use client';

import { useMemo } from 'react';
import { pickDemoRun, type DemoRunCandidate } from '@/lib/demo';
import { useProcessInstancesPage } from './use-process-instances-page';

/**
 * The best run this workspace has for a scenario to open.
 *
 * Completed runs are asked for separately rather than ranked out of one page:
 * the list is keyset-paginated at 20, so a workspace whose twenty most recent
 * runs all failed would otherwise open a failed run in front of a customer.
 * Dry runs are excluded — a walkthrough of what happened should not open a run
 * whose steps were mocked.
 */
export function useDemoRun(namespace: string, enabled: boolean): DemoRunCandidate | null {
  const shared = {
    namespace,
    dryRun: false,
    archived: false,
    sort: 'started',
    direction: 'desc',
    enabled,
  } as const;

  const completed = useProcessInstancesPage({ ...shared, displayStatus: 'completed' });
  const anyStatus = useProcessInstancesPage(shared);

  return useMemo(() => {
    if (enabled === false) return null;
    const rows = completed.data.length > 0 ? completed.data : anyStatus.data;
    return pickDemoRun(
      rows.map((run) => ({
        id: run.id,
        definitionName: run.definitionName,
        status: run.status,
        startedAt: run.createdAt,
      })),
    );
  }, [completed.data, anyStatus.data, enabled]);
}
