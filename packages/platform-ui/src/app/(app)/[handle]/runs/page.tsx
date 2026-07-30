'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { AllRunsPanel } from '@/components/processes/all-runs-panel';
import { formatStepName } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function RunsPage() {
  const { handle } = useParams<{ handle: string }>();
  const { role, loading: roleLoading } = useNamespaceRole(handle);

  if (roleLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (role === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="font-medium">Runs are only visible to workspace members</p>
          <p className="text-sm text-muted-foreground mt-1">
            Join this workspace to see workflow runs.
          </p>
        </div>
        <Link
          href={`/${handle}`}
          className="text-sm text-primary hover:underline"
        >
          Back to profile
        </Link>
      </div>
    );
  }

  return <RunsPageContent handle={handle} />;
}

function RunsPageContent({ handle }: { handle: string }) {
  const searchParams = useSearchParams();
  const workflowFilter = searchParams.get('workflow');

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {workflowFilter
            ? 'All runs for this workflow.'
            : 'All workflow runs across the platform.'}
        </p>
        {workflowFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Filtered by:{' '}
              <span className="font-medium text-foreground">
                {formatStepName(workflowFilter)}
              </span>
            </span>
            <a
              href={`/${handle}/runs`}
              className={cn(
                'text-xs text-primary hover:underline',
              )}
            >
              Clear filter
            </a>
          </div>
        )}
      </div>

      <AllRunsPanel handle={handle} workflowFilter={workflowFilter} />
    </div>
  );
}
