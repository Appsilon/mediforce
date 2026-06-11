'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckSquare, X, Loader2, AlertTriangle, EyeOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProcessNameMap } from '@/hooks/use-agent-runs';
import { useUserDisplayNames } from '@/hooks/use-users';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import {
  type ActionItem,
  getActionType,
  getItemLabel,
  getItemId,
  getItemProcessInstanceId,
  getItemCreatedAt,
  getItemAssignedUserId,
  getItemDeadline,
  isItemCompleted,
} from './action-type';
import { formatStepName } from './task-utils';

export type GroupByField = 'process' | 'action';

function formatDeadline(deadline: string | null): { text: string; overdue: boolean } | null {
  if (!deadline) return null;
  const date = new Date(deadline);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, overdue: true };
  if (diffDays === 0) return { text: 'Today', overdue: false };
  if (diffDays === 1) return { text: 'Tomorrow', overdue: false };
  if (diffDays <= 7) return { text: `in ${diffDays}d`, overdue: false };
  return { text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false };
}

function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sortItems(items: ActionItem[], currentUserId: string): ActionItem[] {
  return [...items].sort((a, b) => {
    const aOwn = a.kind === 'task' && a.data.status === 'claimed' && a.data.assignedUserId === currentUserId;
    const bOwn = b.kind === 'task' && b.data.status === 'claimed' && b.data.assignedUserId === currentUserId;
    if (aOwn !== bOwn) return aOwn ? -1 : 1;

    const aDone = isItemCompleted(a);
    const bDone = isItemCompleted(b);
    if (aDone !== bDone) return aDone ? 1 : -1;

    const da = getItemDeadline(a) ?? '';
    const db = getItemDeadline(b) ?? '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    return getItemCreatedAt(a).localeCompare(getItemCreatedAt(b));
  });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
  return parts[0]!.slice(0, 2).toUpperCase();
}

function getItemDescription(item: ActionItem): string | null {
  if (item.kind !== 'task') return null;
  return item.data.params?.[0]?.description ?? null;
}

function getStatusInfo(item: ActionItem): { label: string; className: string } {
  if (item.kind === 'cowork') {
    return item.data.status === 'finalized'
      ? { label: 'Finalized', className: 'bg-green-500/10 text-green-700 dark:text-green-400' }
      : { label: 'Active', className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' };
  }
  switch (item.data.status) {
    case 'completed':
      return { label: 'Completed', className: 'bg-green-500/10 text-green-700 dark:text-green-400' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-red-500/10 text-red-700 dark:text-red-400' };
    case 'claimed':
      return { label: 'Claimed', className: 'bg-primary/10 text-primary' };
    case 'pending':
      return { label: 'Pending', className: 'bg-muted text-muted-foreground' };
  }
}

// --- Indeterminate checkbox ---

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
    />
  );
}

// --- Table primitives ---

function TH({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border bg-muted/30',
        className,
      )}
    >
      {children}
    </th>
  );
}

function TD({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={cn('px-3 py-2 text-sm border-b border-border/40 align-middle', className)}>
      {children}
    </td>
  );
}

// --- Task row ---

function TaskRow({
  item,
  selected,
  onToggle,
  currentUserId,
  currentUserName,
  userNames,
  processNameMap,
  showWorkflow,
}: {
  item: ActionItem;
  selected: boolean;
  onToggle: (id: string) => void;
  currentUserId: string;
  currentUserName?: string | null;
  userNames: Map<string, string>;
  processNameMap: Map<string, string>;
  showWorkflow: boolean;
}) {
  const handle = useHandleFromPath();
  const actionType = getActionType(item);
  const ActionIcon = actionType.icon;
  const deadline = formatDeadline(getItemDeadline(item));
  const assignedUserId = getItemAssignedUserId(item);
  const isCurrentUser = assignedUserId === currentUserId;
  const assigneeName = assignedUserId
    ? isCurrentUser
      ? (currentUserName ?? 'Me')
      : (userNames.get(assignedUserId) ?? null)
    : null;
  const description = getItemDescription(item);
  const muted = isItemCompleted(item);
  const instanceId = getItemProcessInstanceId(item);
  const workflowName = processNameMap.get(instanceId);
  const status = getStatusInfo(item);

  const definitionName = item.kind === 'task' ? workflowName : undefined;
  const taskHref =
    item.kind === 'cowork'
      ? routes.cowork(handle, item.data.id)
      : definitionName !== undefined
        ? routes.workflowRunStep(handle, definitionName, instanceId, item.data.stepId)
        : routes.task(handle, item.data.id);

  const workflowHref = workflowName ? routes.workflow(handle, workflowName) : null;
  const runHref = workflowName ? routes.workflowRun(handle, workflowName, instanceId) : null;

  return (
    <tr className={cn('transition-colors', selected ? 'bg-primary/5' : 'hover:bg-muted/20', muted && 'opacity-60')}>
      <TD className="w-10">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(getItemId(item))}
          className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
        />
      </TD>
      <TD className="min-w-[200px] max-w-[300px]">
        <Link
          href={taskHref}
          className="flex items-center gap-2 group/link hover:text-primary transition-colors"
        >
          <ActionIcon className={cn('h-3.5 w-3.5 shrink-0', actionType.colorClass)} />
          <span className="truncate font-medium group-hover/link:underline">
            {getItemLabel(item)}
          </span>
        </Link>
      </TD>
      <TD className="w-[100px]">
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', status.className)}>
          {status.label}
        </span>
      </TD>
      <TD className="max-w-[220px] hidden md:table-cell">
        {description ? (
          <span className="text-muted-foreground truncate block text-xs">{description}</span>
        ) : (
          <span className="text-muted-foreground/30">—</span>
        )}
      </TD>
      {showWorkflow && (
        <TD className="max-w-[180px] hidden lg:table-cell">
          {workflowHref ? (
            <Link
              href={workflowHref}
              className="text-muted-foreground hover:text-foreground hover:underline truncate block transition-colors"
            >
              {formatStepName(workflowName!)}
            </Link>
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          )}
        </TD>
      )}
      <TD className="w-[100px]">
        {runHref ? (
          <Link
            href={runHref}
            className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
          >
            {instanceId.slice(0, 8)}
          </Link>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">{instanceId.slice(0, 8)}</span>
        )}
      </TD>
      <TD className="w-[180px]">
        {assigneeName ? (
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0',
                isCurrentUser
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted-foreground/20 text-muted-foreground',
              )}
              title={assigneeName}
            >
              {getInitials(assigneeName)}
            </span>
            <span className="truncate text-sm">{assigneeName}</span>
          </div>
        ) : (
          <span className="text-muted-foreground/40 text-xs">Unassigned</span>
        )}
      </TD>
      <TD className="w-[110px] text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {formatAbsoluteDate(getItemCreatedAt(item))}
      </TD>
      <TD className="w-[110px] text-xs tabular-nums whitespace-nowrap">
        {deadline ? (
          <span className={deadline.overdue ? 'text-red-500 dark:text-red-400 font-medium' : 'text-muted-foreground'}>
            {deadline.text}
          </span>
        ) : (
          <span className="text-muted-foreground/30">—</span>
        )}
      </TD>
    </tr>
  );
}

// --- Table ---

interface TaskTableProps {
  items: ActionItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
  currentUserId: string;
  currentUserName?: string | null;
  userNames: Map<string, string>;
  processNameMap: Map<string, string>;
  showWorkflow: boolean;
}

function TaskTable({
  items,
  selectedIds,
  onToggle,
  onToggleAll,
  currentUserId,
  currentUserName,
  userNames,
  processNameMap,
  showWorkflow,
}: TaskTableProps) {
  const ids = items.map(getItemId);
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && ids.some((id) => selectedIds.has(id));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full table-auto border-collapse">
        <thead>
          <tr>
            <TH className="w-10">
              <IndeterminateCheckbox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={(e) => onToggleAll(ids, e.target.checked)}
              />
            </TH>
            <TH>Task</TH>
            <TH className="w-[100px]">Status</TH>
            <TH className="hidden md:table-cell">Description</TH>
            {showWorkflow && <TH className="hidden lg:table-cell">Workflow</TH>}
            <TH>Run ID</TH>
            <TH>Assignee</TH>
            <TH>Created</TH>
            <TH>Deadline</TH>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <TaskRow
              key={getItemId(item)}
              item={item}
              selected={selectedIds.has(getItemId(item))}
              onToggle={onToggle}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              userNames={userNames}
              processNameMap={processNameMap}
              showWorkflow={showWorkflow}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Section header for grouped view ---

function SectionHeader({ title, count, icon }: { title: string; count: number; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-5 pb-2 first:pt-0">
      {icon}
      <h3 className="font-semibold text-base">{title}</h3>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground font-medium">
        {count} {count === 1 ? 'item' : 'items'}
      </span>
    </div>
  );
}

// --- Bulk action toolbar ---

function BulkActionBar({
  selectedCount,
  onCancelRuns,
  onClear,
  loading,
}: {
  selectedCount: number;
  onCancelRuns: () => void;
  onClear: () => void;
  loading: boolean;
}) {
  return (
    <div className="sticky top-2 z-10 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-md">
      <button
        onClick={onClear}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        <span>{selectedCount} selected</span>
      </button>
      <div className="h-4 w-px bg-border" />
      <button
        onClick={onCancelRuns}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
        Cancel {selectedCount === 1 ? 'run' : 'runs'}
      </button>
    </div>
  );
}

// --- Loading & empty states ---

function LoadingSkeleton() {
  return (
    <div className="rounded-lg border border-border overflow-hidden animate-pulse">
      <div className="bg-muted/30 border-b border-border px-3 py-2.5 flex gap-6">
        {[40, 180, 80, 140, 90, 130, 100, 90].map((w, i) => (
          <div key={i} className="h-3 bg-muted rounded" style={{ width: w }} />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5 border-b border-border/40 last:border-b-0">
          <div className="h-4 w-4 rounded bg-muted shrink-0" />
          <div className="h-4 bg-muted rounded flex-1 max-w-[200px]" />
          <div className="h-5 bg-muted rounded-full w-16" />
          <div className="h-3 bg-muted rounded w-32 hidden md:block" />
          <div className="h-3 bg-muted rounded w-24 hidden lg:block" />
          <div className="h-3 bg-muted rounded w-16" />
          <div className="h-6 w-6 rounded-full bg-muted shrink-0" />
          <div className="h-3 bg-muted rounded w-20" />
          <div className="h-3 bg-muted rounded w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-card py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <CheckSquare className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium text-sm">All caught up</p>
        <p className="text-sm text-muted-foreground mt-0.5">No tasks assigned to your role</p>
      </div>
    </div>
  );
}

// --- Main component ---

export function TaskGroupedView({
  activeItems,
  completedItems,
  loading,
  currentUserId,
  currentUserName,
  groupByFields,
}: {
  activeItems: ActionItem[];
  completedItems: ActionItem[];
  loading: boolean;
  currentUserId: string;
  currentUserName?: string | null;
  groupByFields: Set<GroupByField>;
}) {
  const handle = useHandleFromPath();
  const processNameMap = useProcessNameMap(handle);
  const userNames = useUserDisplayNames(handle);
  const qc = useQueryClient();
  const groupByProcess = groupByFields.has('process');
  const groupByAction = groupByFields.has('action');

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = React.useState(false);
  const [hideCompleted, setHideCompleted] = React.useState(false);

  const visibleCompleted = hideCompleted ? [] : completedItems;

  const allItems = React.useMemo(
    () => sortItems([...activeItems, ...visibleCompleted], currentUserId),
    [activeItems, visibleCompleted, currentUserId],
  );

  const itemById = React.useMemo(() => {
    const m = new Map<string, ActionItem>();
    for (const item of allItems) m.set(getItemId(item), item);
    return m;
  }, [allItems]);

  const toggleItem = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback((ids: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const handleCancelRuns = React.useCallback(async () => {
    const runIds = new Set<string>();
    for (const id of selectedIds) {
      const item = itemById.get(id);
      if (item) runIds.add(getItemProcessInstanceId(item));
    }
    setCancelling(true);
    try {
      await Promise.all([...runIds].map((runId) => mediforce.runs.cancel({ runId })));
      setSelectedIds(new Set());
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.tasks.all() }),
        qc.invalidateQueries({ queryKey: queryKeys.runs.all() }),
      ]);
    } finally {
      setCancelling(false);
    }
  }, [selectedIds, itemById, qc]);

  const sharedTableProps: Omit<TaskTableProps, 'items' | 'showWorkflow'> = {
    selectedIds,
    onToggle: toggleItem,
    onToggleAll: toggleAll,
    currentUserId,
    currentUserName,
    userNames,
    processNameMap,
  };

  if (loading) return <LoadingSkeleton />;

  const totalItems = activeItems.length + completedItems.length;
  if (totalItems === 0) return <EmptyState />;

  let tableContent: React.ReactNode;

  if (groupByProcess) {
    const byDef = new Map<string, ActionItem[]>();
    for (const item of allItems) {
      const instanceId = getItemProcessInstanceId(item);
      const name = processNameMap.get(instanceId) ?? instanceId.slice(0, 8);
      const group = byDef.get(name) ?? [];
      group.push(item);
      byDef.set(name, group);
    }

    const activeSet = new Set(activeItems.map(getItemId));
    const groups = [...byDef.entries()].sort(
      ([, a], [, b]) =>
        b.filter((i) => activeSet.has(getItemId(i))).length -
        a.filter((i) => activeSet.has(getItemId(i))).length,
    );

    tableContent = groups.length === 0
      ? <EmptyState />
      : groups.map(([name, items]) => (
          <div key={name}>
            <SectionHeader title={formatStepName(name)} count={items.length} />
            <TaskTable items={items} {...sharedTableProps} showWorkflow={false} />
          </div>
        ));
  } else if (groupByAction) {
    const byAction = new Map<string, ActionItem[]>();
    for (const item of allItems) {
      const action = getActionType(item);
      const group = byAction.get(action.type) ?? [];
      group.push(item);
      byAction.set(action.type, group);
    }

    const groups = [...byAction.entries()].sort(([, a], [, b]) => b.length - a.length);

    tableContent = groups.length === 0
      ? <EmptyState />
      : groups.map(([type, items]) => {
          const actionInfo = getActionType(items[0]!);
          const Icon = actionInfo.icon;
          return (
            <div key={type}>
              <SectionHeader
                title={actionInfo.label}
                count={items.length}
                icon={<Icon className={cn('h-4 w-4', actionInfo.colorClass)} />}
              />
              <TaskTable items={items} {...sharedTableProps} showWorkflow />
            </div>
          );
        });
  } else {
    tableContent = allItems.length === 0
      ? <EmptyState />
      : <TaskTable items={allItems} {...sharedTableProps} showWorkflow />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        {selectedIds.size > 0 ? (
          <BulkActionBar
            selectedCount={selectedIds.size}
            onCancelRuns={handleCancelRuns}
            onClear={() => setSelectedIds(new Set())}
            loading={cancelling}
          />
        ) : (
          <div />
        )}
        {completedItems.length > 0 && (
          <button
            onClick={() => setHideCompleted((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors',
              hideCompleted
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {hideCompleted ? `Showing active only (${completedItems.length} hidden)` : 'Hide completed'}
          </button>
        )}
      </div>
      {tableContent}
    </div>
  );
}
