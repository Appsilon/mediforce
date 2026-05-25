'use client';

import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { MonitoringData } from '@/hooks/use-monitoring';

interface Props {
  data: MonitoringData;
}

export function TasksTab({ data }: Props) {
  const { tasks, roleCounts, loading } = data;

  const summary = useMemo(() => {
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const claimed = tasks.filter((t) => t.status === 'claimed').length;
    const unassigned = tasks.filter((t) => t.status === 'pending' && t.assignedUserId === null).length;
    return { pending, claimed, unassigned, total: pending + claimed };
  }, [tasks]);

  const byAssignee = useMemo(() => {
    const map = new Map<string, { pending: number; claimed: number }>();
    for (const task of tasks) {
      const key = task.assignedUserId ?? '__unassigned__';
      const entry = map.get(key) ?? { pending: 0, claimed: 0 };
      if (task.status === 'pending') entry.pending++;
      if (task.status === 'claimed') entry.claimed++;
      map.set(key, entry);
    }
    return Array.from(map.entries())
      .map(([userId, counts]) => ({
        label: userId === '__unassigned__' ? 'Unassigned' : userId,
        isUnassigned: userId === '__unassigned__',
        ...counts,
        total: counts.pending + counts.claimed,
      }))
      .sort((a, b) => b.total - a.total);
  }, [tasks]);

  const overdueTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.deadline !== null && new Date(t.deadline!) < new Date())
        .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime()),
    [tasks],
  );

  const summaryCards = [
    {
      label: 'Open tasks',
      value: summary.total,
      color: summary.total > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
    },
    {
      label: 'Pending (queue)',
      value: summary.pending,
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Claimed',
      value: summary.claimed,
      color: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: 'Unassigned',
      value: summary.unassigned,
      color: summary.unassigned > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg border bg-muted animate-pulse" />
          ))}
        </div>
        <div className="h-40 rounded-lg border bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {summaryCards.map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border bg-card p-4 space-y-1">
            <div className={cn('text-3xl font-bold font-headline', color)}>{value}</div>
            <div className="text-sm text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* By role */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            By role
          </h2>
          {roleCounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Role</th>
                    <th className="px-4 py-2 text-right font-medium">Pending</th>
                    <th className="px-4 py-2 text-right font-medium">Claimed</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {roleCounts.map((row) => (
                    <tr key={row.role} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium">{row.role}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-blue-600 dark:text-blue-400">
                        {row.pending || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-violet-600 dark:text-violet-400">
                        {row.claimed || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* By assignee */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            By assignee
          </h2>
          {byAssignee.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Assignee</th>
                    <th className="px-4 py-2 text-right font-medium">Pending</th>
                    <th className="px-4 py-2 text-right font-medium">Claimed</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {byAssignee.map((row) => (
                    <tr key={row.label} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            'font-medium',
                            row.isUnassigned && 'text-red-600 dark:text-red-400 italic',
                          )}
                        >
                          {row.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-blue-600 dark:text-blue-400">
                        {row.pending || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-violet-600 dark:text-violet-400">
                        {row.claimed || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                        {row.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Overdue tasks */}
      {overdueTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Overdue tasks
          </h2>
          <div className="space-y-2">
            {overdueTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-md border bg-card px-4 py-3 flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-medium text-sm">{task.stepId}</div>
                  <div className="text-xs text-muted-foreground">
                    Role: {task.assignedRole} ·{' '}
                    {task.assignedUserId ? `Claimed by ${task.assignedUserId}` : 'Unassigned'}
                  </div>
                </div>
                <div className="text-xs text-red-600 dark:text-red-400 font-medium shrink-0">
                  Overdue {formatDistanceToNow(new Date(task.deadline!), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
