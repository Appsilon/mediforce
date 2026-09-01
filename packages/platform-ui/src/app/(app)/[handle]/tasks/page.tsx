'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal, Check, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useAllUserNamespaces } from '@/hooks/use-all-user-namespaces';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useViewerIdentity } from '@/hooks/use-viewer-identity';
import {
  useMyActionableTasks,
  useMyCompletedTasks,
  useMyCoworkSessions,
  useFinalizedCoworkSessions,
} from '@/hooks/use-tasks';
import { TaskGroupedView, type GroupByField } from '@/components/tasks/task-grouped-view';
import type { ActionItem } from '@/components/tasks/action-type';
import { cn } from '@/lib/utils';

const GROUP_FIELDS: { value: GroupByField; label: string }[] = [
  { value: 'process', label: 'Workflow' },
  { value: 'action', label: 'Action' },
];

function DisplayPopover({
  activeFields,
  onToggle,
}: {
  activeFields: Set<GroupByField>;
  onToggle: (field: GroupByField) => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Display
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-48 rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Group by
            </span>
          </div>
          {GROUP_FIELDS.map((field) => {
            const isActive = activeFields.has(field.value);
            return (
              <button
                key={field.value}
                onClick={() => onToggle(field.value)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm',
                  'hover:bg-accent hover:text-accent-foreground transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {field.label}
                {isActive && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The escape hatch that makes the narrowed default a choice rather than a
 * silent regression (AGENTS.md §12, issue #1251): the unfiltered workspace view
 * someone sees today stays one click away.
 */
function ScopeToggle({
  mineOnly,
  onChange,
}: {
  mineOnly: boolean;
  onChange: (mineOnly: boolean) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-sm">
      {[
        { mine: true, label: 'For me' },
        { mine: false, label: 'All in workspace' },
      ].map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={mineOnly === option.mine}
          onClick={() => onChange(option.mine)}
          className={cn(
            'rounded px-2.5 py-1 transition-colors',
            mineOnly === option.mine
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Which workspaces the inbox is asking about (issue #1251 follow-up).
 *
 * Opens on the workspace in the URL, because that is the one the reader
 * navigated to. A member can widen to any set of the workspaces they belong
 * to, or to all of them — the rows carry their own workspace to their links,
 * so a widened inbox stays clickable.
 *
 * `null` means every workspace: the caller-scope axis with no `namespace` at
 * all, which is what the endpoint answered before it was scoped. Kept distinct
 * from "each workspace ticked" so the selection survives joining a new one.
 */
export type WorkspaceSelection = ReadonlySet<string> | null;

function WorkspaceFilter({
  workspaces,
  selection,
  onChange,
}: {
  workspaces: { handle: string; displayName: string }[];
  selection: WorkspaceSelection;
  onChange: (next: WorkspaceSelection) => void;
}) {
  const label =
    selection === null
      ? 'All workspaces'
      : selection.size === 1
        ? workspaces.find((w) => selection.has(w.handle))?.displayName ??
          [...selection][0] ??
          '1 workspace'
        : `${selection.size} workspaces`;

  function toggle(handle: string): void {
    // A selection of nothing has no meaning the server can answer — the axis
    // needs at least one workspace — so unticking the last one is inert.
    const current = selection === null ? new Set(workspaces.map((w) => w.handle)) : new Set(selection);
    if (current.has(handle)) {
      if (current.size === 1) return;
      current.delete(handle);
    } else {
      current.add(handle);
    }
    onChange(current);
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Filter by workspace"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
        )}
      >
        <Building2 className="h-3.5 w-3.5" />
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-50 w-60 rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <button
            type="button"
            aria-pressed={selection === null}
            onClick={() => onChange(null)}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              selection === null ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            All workspaces
            {selection === null && <Check className="h-3.5 w-3.5" />}
          </button>
          <div className="my-1 h-px bg-border" />
          {workspaces.map((workspace) => {
            const checked = selection === null || selection.has(workspace.handle);
            return (
              <button
                key={workspace.handle}
                type="button"
                aria-pressed={checked}
                onClick={() => toggle(workspace.handle)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm',
                  'hover:bg-accent hover:text-accent-foreground transition-colors',
                  checked ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="truncate">{workspace.displayName}</span>
                {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const [groupByFields, setGroupByFields] = React.useState<Set<GroupByField>>(
    () => new Set<GroupByField>(),
  );

  const toggleField = React.useCallback((field: GroupByField) => {
    setGroupByFields((prev) => {
      if (prev.has(field)) return new Set<GroupByField>();
      return new Set<GroupByField>([field]);
    });
  }, []);

  const { role } = useViewerIdentity();
  const handle = useHandleFromPath();
  const { namespaces: memberships } = useAllUserNamespaces();
  const workspaces = React.useMemo(
    () =>
      memberships.map((membership) => ({
        handle: membership.handle,
        displayName: membership.displayName || membership.handle,
      })),
    [memberships],
  );

  const [selection, setSelection] = React.useState<WorkspaceSelection>(() => new Set([handle]));
  // Navigating between two workspaces keeps this page mounted, so the default
  // has to follow the URL rather than only being seeded on first render.
  React.useEffect(() => {
    setSelection(new Set([handle]));
  }, [handle]);

  const namespaces = React.useMemo(
    () => (selection === null ? undefined : [...selection]),
    [selection],
  );

  const [mineOnly, setMineOnly] = React.useState(true);
  const { data: activeTasks, loading: activeLoading } = useMyActionableTasks({
    actionable: mineOnly,
    namespaces,
  });
  const { data: completedTasks, loading: completedLoading } = useMyCompletedTasks({
    actionable: mineOnly,
    namespaces,
  });
  const { data: activeCoworkSessions, loading: coworkLoading } = useMyCoworkSessions(
    role,
    namespaces,
  );
  const { data: finalizedCoworkSessions, loading: finalizedLoading } = useFinalizedCoworkSessions(
    role,
    namespaces,
  );
  const currentUserId = user?.id ?? '';

  const activeItems: ActionItem[] = React.useMemo(
    () => [
      ...activeTasks.map((data): ActionItem => ({ kind: 'task', data })),
      ...activeCoworkSessions.map((data): ActionItem => ({ kind: 'cowork', data })),
    ],
    [activeTasks, activeCoworkSessions],
  );

  const completedItems: ActionItem[] = React.useMemo(
    () => [
      ...completedTasks.map((data): ActionItem => ({ kind: 'task', data })),
      ...finalizedCoworkSessions.map((data): ActionItem => ({ kind: 'cowork', data })),
    ],
    [completedTasks, finalizedCoworkSessions],
  );

  const totalItemCount = activeItems.length + completedItems.length;
  const processCount = React.useMemo(() => {
    const ids = new Set([
      ...activeItems.map((item) => item.data.processInstanceId),
      ...completedItems.map((item) => item.data.processInstanceId),
    ]);
    return ids.size;
  }, [activeItems, completedItems]);

  const loading = activeLoading || completedLoading || coworkLoading || finalizedLoading;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-headline font-semibold">Human actions</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {mineOnly
              ? 'Actions you can take — assigned to you, or open to a role you hold'
              : selection === null
                ? 'Every action in the workspaces you belong to'
                : 'Every action in the selected workspaces'}
          </p>
          {!loading && totalItemCount > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {totalItemCount} {totalItemCount === 1 ? 'item' : 'items'} across {processCount}{' '}
              {processCount === 1 ? 'workflow' : 'workflows'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ScopeToggle mineOnly={mineOnly} onChange={setMineOnly} />
          <WorkspaceFilter
            workspaces={workspaces}
            selection={selection}
            onChange={setSelection}
          />
          <DisplayPopover activeFields={groupByFields} onToggle={toggleField} />
        </div>
      </div>

      <TaskGroupedView
        namespaces={namespaces ?? workspaces.map((workspace) => workspace.handle)}
        activeItems={activeItems}
        completedItems={completedItems}
        loading={loading}
        currentUserId={currentUserId}
        currentUserName={user?.name}
        groupByFields={groupByFields}
      />
    </div>
  );
}
