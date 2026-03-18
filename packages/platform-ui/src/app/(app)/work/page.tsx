'use client';

import * as React from 'react';
import { useMemo } from 'react';
import Link from 'next/link';
import { Bot, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useMyTasks } from '@/hooks/use-tasks';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useProcessDefinitions } from '@/hooks/use-process-definitions';
import { ProcessInstanceRow } from '@/components/processes/process-run-section';
import { ClaimButton } from '@/components/tasks/claim-button';
import { getActionType, getTaskLabel } from '@/components/tasks/action-type';
import { cn } from '@/lib/utils';
import type { HumanTask, ProcessInstance } from '@mediforce/platform-core';
import type { DefinitionGroup } from '@/hooks/use-process-definitions';

// ---- Constants -------------------------------------------------------------

const ACTIVE_STATUSES = new Set(['running', 'paused', 'created']);
const RUNS_PREVIEW_LIMIT = 5;

// ---- Helpers ---------------------------------------------------------------

function formatDefinitionName(name: string): string {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// ---- AssigneeAvatar --------------------------------------------------------

function AssigneeAvatar({ isCurrentUser }: { isCurrentUser: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0',
        isCurrentUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted-foreground/20 text-muted-foreground',
      )}
      title={isCurrentUser ? 'Assigned to you' : 'Assigned to another user'}
    >
      {isCurrentUser ? 'Y' : '?'}
    </span>
  );
}

// ---- Run status indicator --------------------------------------------------

type RunStatus =
  | { kind: 'claimable'; task: HumanTask }
  | { kind: 'mine'; task: HumanTask }
  | { kind: 'others'; task: HumanTask }
  | { kind: 'agent' }
  | { kind: 'terminal' };

function deriveRunStatus(
  instance: ProcessInstance,
  task: HumanTask | undefined,
  currentUserId: string,
): RunStatus {
  const isTerminal = instance.status === 'completed' || instance.status === 'failed';
  if (isTerminal) return { kind: 'terminal' };

  if (task !== undefined) {
    if (task.status === 'pending') return { kind: 'claimable', task };
    if (task.status === 'claimed') {
      if (task.assignedUserId === currentUserId) return { kind: 'mine', task };
      return { kind: 'others', task };
    }
  }

  return { kind: 'agent' };
}

function RunStatusIndicator({
  status,
  currentUserId,
}: {
  status: RunStatus;
  currentUserId: string;
}) {
  if (status.kind === 'terminal') return null;

  if (status.kind === 'claimable') {
    return (
      <div className="shrink-0 flex items-center">
        <ClaimButton taskId={status.task.id} currentUserId={currentUserId} variant="inline" />
      </div>
    );
  }

  if (status.kind === 'mine') {
    const actionType = getActionType(status.task);
    return (
      <div className="shrink-0 flex items-center gap-1.5">
        <AssigneeAvatar isCurrentUser={true} />
        <span className={cn('text-xs font-medium', actionType.colorClass)}>
          {getTaskLabel(status.task).split(':')[0]}
        </span>
      </div>
    );
  }

  if (status.kind === 'others') {
    return (
      <div className="shrink-0 flex items-center gap-1.5">
        <AssigneeAvatar isCurrentUser={false} />
        <span className="text-xs text-muted-foreground">In review</span>
      </div>
    );
  }

  // agent
  return (
    <div className="shrink-0 flex items-center gap-1 text-muted-foreground">
      <Bot className="h-3 w-3" />
      <span className="text-xs">Agent working</span>
    </div>
  );
}

// ---- WorkRunRow ------------------------------------------------------------

function WorkRunRow({
  instance,
  steps,
  task,
  currentUserId,
}: {
  instance: ProcessInstance;
  steps?: string[];
  task: HumanTask | undefined;
  currentUserId: string;
}) {
  const runStatus = deriveRunStatus(instance, task, currentUserId);
  const detailHref = `/processes/${encodeURIComponent(instance.definitionName)}/runs/${instance.id}`;

  return (
    <div className="flex items-center border-b border-border/40 last:border-b-0">
      <div className="flex-1 min-w-0">
        <ProcessInstanceRow instance={instance} steps={steps} />
      </div>
      {runStatus.kind !== 'terminal' && (
        <Link
          href={`/tasks/${task?.id ?? ''}`}
          onClick={(e) => {
            if (runStatus.kind === 'agent' || runStatus.kind === 'claimable') e.preventDefault();
          }}
          className="shrink-0 pr-3"
        >
          <RunStatusIndicator status={runStatus} currentUserId={currentUserId} />
        </Link>
      )}
    </div>
  );
}

// ---- Sort runs by status priority ------------------------------------------

function runPriority(status: RunStatus): number {
  if (status.kind === 'mine') return 0;
  if (status.kind === 'claimable') return 1;
  if (status.kind === 'others') return 2;
  if (status.kind === 'agent') return 3;
  return 4;
}

// ---- Process section -------------------------------------------------------

function ProcessSection({
  definition,
  instances,
  taskByInstance,
  currentUserId,
  steps,
}: {
  definition: DefinitionGroup;
  instances: ProcessInstance[];
  taskByInstance: Map<string, HumanTask>;
  currentUserId: string;
  steps: string[];
}) {
  const [expanded, setExpanded] = React.useState(false);

  const activeInstances = useMemo(
    () => instances.filter((inst) => ACTIVE_STATUSES.has(inst.status)),
    [instances],
  );

  const sortedInstances = useMemo(
    () =>
      [...instances].sort((instanceA, instanceB) => {
        const taskA = taskByInstance.get(instanceA.id);
        const taskB = taskByInstance.get(instanceB.id);
        const statusA = deriveRunStatus(instanceA, taskA, currentUserId);
        const statusB = deriveRunStatus(instanceB, taskB, currentUserId);
        const priorityDiff = runPriority(statusA) - runPriority(statusB);
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(instanceB.createdAt).getTime() - new Date(instanceA.createdAt).getTime();
      }),
    [instances, taskByInstance, currentUserId],
  );

  const visibleInstances = expanded
    ? sortedInstances
    : sortedInstances.slice(0, RUNS_PREVIEW_LIMIT);
  const hasMore = sortedInstances.length > RUNS_PREVIEW_LIMIT;
  const totalCount = instances.length;

  return (
    <div className="space-y-0">
      {/* Section header */}
      <div className="flex items-center justify-between pb-2">
        <Link
          href={`/processes/${encodeURIComponent(definition.name)}`}
          className="group flex items-center gap-1.5 min-w-0"
        >
          <h2 className="text-sm font-semibold group-hover:text-primary transition-colors truncate">
            {formatDefinitionName(definition.name)}
          </h2>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </Link>
        <span className="text-xs text-muted-foreground shrink-0 ml-2 tabular-nums">
          {totalCount} {totalCount === 1 ? 'run' : 'runs'} · {activeInstances.length} active
        </span>
      </div>

      {/* Divider + rows */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className={cn(expanded && 'max-h-[320px] overflow-y-auto')}>
          {visibleInstances.map((instance) => (
            <WorkRunRow
              key={instance.id}
              instance={instance}
              steps={steps.length > 0 ? steps : undefined}
              task={taskByInstance.get(instance.id)}
              currentUserId={currentUserId}
            />
          ))}
        </div>

        {hasMore && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full px-4 py-2 text-xs font-medium text-primary hover:bg-muted/30 transition-colors border-t border-border/30"
          >
            Show all {totalCount} runs
          </button>
        )}
        {expanded && hasMore && (
          <button
            onClick={() => setExpanded(false)}
            className="w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors border-t border-border/30"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Loading skeleton -------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="space-y-2 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="h-4 w-48 rounded bg-muted" />
            <div className="h-3 w-24 rounded bg-muted" />
          </div>
          <div className="rounded-lg border bg-card overflow-hidden">
            {Array.from({ length: 3 }).map((_, rowIndex) => (
              <div
                key={rowIndex}
                className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-b-0"
              >
                <div className="h-2 w-2 rounded-full bg-muted shrink-0" />
                <div className="h-3 w-16 rounded bg-muted shrink-0" />
                <div className="h-3 flex-1 rounded bg-muted" />
                <div className="h-6 w-16 rounded bg-muted shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export default function WorkPage() {
  const { firebaseUser } = useAuth();
  const [role, setRole] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!firebaseUser) return;
    firebaseUser.getIdTokenResult().then((result) => {
      const roles = result.claims['roles'];
      if (Array.isArray(roles) && roles.length > 0) {
        setRole(roles[0] as string);
      }
    });
  }, [firebaseUser]);

  const currentUserId = firebaseUser?.uid ?? '';
  const { data: activeTasks, loading: tasksLoading } = useMyTasks(role);
  const { data: instances, loading: instancesLoading } = useProcessInstances('all');
  const { definitions, stepsByDefinition, loading: defsLoading } = useProcessDefinitions();

  // Build map: processInstanceId → first active HumanTask
  const taskByInstance = useMemo(() => {
    const map = new Map<string, HumanTask>();
    for (const task of activeTasks) {
      if (!map.has(task.processInstanceId)) {
        map.set(task.processInstanceId, task);
      }
    }
    return map;
  }, [activeTasks]);

  // Build map: definitionName → ProcessInstance[]
  const instancesByDefinition = useMemo(() => {
    const map = new Map<string, ProcessInstance[]>();
    for (const instance of instances) {
      const existing = map.get(instance.definitionName) ?? [];
      existing.push(instance);
      map.set(instance.definitionName, existing);
    }
    return map;
  }, [instances]);

  // Filter definitions that have at least one active instance, sort by attention needed
  const activeDefinitions = useMemo(() => {
    return definitions
      .filter((def) => {
        const defInstances = instancesByDefinition.get(def.name) ?? [];
        return defInstances.some((inst) => ACTIVE_STATUSES.has(inst.status));
      })
      .sort((defA, defB) => {
        // Definitions where current user has tasks first, then claimable, then agent-only
        const instancesA = instancesByDefinition.get(defA.name) ?? [];
        const instancesB = instancesByDefinition.get(defB.name) ?? [];

        function bestPriority(defInstances: ProcessInstance[]): number {
          return defInstances.reduce((best, inst) => {
            const task = taskByInstance.get(inst.id);
            return Math.min(best, runPriority(deriveRunStatus(inst, task, currentUserId)));
          }, 99);
        }

        const priorityDiff = bestPriority(instancesA) - bestPriority(instancesB);
        if (priorityDiff !== 0) return priorityDiff;
        return defA.name.localeCompare(defB.name);
      });
  }, [definitions, instancesByDefinition, taskByInstance, currentUserId]);

  const isLoading = tasksLoading || instancesLoading || defsLoading;

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-headline font-semibold">My Work</h1>
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            beta
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 italic">
          Your processes and what needs your attention.
        </p>
      </div>

      {/* Process sections */}
      {isLoading ? (
        <LoadingSkeleton />
      ) : activeDefinitions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No active processes right now.</p>
      ) : (
        <div className="space-y-8">
          {activeDefinitions.map((definition) => (
            <ProcessSection
              key={definition.name}
              definition={definition}
              instances={instancesByDefinition.get(definition.name) ?? []}
              taskByInstance={taskByInstance}
              currentUserId={currentUserId}
              steps={stepsByDefinition.get(definition.name) ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
