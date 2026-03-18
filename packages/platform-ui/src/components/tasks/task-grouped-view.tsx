'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckSquare } from 'lucide-react';
import type { HumanTask } from '@mediforce/platform-core';
import { useProcessNameMap } from '@/hooks/use-agent-runs';
import { useUserDisplayNames } from '@/hooks/use-users';
import { cn } from '@/lib/utils';
import { ClaimButton } from './claim-button';
import { getActionType, getTaskLabel } from './action-type';
import { formatStepName } from './task-utils';

export type GroupByField = 'process' | 'action';

const VISIBLE_TASK_LIMIT = 5;

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const date = new Date(deadline);
  const now = new Date();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `in ${diffDays}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function sortTasksForDisplay(tasks: HumanTask[]): HumanTask[] {
  return [...tasks].sort((taskA, taskB) => {
    const deadlineA = taskA.deadline ?? '';
    const deadlineB = taskB.deadline ?? '';
    if (deadlineA !== deadlineB) {
      if (deadlineA === '' && deadlineB === '') return 0;
      if (deadlineA === '') return 1;
      if (deadlineB === '') return -1;
      return deadlineA.localeCompare(deadlineB);
    }
    return taskA.createdAt.localeCompare(taskB.createdAt);
  });
}

// --- Assignee Avatar ---

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

function AssigneeAvatar({ isCurrentUser, displayName }: { isCurrentUser: boolean; displayName?: string | null }) {
  const initials = displayName ? getInitials(displayName) : '?';
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0',
        isCurrentUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted-foreground/20 text-muted-foreground',
      )}
      title={displayName ?? (isCurrentUser ? 'Assigned to you' : 'Assigned to another user')}
    >
      {initials}
    </span>
  );
}

// --- Task Row ---

function TaskRow({
  task,
  currentUserId,
  currentUserName,
  userNames,
  showProcess,
  processName,
  muted = false,
}: {
  task: HumanTask;
  currentUserId: string;
  currentUserName?: string | null;
  userNames: Map<string, string>;
  showProcess: boolean;
  processName?: string;
  muted?: boolean;
}) {
  const actionType = getActionType(task);
  const ActionIcon = actionType.icon;
  const deadline = formatDeadline(task.deadline);
  const isOverdue = deadline?.includes('overdue') ?? false;
  const isClaimed = task.status === 'claimed';

  return (
    <div className={cn('group flex items-center border-b border-border/30 last:border-b-0', muted && 'opacity-60')}>
      <Link
        href={`/tasks/${task.id}`}
        className="flex flex-1 items-center gap-2 px-3 py-1.5 hover:bg-muted/50 transition-colors min-w-0"
      >
        <ActionIcon className={cn('h-3.5 w-3.5 shrink-0', actionType.colorClass)} />
        <span className="flex-1 text-sm truncate">{getTaskLabel(task)}</span>
        {showProcess && processName && (
          <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[160px]">
            {formatStepName(processName)}
          </span>
        )}
        {deadline && (
          <span
            className={cn(
              'text-xs tabular-nums shrink-0',
              isOverdue ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {deadline}
          </span>
        )}
      </Link>
      <div className="pr-2 shrink-0">
        {isClaimed && (
          <AssigneeAvatar
            isCurrentUser={task.assignedUserId === currentUserId}
            displayName={task.assignedUserId === currentUserId ? currentUserName : userNames.get(task.assignedUserId ?? '')}
          />
        )}
        {task.status === 'pending' && <ClaimButton taskId={task.id} currentUserId={currentUserId} variant="inline" />}
      </div>
    </div>
  );
}

// --- Sub-group header (for action within process card) ---

function SubGroupHeader({ title, icon, count }: { title: string; icon?: React.ReactNode; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/20">
      {icon}
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <span className="text-xs text-muted-foreground/60">({count})</span>
    </div>
  );
}

// --- Process Card ---

interface ProcessCardProps {
  processName: string;
  activeTasks: HumanTask[];
  completedTasks: HumanTask[];
  currentUserId: string;
  currentUserName?: string | null;
  userNames: Map<string, string>;
  subGroupByAction: boolean;
}

function ProcessCard({ processName, activeTasks, completedTasks, currentUserId, currentUserName, userNames, subGroupByAction }: ProcessCardProps) {
  const [expanded, setExpanded] = React.useState(false);

  const allTasks = React.useMemo(() => {
    const claimed = sortTasksForDisplay(
      activeTasks.filter((t) => t.status === 'claimed' && t.assignedUserId === currentUserId),
    );
    const available = sortTasksForDisplay(
      activeTasks.filter((t) => !(t.status === 'claimed' && t.assignedUserId === currentUserId)),
    );
    const completed = sortTasksForDisplay(completedTasks);
    return [...claimed, ...available, ...completed];
  }, [activeTasks, completedTasks, currentUserId]);

  const visibleTasks = expanded ? allTasks : allTasks.slice(0, VISIBLE_TASK_LIMIT);
  const hasMore = allTasks.length > VISIBLE_TASK_LIMIT;
  const totalCount = activeTasks.length + completedTasks.length;

  const renderTasks = (tasks: HumanTask[]) => {
    if (!subGroupByAction) {
      return tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          userNames={userNames}
          showProcess={false}
          muted={task.status === 'completed' || task.status === 'cancelled'}
        />
      ));
    }

    const byAction = new Map<string, HumanTask[]>();
    for (const task of tasks) {
      const action = getActionType(task);
      const group = byAction.get(action.type) ?? [];
      group.push(task);
      byAction.set(action.type, group);
    }

    return Array.from(byAction.entries()).map(([type, groupTasks]) => {
      const sampleAction = getActionType(groupTasks[0]);
      const Icon = sampleAction.icon;
      return (
        <div key={type}>
          <SubGroupHeader
            title={sampleAction.label}
            icon={<Icon className={cn('h-3 w-3', sampleAction.colorClass)} />}
            count={groupTasks.length}
          />
          {groupTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              userNames={userNames}
              showProcess={false}
              muted={task.status === 'completed' || task.status === 'cancelled'}
            />
          ))}
        </div>
      );
    });
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-sm">
      <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold truncate">{formatStepName(processName)}</h3>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground font-medium">
            {totalCount} {totalCount === 1 ? 'task' : 'tasks'}
          </span>
        </div>
      </div>

      <div className={cn(expanded && 'max-h-[400px] overflow-y-auto')}>
        {renderTasks(visibleTasks)}
      </div>
      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-2 text-xs font-medium text-primary hover:bg-muted/30 transition-colors border-t border-border/30"
        >
          Show all {allTasks.length} tasks
        </button>
      )}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors border-t border-border/30"
        >
          Show less
        </button>
      )}
    </div>
  );
}

// --- Action Group (flat, no cards) ---

function ActionGroup({
  tasks,
  completedTasks,
  currentUserId,
  currentUserName,
  userNames,
  processNameMap,
}: {
  tasks: HumanTask[];
  completedTasks: HumanTask[];
  currentUserId: string;
  currentUserName?: string | null;
  userNames: Map<string, string>;
  processNameMap: Map<string, string>;
}) {
  const [expanded, setExpanded] = React.useState(false);

  const actionType = getActionType(tasks[0]);
  const ActionIcon = actionType.icon;
  const allTasks = React.useMemo(
    () => [...sortTasksForDisplay(tasks), ...sortTasksForDisplay(completedTasks)],
    [tasks, completedTasks],
  );

  const visibleTasks = expanded ? allTasks : allTasks.slice(0, VISIBLE_TASK_LIMIT);
  const hasMore = allTasks.length > VISIBLE_TASK_LIMIT;

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden transition-all hover:border-primary/40 hover:shadow-sm">
      <div className="px-4 py-3 border-b border-border/50 bg-muted/20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ActionIcon className={cn('h-4 w-4 shrink-0', actionType.colorClass)} />
            <h3 className="text-base font-semibold truncate">{actionType.label}</h3>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground font-medium">
            {allTasks.length} {allTasks.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>
      </div>
      <div className={cn(expanded && 'max-h-[400px] overflow-y-auto')}>
        {visibleTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            userNames={userNames}
            showProcess
            processName={processNameMap.get(task.processInstanceId)}
            muted={task.status === 'completed' || task.status === 'cancelled'}
          />
        ))}
      </div>
      {hasMore && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-2 text-xs font-medium text-primary hover:bg-muted/30 transition-colors border-t border-border/30"
        >
          Show all {allTasks.length} tasks
        </button>
      )}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors border-t border-border/30"
        >
          Show less
        </button>
      )}
    </div>
  );
}

// --- Flat List ---

function FlatList({
  activeTasks,
  currentUserId,
  currentUserName,
  userNames,
  processNameMap,
}: {
  activeTasks: HumanTask[];
  currentUserId: string;
  currentUserName?: string | null;
  userNames: Map<string, string>;
  processNameMap: Map<string, string>;
}) {
  const sorted = React.useMemo(() => sortTasksForDisplay(activeTasks), [activeTasks]);

  if (sorted.length === 0) return <EmptyState />;

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {sorted.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          userNames={userNames}
          showProcess
          processName={processNameMap.get(task.processInstanceId)}
        />
      ))}
    </div>
  );
}

// --- Loading & Empty ---

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card overflow-hidden animate-pulse">
          <div className="px-4 py-4 border-b border-border/50 bg-muted/20 flex items-center justify-between gap-2">
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-5 bg-muted rounded-full w-14" />
          </div>
          <div className="p-3 space-y-2">
            <div className="h-8 bg-muted rounded w-full" />
            <div className="h-8 bg-muted rounded w-full" />
            <div className="h-8 bg-muted rounded w-3/4" />
          </div>
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

// --- Main Component ---

export function TaskGroupedView({
  activeTasks,
  completedTasks,
  loading,
  currentUserId,
  currentUserName,
  groupByFields,
}: {
  activeTasks: HumanTask[];
  completedTasks: HumanTask[];
  loading: boolean;
  currentUserId: string;
  currentUserName?: string | null;
  groupByFields: Set<GroupByField>;
}) {
  const processNameMap = useProcessNameMap();
  const userNames = useUserDisplayNames();
  const groupByProcess = groupByFields.has('process');
  const groupByAction = groupByFields.has('action');

  if (loading) return <LoadingSkeleton />;
  if (activeTasks.length === 0 && completedTasks.length === 0) return <EmptyState />;

  // No grouping — flat list
  if (!groupByProcess && !groupByAction) {
    return <FlatList activeTasks={activeTasks} currentUserId={currentUserId} currentUserName={currentUserName} userNames={userNames} processNameMap={processNameMap} />;
  }

  // Group by process (with optional action sub-grouping)
  if (groupByProcess) {
    const byDefinition = new Map<string, { active: HumanTask[]; completed: HumanTask[] }>();

    for (const task of activeTasks) {
      const defName = processNameMap.get(task.processInstanceId) ?? task.processInstanceId.slice(0, 8);
      const group = byDefinition.get(defName) ?? { active: [], completed: [] };
      group.active.push(task);
      byDefinition.set(defName, group);
    }
    for (const task of completedTasks) {
      const defName = processNameMap.get(task.processInstanceId) ?? task.processInstanceId.slice(0, 8);
      const group = byDefinition.get(defName) ?? { active: [], completed: [] };
      group.completed.push(task);
      byDefinition.set(defName, group);
    }

    const groups = Array.from(byDefinition.entries())
      .filter(([, group]) => group.active.length > 0)
      .sort(([, a], [, b]) => b.active.length - a.active.length);

    if (groups.length === 0) return <EmptyState />;

    return (
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map(([name, group]) => (
          <ProcessCard
            key={name}
            processName={name}
            activeTasks={group.active}
            completedTasks={group.completed}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            userNames={userNames}
            subGroupByAction={groupByAction}
          />
        ))}
      </div>
    );
  }

  // Group by action only (no process grouping)
  const byAction = new Map<string, { active: HumanTask[]; completed: HumanTask[] }>();

  for (const task of activeTasks) {
    const action = getActionType(task);
    const group = byAction.get(action.type) ?? { active: [], completed: [] };
    group.active.push(task);
    byAction.set(action.type, group);
  }
  for (const task of completedTasks) {
    const action = getActionType(task);
    const group = byAction.get(action.type) ?? { active: [], completed: [] };
    group.completed.push(task);
    byAction.set(action.type, group);
  }

  const actionGroups = Array.from(byAction.entries())
    .filter(([, group]) => group.active.length > 0)
    .sort(([, a], [, b]) => b.active.length - a.active.length);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {actionGroups.map(([type, group]) => (
        <ActionGroup
          key={type}
          tasks={group.active}
          completedTasks={group.completed}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          userNames={userNames}
          processNameMap={processNameMap}
        />
      ))}
    </div>
  );
}
