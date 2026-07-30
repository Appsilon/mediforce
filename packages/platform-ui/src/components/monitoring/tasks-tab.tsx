'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { MonitoringData } from '@/hooks/use-monitoring';
import { useNamespaceAuditEvents, useNamespaceMemberNames } from '@/hooks/use-namespace-audit-events';
import { useProcessNameMap } from '@/hooks/use-agent-runs';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';
import {
  isTaskActivityEvent,
  filterTaskActivity,
  formatTaskEventName,
  taskIdFromEvent,
  taskTitleFromEvent,
} from '@/lib/task-activity-event';
import type { AuditEvent } from '@mediforce/platform-core';

const EVENT_STYLES: Record<string, string> = {
  'task.viewed': 'bg-gray-100 text-gray-800 dark:bg-gray-800/60 dark:text-gray-300',
  'task.claimed': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'task.completed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  'task.attachment_added': 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300',
  'task.attachment_deleted': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

// Fixed order for the filter dropdown — every possible action every time,
// not just whatever happens to appear in this page's current data.
const ALL_TASK_ACTIONS = [
  'task.viewed',
  'task.claimed',
  'task.completed',
  'task.attachment_added',
  'task.attachment_deleted',
];

interface Props {
  data: MonitoringData;
}

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function TasksTab({ data }: Props) {
  const { tasks } = data;
  const handle = useHandleFromPath();
  const { data: events, loading: eventsLoading } = useNamespaceAuditEvents(handle);
  const memberNames = useNamespaceMemberNames(handle);
  const processNames = useProcessNameMap(handle);

  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);

  const overdueTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.deadline !== null && new Date(t.deadline!) < new Date())
        .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime()),
    [tasks],
  );

  const activity = useMemo(() => events.filter(isTaskActivityEvent), [events]);

  // Only actors who actually show up in this workspace's task activity — not
  // every member, most of whom may never have touched a task.
  const actors = useMemo(() => {
    const ids = new Set(activity.map((e) => e.actorId));
    return Array.from(ids).sort((a, b) =>
      (memberNames.get(a) ?? a).localeCompare(memberNames.get(b) ?? b),
    );
  }, [activity, memberNames]);

  const filtered = useMemo(
    () => filterTaskActivity(activity, { actorId: actorFilter, action: actionFilter, fromDate, toDate }),
    [activity, actorFilter, actionFilter, fromDate, toDate],
  );

  const hasFilter = actorFilter !== null || actionFilter !== null || fromDate !== null || toDate !== null;

  return (
    <div className="space-y-8">
      {/* Task activity */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={actorFilter ?? ''}
            onChange={(e) => setActorFilter(e.target.value || null)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">All Users</option>
            {actors.map((actorId) => (
              <option key={actorId} value={actorId}>
                {memberNames.get(actorId) ?? actorId}
              </option>
            ))}
          </select>

          <select
            value={actionFilter ?? ''}
            onChange={(e) => setActionFilter(e.target.value || null)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">All Actions</option>
            {ALL_TASK_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {formatTaskEventName(action)}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="date"
              value={fromDate ?? ''}
              onChange={(e) => setFromDate(e.target.value || null)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              aria-label="From date"
            />
            <span>to</span>
            <input
              type="date"
              value={toDate ?? ''}
              onChange={(e) => setToDate(e.target.value || null)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
              aria-label="To date"
            />
          </div>

          <span className="text-sm text-muted-foreground">
            {hasFilter ? `${filtered.length} of ${activity.length} events` : `${activity.length} events`}
          </span>
        </div>

        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Date & Time', 'Task', 'User', 'Action', 'Workflow'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {eventsLoading
                ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
                : filtered.length === 0
                ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {hasFilter ? 'No events match these filters.' : 'No task activity recorded yet.'}
                    </td>
                  </tr>
                )
                : filtered.map((event: AuditEvent, i) => {
                  const taskId = taskIdFromEvent(event);
                  const workflowName = event.processInstanceId ? processNames.get(event.processInstanceId) : undefined;
                  return (
                    <tr key={`${event.timestamp}-${event.actorId}-${i}`} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(event.timestamp), 'yyyy-MM-dd, HH:mm')}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {taskId ? (
                          <Link href={routes.task(handle, taskId)} className="font-medium text-primary hover:underline">
                            {taskTitleFromEvent(event)}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">no data</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">
                        {memberNames.get(event.actorId) ?? event.actorId}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', EVENT_STYLES[event.action] ?? 'bg-muted text-muted-foreground')}>
                          {formatTaskEventName(event.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {event.processInstanceId && workflowName ? (
                          <Link
                            href={routes.workflowRun(handle, workflowName, event.processInstanceId)}
                            className="font-medium text-primary hover:underline"
                          >
                            {workflowName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">no data</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
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
