'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronUp, ChevronDown, ExternalLink, Archive, ArchiveRestore, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { ProcessInstance } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { useUserProfiles } from '@/hooks/use-users';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { UserProfileLink } from '@/components/user-profile-link';
import { routes } from '@/lib/routes';
import { ApiError } from '@/lib/mediforce';
import type { BulkRunOutput } from '@mediforce/platform-api/contract';
import { getWorkflowStatus } from '@/lib/workflow-status';
import { formatCostUsd } from '@/lib/format';
import { useToast } from '@/components/command-palette/toast-provider';
import {
  useArchiveRun,
  useBulkArchiveRuns,
  useBulkCancelRuns,
} from '@/hooks/use-run-mutations';

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
  /** True when the server has more rows beyond `runs` — shows the "Load
   *  more" footer. Omit (or false) to hide it entirely (e.g. a fully-loaded
   *  small table with no pagination source). */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

type SortField = 'cost' | 'started' | null;

/** Nulls (unknown cost) always sort last regardless of direction — a
 *  reasonable convention, and avoids "no data" jumping to the top on desc. */
function compareRuns(a: ProcessInstance, b: ProcessInstance, field: SortField, dir: 1 | -1): number {
  if (field === 'cost') {
    const av = a.totalCostUsd;
    const bv = b.totalCostUsd;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  }
  if (field === 'started') {
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
  }
  return 0;
}

function isCancellable(run: ProcessInstance): boolean {
  const { displayStatus } = getWorkflowStatus(run);
  return displayStatus === 'in_progress' || displayStatus === 'waiting_for_human';
}

function isArchivable(run: ProcessInstance): boolean {
  const { displayStatus } = getWorkflowStatus(run);
  return (displayStatus === 'completed' || displayStatus === 'error' || displayStatus === 'cancelled') && run.archived !== true;
}

export function RunsTable({
  runs,
  loading,
  showProcess = false,
  runHref,
  emptyMessage = 'No runs found.',
  activeTaskByInstance,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: RunsTableProps) {
  const handle = useHandleFromPath();
  const { toast } = useToast();
  const userProfiles = useUserProfiles(handle);
  const archiveMutation = useArchiveRun();
  const bulkCancelMutation = useBulkCancelRuns();
  const bulkArchiveMutation = useBulkArchiveRuns();
  const [archivingIds, setArchivingIds] = React.useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [sortField, setSortField] = React.useState<SortField>(null);
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc');
  const bulkCancelling = bulkCancelMutation.isPending;
  const bulkArchiving = bulkArchiveMutation.isPending;
  const selectAllRef = React.useRef<HTMLInputElement>(null);
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = React.useState(0);

  // Measure toolbar height so <thead> can offset its sticky top accordingly
  React.useLayoutEffect(() => {
    setToolbarHeight(toolbarRef.current?.offsetHeight ?? 0);
  }, [selectedIds.size]);

  // Prune selected IDs when the run list changes (e.g. archived runs hidden after action)
  React.useEffect(() => {
    const runIds = new Set(runs.map((r) => r.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => runIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [runs]);

  // Drive select-all checkbox indeterminate state — not expressible as a React prop
  React.useEffect(() => {
    if (!selectAllRef.current) return;
    const allSelected = runs.length > 0 && runs.every((r) => selectedIds.has(r.id));
    const someSelected = runs.some((r) => selectedIds.has(r.id));
    selectAllRef.current.checked = allSelected;
    selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [selectedIds, runs]);

  const sortedRuns = React.useMemo(() => {
    if (sortField === null) return runs;
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...runs].sort((a, b) => compareRuns(a, b, sortField, dir));
  }, [runs, sortField, sortDirection]);

  function handleSort(field: 'cost' | 'started') {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  }

  function toggleAll() {
    if (runs.every((r) => selectedIds.has(r.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(runs.map((r) => r.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleArchive(run: ProcessInstance) {
    const newArchived = run.archived !== true;
    setArchivingIds((prev) => new Set(prev).add(run.id));
    try {
      await archiveMutation.mutateAsync({ runId: run.id, archived: newArchived });
    } catch (err) {
      const message = err instanceof ApiError ? err.message
        : err instanceof Error ? err.message : 'Archive failed';
      toast({ title: 'Archive failed', description: message, variant: 'error' });
    } finally {
      setArchivingIds((prev) => {
        const next = new Set(prev);
        next.delete(run.id);
        return next;
      });
    }
  }

  const cancellableSelected = runs.filter((r) => selectedIds.has(r.id) && isCancellable(r));
  const archivableSelected = runs.filter((r) => selectedIds.has(r.id) && isArchivable(r));

  function reportBulkResult(result: BulkRunOutput, action: string) {
    const failed = result.results.filter((r) => r.status === 'error');
    if (failed.length > 0) {
      toast({
        title: `${failed.length} run(s) failed to ${action}`,
        description: failed.map((f) => f.error ?? 'Unknown error').join('; '),
        variant: 'error',
      });
    }
  }

  async function handleBulkCancel() {
    try {
      const result = await bulkCancelMutation.mutateAsync({
        runIds: cancellableSelected.map((r) => r.id),
      });
      reportBulkResult(result, 'cancel');
    } catch (err) {
      const message = err instanceof ApiError ? err.message
        : err instanceof Error ? err.message : 'Bulk cancel failed';
      toast({ title: 'Bulk cancel failed', description: message, variant: 'error' });
    }
  }

  async function handleBulkArchive() {
    try {
      const result = await bulkArchiveMutation.mutateAsync({
        runIds: archivableSelected.map((r) => r.id),
      });
      reportBulkResult(result, 'archive');
    } catch (err) {
      const message = err instanceof ApiError ? err.message
        : err instanceof Error ? err.message : 'Bulk archive failed';
      toast({ title: 'Bulk archive failed', description: message, variant: 'error' });
    }
  }

  const effectiveRunHref = runHref ?? ((run: ProcessInstance) =>
    `/${handle}/workflows/${encodeURIComponent(run.definitionName)}/runs/${run.id}`
  );

  const dataHeaders: Array<{ label: string; sortField?: 'cost' | 'started' }> = [
    ...(showProcess ? [{ label: 'Workflow' }] : []),
    { label: 'Version' },
    { label: 'Status' },
    { label: 'Started by' },
    { label: 'Current Step' },
    { label: 'Cost', sortField: 'cost' },
    { label: 'Started', sortField: 'started' },
    { label: '' }, // per-row archive
    { label: '' }, // view link
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

  const anyBulkBusy = bulkCancelling || bulkArchiving;

  return (
    <div className="rounded-md border overflow-clip">
      {/* Bulk action toolbar — visible only when rows are selected */}
      {selectedIds.size > 0 && (
        <div ref={toolbarRef} className="sticky top-0 z-20 flex items-center gap-3 px-4 py-2 bg-background border-b text-sm">
          <span className="text-xs text-muted-foreground font-medium">
            {selectedIds.size} selected
          </span>
          <button
            onClick={handleBulkCancel}
            disabled={cancellableSelected.length === 0 || anyBulkBusy}
            title={cancellableSelected.length === 0 ? 'No selected runs can be cancelled' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border border-destructive text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <XCircle className="h-3.5 w-3.5" />
            {bulkCancelling
              ? 'Cancelling…'
              : `Cancel${cancellableSelected.length > 0 ? ` (${cancellableSelected.length})` : ''}`}
          </button>
          <button
            onClick={handleBulkArchive}
            disabled={archivableSelected.length === 0 || anyBulkBusy}
            title={archivableSelected.length === 0 ? 'No selected runs can be archived' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Archive className="h-3.5 w-3.5" />
            {bulkArchiving
              ? 'Archiving…'
              : `Archive${archivableSelected.length > 0 ? ` (${archivableSelected.length})` : ''}`}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={anyBulkBusy}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            Deselect all
          </button>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="sticky z-10 bg-card" style={{ top: toolbarHeight }}>
          <tr className="border-b bg-muted text-xs text-muted-foreground">
            <th className="px-4 py-2.5 w-8">
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Select all runs"
                onChange={toggleAll}
                className="rounded border-border cursor-pointer"
              />
            </th>
            {dataHeaders.map((h, i) => (
              <th key={i} className="px-4 py-2.5 text-left font-medium">
                {h.sortField ? (
                  <button
                    onClick={() => handleSort(h.sortField!)}
                    className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                  >
                    {h.label}
                    {sortField === h.sortField ? (
                      sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3 opacity-30" />
                    )}
                  </button>
                ) : h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRuns.map((run) => {
            const isSelected = selectedIds.has(run.id);
            return (
              <tr
                key={run.id}
                data-run-id={run.id}
                className={`border-b last:border-0 transition-colors ${
                  isSelected ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-muted/30'
                }`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(run.id)}
                    aria-label={`Select run ${run.id.slice(0, 8)}`}
                    className="rounded border-border cursor-pointer"
                  />
                </td>
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
                  <ProcessStatusBadge status={run.status} pauseReason={run.pauseReason} error={run.error} dryRun={run.dryRun} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {run.parentInstanceId && run.parentDefinitionName ? (
                    <Link
                      href={`/${handle}/workflows/${encodeURIComponent(run.parentDefinitionName)}/runs/${run.parentInstanceId}`}
                      className="text-primary hover:underline"
                    >
                      {run.parentDefinitionName}
                    </Link>
                  ) : run.createdBy ? (
                    <UserProfileLink
                      displayName={userProfiles.get(run.createdBy)?.displayName ?? run.createdBy}
                      personalHandle={userProfiles.get(run.createdBy)?.personalHandle}
                    />
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-xs">
                  {run.currentStepId ? (
                    activeTaskByInstance?.get(run.id) ? (
                      <Link
                        href={routes.workflowRunStep(handle, run.definitionName, run.id, run.currentStepId)}
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
                <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums">
                  {run.totalCostUsd != null ? `${formatCostUsd(run.totalCostUsd)}${run.status !== 'completed' && run.status !== 'failed' ? '+' : ''}` : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
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
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="flex justify-center border-t py-3">
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
