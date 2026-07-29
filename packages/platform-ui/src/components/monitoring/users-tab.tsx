'use client';

import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNamespaceAuditEvents, useNamespaceMemberNames } from '@/hooks/use-namespace-audit-events';
import { useProcessNameMap } from '@/hooks/use-agent-runs';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import {
  isUserActivityEvent,
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

  const activity = events.filter(isUserActivityEvent);

  return (
    <div className="rounded-md border overflow-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Date & Time', 'User', 'Event', 'Details'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)
            : activity.length === 0
            ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No user activity recorded yet.
                </td>
              </tr>
            )
            : activity.map((event: AuditEvent, i) => (
              <tr key={`${event.timestamp}-${event.actorId}-${i}`} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(event.timestamp), 'MMM d, HH:mm')}
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
  );
}
