'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { Eye, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
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

type SortField = 'title' | 'role' | 'status' | 'createdAt' | 'deadline';
type SortDirection = 'asc' | 'desc';

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[status] ?? STATUS_STYLES.cancelled)}>
      {status}
    </span>
  );
}

function SortIcon({ field, activeField, direction }: { field: SortField; activeField: SortField | null; direction: SortDirection }) {
  if (activeField !== field) {
    return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  }
  return direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

function SkeletonRow() {
  return (
    <tr>
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

function sortTasks(tasks: HumanTask[], field: SortField | null, direction: SortDirection): HumanTask[] {
  if (field === null) return tasks;

  return [...tasks].sort((taskA, taskB) => {
    const multiplier = direction === 'asc' ? 1 : -1;

    switch (field) {
      case 'title': {
        const titleA = getTaskDisplayTitle(taskA).toLowerCase();
        const titleB = getTaskDisplayTitle(taskB).toLowerCase();
        return multiplier * titleA.localeCompare(titleB);
      }
      case 'role':
        return multiplier * taskA.assignedRole.localeCompare(taskB.assignedRole);
      case 'status':
        return multiplier * taskA.status.localeCompare(taskB.status);
      case 'createdAt':
        return multiplier * taskA.createdAt.localeCompare(taskB.createdAt);
      case 'deadline': {
        const deadlineA = taskA.deadline ?? '';
        const deadlineB = taskB.deadline ?? '';
        if (deadlineA === '' && deadlineB === '') return 0;
        if (deadlineA === '') return multiplier;
        if (deadlineB === '') return -multiplier;
        return multiplier * deadlineA.localeCompare(deadlineB);
      }
      default:
        return 0;
    }
  });
}

const COLUMNS: { label: string; field: SortField | null }[] = [
  { label: 'Title', field: 'title' },
  { label: 'Process', field: null },
  { label: 'Role', field: 'role' },
  { label: 'Status', field: 'status' },
  { label: 'Created', field: 'createdAt' },
  { label: 'Deadline', field: 'deadline' },
  { label: '', field: null },
];

export function TaskTable({
  tasks,
  loading,
  currentUserId,
}: {
  tasks: HumanTask[];
  loading: boolean;
  currentUserId: string;
}) {
  const [sortField, setSortField] = React.useState<SortField | null>('createdAt');
  const [sortDirection, setSortDirection] = React.useState<SortDirection>('desc');

  function handleSort(field: SortField | null) {
    if (field === null) return;
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  }

  const sortedTasks = React.useMemo(
    () => sortTasks(tasks, sortField, sortDirection),
    [tasks, sortField, sortDirection],
  );

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.label || 'actions'}
                className={cn(
                  'px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide',
                  col.field !== null && 'cursor-pointer select-none hover:text-foreground transition-colors',
                )}
                onClick={() => handleSort(col.field)}
              >
                {col.field !== null ? (
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon field={col.field} activeField={sortField} direction={sortDirection} />
                  </span>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : sortedTasks.length === 0
            ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No tasks assigned to your role
                </td>
              </tr>
            )
            : sortedTasks.map((task) => (
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
                  {format(new Date(task.createdAt), 'MMM d, yyyy HH:mm')}
                </td>
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
