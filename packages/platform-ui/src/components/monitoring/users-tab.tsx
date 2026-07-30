'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNamespaceAuditEvents, useNamespaceMemberNames } from '@/hooks/use-namespace-audit-events';
import { useProcessNameMap } from '@/hooks/use-agent-runs';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import {
  isUserActivityEvent,
  filterUserActivity,
  formatEventName,
  formatEventDetails,
} from '@/lib/user-activity-event';
import type { AuditEvent } from '@mediforce/platform-core';

const EVENT_STYLES: Record<string, string> = {
  'user.signed_in': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'instance.started': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  'instance.cancelled': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  'task.completed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
};

// Fixed order, not derived from whatever happens to appear in this page's
// current data — a user picking the Event filter should see all four
// possible events every time, not just the ones present in today's window.
const ALL_EVENT_ACTIONS = ['user.signed_in', 'instance.started', 'instance.cancelled', 'task.completed'];

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 4 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-muted animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export function UsersTab() {
  const handle = useHandleFromPath();
  const { data: events, loading } = useNamespaceAuditEvents(handle);
  const processNames = useProcessNameMap(handle);
  const memberNames = useNamespaceMemberNames(handle);

  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);

  const activity = useMemo(() => events.filter(isUserActivityEvent), [events]);

  // Only actors who actually show up in this workspace's activity — not
  // every member, most of whom may have never triggered a tracked event.
  const actors = useMemo(() => {
    const ids = new Set(activity.map((e) => e.actorId));
    return Array.from(ids).sort((a, b) =>
      (memberNames.get(a) ?? a).localeCompare(memberNames.get(b) ?? b),
    );
  }, [activity, memberNames]);

  const filtered = useMemo(
    () => filterUserActivity(activity, { actorId: actorFilter, action: actionFilter, fromDate, toDate }),
    [activity, actorFilter, actionFilter, fromDate, toDate],
  );

  const hasFilter = actorFilter !== null || actionFilter !== null || fromDate !== null || toDate !== null;

  return (
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
          <option value="">All Events</option>
          {ALL_EVENT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {formatEventName(action)}
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

      <div className="rounded-md border overflow-clip">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b bg-muted text-xs text-muted-foreground">
              {['Date & Time', 'User', 'Event', 'Details'].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
              : filtered.length === 0
              ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {hasFilter ? 'No events match these filters.' : 'No user activity recorded yet.'}
                  </td>
                </tr>
              )
              : filtered.map((event: AuditEvent, i) => (
                <tr key={`${event.timestamp}-${event.actorId}-${i}`} className="border-b last:border-0 transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(event.timestamp), 'yyyy-MM-dd, HH:mm')}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium">
                    {memberNames.get(event.actorId) ?? event.actorId}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', EVENT_STYLES[event.action] ?? 'bg-muted text-muted-foreground')}>
                      {formatEventName(event.action)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatEventDetails(event, processNames)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
