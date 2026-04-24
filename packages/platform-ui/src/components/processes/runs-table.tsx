'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, ExternalLink, Archive, ArchiveRestore } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ProcessInstance } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { useUserDisplayNames } from '@/hooks/use-users';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';
import { archiveProcessRun } from '@/app/actions/processes';
import { getWorkflowStatus } from '@/lib/workflow-status';

interface RunsTableProps {
  runs: ProcessInstance[];
  loading: boolean;
  /** When true, shows a "Process" column (for cross-process views). */
  showProcess?: boolean;
  /** Build the href for the "View" link. Defaults to process-scoped route. */
  runHref?: (run: ProcessInstance) => string;
  emptyMessage?: string;
  /** Map of instanceId → active task ID for direct task links. */
  activeTaskByInstance?: Map<string, string>;
}

export function RunsTable({
  runs,
  loading,
  showProcess = false,
  runHref,
  emptyMessage = 'No runs found.',
  activeTaskByInstance,
}: RunsTableProps) {
  const handle = useHandleFromPath();
  const userNames = useUserDisplayNames();
  const [archivingIds, setArchivingIds] = React.useState<Set<string>>(new Set());

  async function handleArchive(run: ProcessInstance) {
    const newArchived = run.archived !== true;
    setArchivingIds((prev) => new Set(prev).add(run.id));
    await archiveProcessRun(run.id, newArchived);
    setArchivingIds((prev) => {
      const next = new Set(prev);
      next.delete(run.id);
      return next;
    });
  }
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
    '', // Archive action
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
              <td className="px-4 py-3 text-xs">
                {run.currentStepId ? (
                  activeTaskByInstance?.get(run.id) ? (
                    <Link
                      href={routes.task(handle, activeTaskByInstance.get(run.id)!)}
                      className="inline-flex items-center gap-1 bg-muted/50 rounded px-1.5 py-0.5 font-medium cursor-pointer hover:bg-primary/10 hover:text-primary transition-colors"
                    >
                      {run.currentStepId}
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  ) : (
                    <span className="inline-flex bg-muted/50 rounded px-1.5 py-0.5 font-medium text-muted-foreground">
                      {run.currentStepId}
                    </span>
                  )
                ) : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(run.createdAt), {
                  addSuffix: true,
                })}
              </td>
              <td className="px-4 py-3">
                {(() => {
                  const { displayStatus } = getWorkflowStatus(run);
                  const isActive = displayStatus === 'in_progress' || displayStatus === 'waiting_for_human';
                  if (isActive) return null;
                  const isArchiving = archivingIds.has(run.id);
                  const isArchived = run.archived === true;
                  return (
                    <button
                      onClick={() => handleArchive(run)}
                      disabled={isArchiving}
                      title={isArchived ? 'Unarchive run' : 'Archive run'}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {isArchived
                        ? <ArchiveRestore className="h-3.5 w-3.5" />
                        : <Archive className="h-3.5 w-3.5" />}
                    </button>
                  );
                })()}
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
