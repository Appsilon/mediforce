import { cn } from '@/lib/utils';
import type { InstanceStatus } from '@mediforce/platform-core';
import { getWorkflowStatus, type WorkflowDisplayStatus } from '@/lib/workflow-status';

const STATUS_STYLES: Record<WorkflowDisplayStatus, string> = {
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  waiting_for_human: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

export const STATUS_LABELS: Record<WorkflowDisplayStatus, string> = {
  in_progress: 'In Progress',
  waiting_for_human: 'Waiting for human',
  error: 'Error',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

export function ProcessStatusBadge({
  status,
  pauseReason,
  error,
  dryRun,
}: {
  status: InstanceStatus;
  pauseReason?: string | null;
  error?: string | null;
  dryRun?: boolean;
}) {
  const { displayStatus } = getWorkflowStatus({ status, pauseReason, error });
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[displayStatus])}>
        {STATUS_LABELS[displayStatus]}
      </span>
      {dryRun && (
        <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
          Dry Run
        </span>
      )}
    </span>
  );
}
