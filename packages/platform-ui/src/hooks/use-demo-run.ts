'use client';

import { useMemo } from 'react';
import { pickDemoRun, type DemoRunCandidate } from '@/lib/demo';
import { useProcessInstancesPage } from './use-process-instances-page';

/**
 * A real run for a demo scenario to open — the best one this workspace has.
 *
 * Fetched only while a scenario actually needs it, because the alternative is
 * every page paying for a query that four walkthroughs use. Dry runs are
 * excluded: a scenario about proving what happened should not open a run whose
 * steps were mocked.
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
