import { cn } from '@/lib/utils';
import {
  getControlMode,
  CONTROL_MODE_LABELS,
  CONTROL_MODE_NUMBER,
  type ControlMode,
} from '@/lib/control-mode';

const BADGE_STYLES: Record<ControlMode, string> = {
  'no-agent':      'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  'assist':         'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  'cowork':        'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  'human-review':  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  'autonomous-agent': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
};

/**
 * Replaces AutonomyBadge everywhere. Derives the control mode from
 * executor + autonomyLevel and displays the user-facing label.
 */
export function ControlModeBadge({
  executor,
  autonomyLevel,
  showNumber = false,
  className,
}: {
  executor: string | undefined;
  autonomyLevel?: string | null;
  showNumber?: boolean;
  className?: string;
}) {
  const mode = getControlMode(executor, autonomyLevel);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
        BADGE_STYLES[mode],
        className,
      )}
    >
      {showNumber && (
        <span className="mr-1 opacity-50">{CONTROL_MODE_NUMBER[mode]}</span>
      )}
      {CONTROL_MODE_LABELS[mode]}
    </span>
  );
}
