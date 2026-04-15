import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  claimed: 'bg-blue-500',
  completed: 'bg-green-500',
  cancelled: 'bg-gray-400',
  running: 'bg-blue-500 animate-pulse',
  paused: 'bg-amber-500',
  blocked: 'bg-red-500',
  waiting: 'bg-amber-500',
  failed: 'bg-red-500',
  created: 'bg-gray-400',
};

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full shrink-0', STATUS_COLORS[status] ?? 'bg-gray-400', className)}
      title={status}
    />
  );
}
