'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNamespaceAuditEventsPage, useNamespaceMemberNames } from '@/hooks/use-namespace-audit-events';
import { useProcessNameMap } from '@/hooks/use-agent-runs';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { LoadMoreFooter } from '@/components/load-more-footer';
import { USER_ACTIVITY_ACTIONS, formatEventName, formatEventDetails } from '@/lib/user-activity-event';
import type { AuditEvent } from '@mediforce/platform-core';

const EVENT_STYLES: Record<string, string> = {
  'user.signed_in': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'instance.started': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  'instance.cancelled': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  'task.completed': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
};

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
  const [actorFilter, setActorFilter] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);

  const actions = actionFilter !== null ? [actionFilter] : [...USER_ACTIVITY_ACTIONS];
  const { data: events, loading, hasMore, loadingMore, loadMore } = useNamespaceAuditEventsPage({
    namespace: handle,
    actions,
    actorId: actorFilter,
    fromDate,
    toDate,
  });
  const processNames = useProcessNameMap(handle);
  const memberNames = useNamespaceMemberNames(handle);

  // Every workspace member, not just ones with loaded activity — with
  // server-side pagination there's no complete client-side event set to
  // derive "who actually has activity" from.
  const actors = useMemo(
    () =>
      Array.from(memberNames.entries())
        .map(([uid, name]) => ({ uid, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [memberNames],
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
          {actors.map(({ uid, name }) => (
            <option key={uid} value={uid}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={actionFilter ?? ''}
          onChange={(e) => setActionFilter(e.target.value || null)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">All Events</option>
          {USER_ACTIVITY_ACTIONS.map((action) => (
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
          {events.length} events loaded
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
              : events.length === 0
              ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    {hasFilter ? 'No events match these filters.' : 'No user activity recorded yet.'}
                  </td>
                </tr>
              )
              : events.map((event: AuditEvent, i) => (
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
        <LoadMoreFooter hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </div>
    </div>
  );
}
