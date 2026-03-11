'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Eye } from 'lucide-react';
import type { HumanTask } from '@mediforce/platform-core';
import { ClaimButton } from './claim-button';
import { cn } from '@/lib/utils';
import { isAgentReviewTask, getTaskDisplayTitle } from './task-utils';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  claimed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[status] ?? STATUS_STYLES.cancelled)}>
      {status}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function TaskTable({
  tasks,
  loading,
  currentUserId,
}: {
  tasks: HumanTask[];
  loading: boolean;
  currentUserId: string;
}) {
  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Title', 'Process', 'Role', 'Status', 'Deadline', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : tasks.length === 0
            ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No tasks assigned to your role
                </td>
              </tr>
            )
            : tasks.map((task) => (
              <tr key={task.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/tasks/${task.id}`} className="font-medium hover:text-primary transition-colors inline-flex items-center gap-1.5">
                    {isAgentReviewTask(task) && (
                      <Eye className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    )}
                    {getTaskDisplayTitle(task)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{task.processInstanceId.slice(0, 8)}&hellip;</td>
                <td className="px-4 py-3 text-muted-foreground">{task.assignedRole}</td>
                <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                <td className="px-4 py-3 text-muted-foreground text-xs">
                  {task.deadline ? format(new Date(task.deadline), 'MMM d, yyyy') : <span>&mdash;</span>}
                </td>
                <td className="px-4 py-3">
                  {task.status === 'pending' && (
                    <ClaimButton taskId={task.id} currentUserId={currentUserId} />
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
