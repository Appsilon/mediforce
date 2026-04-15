import { cn } from '@/lib/utils';
import { getProcessStatusDisplay, type StatusColorKey } from '@/lib/process-status-display';

const COLOR_STYLES: Record<StatusColorKey, string> = {
  running:   'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  waiting:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  blocked:   'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  completed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  failed:    'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  created:   'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export function ProcessStatusBadge({
  status,
  pauseReason,
}: {
  status: string;
  pauseReason?: string | null;
}) {
  const display = getProcessStatusDisplay(status, pauseReason);

  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium', COLOR_STYLES[display.colorKey])}>
      {display.label}
    </span>
  );
}
