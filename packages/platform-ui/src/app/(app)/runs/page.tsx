'use client';

import { useProcessInstances } from '@/hooks/use-process-instances';
import { RunsTable } from '@/components/processes/runs-table';

export default function RunsPage() {
  const { data: runs, loading } = useProcessInstances('all');

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
          runs={runs}
          loading={loading}
          showProcess
          emptyMessage="No runs yet."
        />
      </div>
    </div>
  );
}
