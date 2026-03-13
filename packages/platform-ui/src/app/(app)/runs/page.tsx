'use client';

import { useMemo } from 'react';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useProcessDefinitions } from '@/hooks/use-process-definitions';
import { RunsTable } from '@/components/processes/runs-table';

export default function RunsPage() {
  const { data: runs, loading: runsLoading } = useProcessInstances('all');
  const { definitions, loading: defsLoading } = useProcessDefinitions();

  const archivedNames = useMemo(
    () => new Set(definitions.filter((d) => d.archived).map((d) => d.name)),
    [definitions],
  );

  const visibleRuns = useMemo(
    () => runs.filter((r) => !archivedNames.has(r.definitionName)),
    [runs, archivedNames],
  );

  return (
    <div className="flex flex-1 flex-col gap-0">
      <div className="border-b px-6 py-4">
        <h1 className="text-xl font-headline font-semibold">My Runs</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          All runs across processes, sorted by creation time.
        </p>
      </div>

      <div className="p-6">
        <RunsTable
          runs={visibleRuns}
          loading={runsLoading || defsLoading}
          showProcess
          emptyMessage="No runs yet."
        />
      </div>
    </div>
  );
}
