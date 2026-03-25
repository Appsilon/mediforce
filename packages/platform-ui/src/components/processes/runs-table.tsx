'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ProcessInstance } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { useUserDisplayNames } from '@/hooks/use-users';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';

interface RunsTableProps {
  runs: ProcessInstance[];
  loading: boolean;
  /** When true, shows a "Process" column (for cross-process views). */
  showProcess?: boolean;
  /** Build the href for the "View" link. Defaults to process-scoped route. */
  runHref?: (run: ProcessInstance) => string;
  emptyMessage?: string;
}

export function RunsTable({
  runs,
  loading,
  showProcess = false,
  runHref,
  emptyMessage = 'No runs found.',
}: RunsTableProps) {
  const handle = useHandleFromPath();
  const userNames = useUserDisplayNames();
  const effectiveRunHref = runHref ?? ((run: ProcessInstance) =>
    `/${handle}/workflows/${encodeURIComponent(run.definitionName)}/runs/${run.id}`
  );
  const headers = [
    ...(showProcess ? ['Workflow'] : []),
    'Run ID',
    'Version',
    'Status',
    'Started by',
    'Current Step',
    'Started',
    '', // View link
  ];

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b last:border-0 hover:bg-muted/30 transition-colors"
            >
              {showProcess && (
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/${handle}/workflows/${encodeURIComponent(run.definitionName)}`}
                    className="hover:underline text-primary"
                  >
                    {run.definitionName}
                  </Link>
                </td>
              )}
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {run.id.slice(0, 8)}&hellip;
              </td>
              <td className="px-4 py-3 font-mono text-xs">
                <span title="Definition version">v{run.definitionVersion}</span>
                {run.configName && (
                  <span className="text-muted-foreground">
                    {' / '}
                    <span title="Config">{run.configName} v{run.configVersion}</span>
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <ProcessStatusBadge status={run.status} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {run.createdBy ? (userNames.get(run.createdBy) ?? run.createdBy.slice(0, 8)) : '—'}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {run.currentStepId ?? '—'}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(run.createdAt), {
                  addSuffix: true,
                })}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={effectiveRunHref(run)}
                  className="text-primary hover:underline inline-flex items-center gap-0.5 text-xs"
                >
                  View <ChevronRight className="h-3 w-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
