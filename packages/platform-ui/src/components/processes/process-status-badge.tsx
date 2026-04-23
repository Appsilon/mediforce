import { cn } from '@/lib/utils';
import { getWorkflowStatus, type WorkflowDisplayStatus } from '@/lib/workflow-status';

const STATUS_STYLES: Record<WorkflowDisplayStatus, string> = {
  in_progress: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  waiting_for_human: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
};

const STATUS_LABELS: Record<WorkflowDisplayStatus, string> = {
  in_progress: 'In Progress',
  waiting_for_human: 'Waiting for human',
  error: 'Error',
  completed: 'Completed',
};

export function ProcessStatusBadge({
  status,
  pauseReason,
}: {
  status: string;
  pauseReason?: string | null;
}) {
  const { displayStatus } = getWorkflowStatus({ status, pauseReason });
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[displayStatus])}>
      {STATUS_LABELS[displayStatus]}
    </span>
  );
}
