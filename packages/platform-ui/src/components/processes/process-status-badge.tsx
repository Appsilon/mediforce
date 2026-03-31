import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  waiting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  created: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export function ProcessStatusBadge({
  status,
  pauseReason,
}: {
  status: string;
  pauseReason?: string | null;
}) {
  const isWaiting = status === 'paused' && (
    pauseReason === 'waiting_for_human' || pauseReason === 'awaiting_agent_approval'
  );
  const isCowork = status === 'paused' && pauseReason === 'cowork_in_progress';
  const label = isCowork
    ? 'Co-work'
    : isWaiting
      ? (pauseReason === 'awaiting_agent_approval' ? 'Review needed' : 'Waiting')
      : status;
  const styleKey = isWaiting ? 'waiting' : status;

  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[styleKey] ?? STATUS_STYLES.created)}>
      {label}
    </span>
  );
}
