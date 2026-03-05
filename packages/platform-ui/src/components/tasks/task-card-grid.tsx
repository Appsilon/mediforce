'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import type { HumanTask } from '@mediforce/platform-core';
import { ClaimButton } from './claim-button';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

export function TaskCardGrid({
  tasks,
  loading,
  currentUserId,
}: {
  tasks: HumanTask[];
  loading: boolean;
  currentUserId: string;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-3 animate-pulse">
            <div className="h-4 rounded bg-muted w-3/4" />
            <div className="h-3 rounded bg-muted w-1/2" />
            <div className="h-3 rounded bg-muted w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No tasks assigned to your role
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task) => (
        <div key={task.id} className="rounded-lg border bg-card p-4 space-y-3 hover:border-primary/50 transition-colors">
          <div className="flex items-start justify-between gap-2">
            <Link href={`/tasks/${task.id}`} className="font-medium text-sm hover:text-primary transition-colors line-clamp-2">
              {task.stepId}
            </Link>
            <span className={cn('shrink-0 inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[task.status] ?? STATUS_STYLES.pending)}>
              {task.status}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{task.assignedRole}</div>
          {task.deadline && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {format(new Date(task.deadline), 'MMM d, yyyy')}
            </div>
          )}
          {task.status === 'pending' && (
            <div className="pt-1">
              <ClaimButton taskId={task.id} currentUserId={currentUserId} fullWidth />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
