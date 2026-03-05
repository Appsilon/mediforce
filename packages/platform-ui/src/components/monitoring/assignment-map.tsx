import { cn } from '@/lib/utils';

export function AssignmentMap({
  roleCounts,
  loading,
}: {
  roleCounts: Array<{ role: string; pending: number; claimed: number; total: number }>;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="h-6 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (roleCounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No open tasks — all task queues are empty.
      </div>
    );
  }

  const maxTotal = Math.max(...roleCounts.map((r) => r.total), 1);

  return (
    <div className="space-y-4">
      {roleCounts.map(({ role, pending, claimed, total }) => (
        <div key={role} className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{role}</span>
            <span className="text-muted-foreground">{total} open</span>
          </div>
          {/* Bar */}
          <div className={cn('h-6 rounded-md bg-muted overflow-hidden flex')}>
            {/* Claimed portion (blue) */}
            {claimed > 0 && (
              <div
                className="h-full bg-blue-500 dark:bg-blue-400 flex items-center justify-center text-xs font-medium text-white"
                style={{ width: `${(claimed / maxTotal) * 100}%` }}
              >
                {claimed}
              </div>
            )}
            {/* Pending portion (amber) */}
            {pending > 0 && (
              <div
                className="h-full bg-amber-500 dark:bg-amber-400 flex items-center justify-center text-xs font-medium text-white"
                style={{ width: `${(pending / maxTotal) * 100}%` }}
              >
                {pending}
              </div>
            )}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> {pending} pending
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" /> {claimed} claimed
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
