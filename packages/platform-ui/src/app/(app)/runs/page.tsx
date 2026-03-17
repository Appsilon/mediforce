'use client';

import * as React from 'react';
import { useMemo, useCallback } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { SlidersHorizontal, Check } from 'lucide-react';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { useProcessDefinitions } from '@/hooks/use-process-definitions';
import { ProcessInstanceRow } from '@/components/processes/process-run-section';
import { formatStepName } from '@/components/tasks/task-utils';
import { cn } from '@/lib/utils';
import type { ProcessInstance } from '@mediforce/platform-core';

type RunsGroupByField = 'process';

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  created: 1,
  paused: 2,
  completed: 3,
  failed: 4,
};

function isActiveStatus(status: string): boolean {
  return status === 'running' || status === 'created' || status === 'paused';
}

interface DefinitionGroup {
  definitionName: string;
  instances: ProcessInstance[];
  activeCount: number;
}

function buildDefinitionGroups(instances: ProcessInstance[]): DefinitionGroup[] {
  const byDefinition = new Map<string, ProcessInstance[]>();
  for (const instance of instances) {
    const group = byDefinition.get(instance.definitionName) ?? [];
    group.push(instance);
    byDefinition.set(instance.definitionName, group);
  }

  return Array.from(byDefinition.entries())
    .map(([definitionName, groupInstances]) => {
      const sorted = [...groupInstances].sort((instanceA, instanceB) => {
        const statusDiff = (STATUS_ORDER[instanceA.status] ?? 99) - (STATUS_ORDER[instanceB.status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        return new Date(instanceB.createdAt).getTime() - new Date(instanceA.createdAt).getTime();
      });
      const activeCount = sorted.filter((instance) => isActiveStatus(instance.status)).length;
      return { definitionName, instances: sorted, activeCount };
    })
    .sort((groupA, groupB) => {
      if (groupA.activeCount > 0 && groupB.activeCount === 0) return -1;
      if (groupA.activeCount === 0 && groupB.activeCount > 0) return 1;
      return groupA.definitionName.localeCompare(groupB.definitionName);
    });
}

function DisplayPopover({
  groupByProcess,
  onToggleGroup,
  showCompleted,
  onToggleCompleted,
}: {
  groupByProcess: boolean;
  onToggleGroup: () => void;
  showCompleted: boolean;
  onToggleCompleted: () => void;
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
          <button
            onClick={onToggleGroup}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              groupByProcess ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            Process
            {groupByProcess && <Check className="h-3.5 w-3.5" />}
          </button>
          <div className="px-2 py-1.5 mt-1 border-t border-border/40">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Show
            </span>
          </div>
          <button
            onClick={onToggleCompleted}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm',
              'hover:bg-accent hover:text-accent-foreground transition-colors',
              showCompleted ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            Completed runs
            {showCompleted && <Check className="h-3.5 w-3.5" />}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const VISIBLE_LIMIT = 5;

function DefinitionCard({ group, steps }: { group: DefinitionGroup; steps?: string[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasActive = group.activeCount > 0;
  const totalCount = group.instances.length;
  const visibleInstances = expanded ? group.instances : group.instances.slice(0, VISIBLE_LIMIT);
  const hasMore = totalCount > VISIBLE_LIMIT;

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <a
        href={`/processes/${encodeURIComponent(group.definitionName)}`}
        className="block px-4 py-3 border-b border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{formatStepName(group.definitionName)}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {totalCount} {totalCount === 1 ? 'run' : 'runs'}
            </span>
            {hasActive && (
              <span className="inline-flex rounded-full bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                {group.activeCount} active
              </span>
            )}
          </div>
        </div>
      </a>

      <div className={cn(expanded && 'max-h-[400px] overflow-y-auto')}>
        {visibleInstances.map((instance) => (
          <ProcessInstanceRow key={instance.id} instance={instance} steps={steps} />
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

function FlatRunsList({ instances, stepsByDefinition }: { instances: ProcessInstance[]; stepsByDefinition: Map<string, string[]> }) {
  const sorted = useMemo(() => {
    return [...instances].sort((instanceA, instanceB) => {
      const statusDiff = (STATUS_ORDER[instanceA.status] ?? 99) - (STATUS_ORDER[instanceB.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      return new Date(instanceB.createdAt).getTime() - new Date(instanceA.createdAt).getTime();
    });
  }, [instances]);

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {sorted.map((instance) => (
        <ProcessInstanceRow key={instance.id} instance={instance} showProcess steps={stepsByDefinition.get(instance.definitionName)} />
      ))}
    </div>
  );
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed';
}

export default function RunsPage() {
  const [groupByProcess, setGroupByProcess] = React.useState(true);
  const [showCompleted, setShowCompleted] = React.useState(true);
  const toggleGroup = useCallback(() => setGroupByProcess((prev) => !prev), []);
  const toggleCompleted = useCallback(() => setShowCompleted((prev) => !prev), []);

  const { data: runs, loading: runsLoading } = useProcessInstances('all');
  const { definitions, stepsByDefinition, loading: defsLoading } = useProcessDefinitions();

  const archivedNames = useMemo(
    () => new Set(definitions.filter((d) => d.archived).map((d) => d.name)),
    [definitions],
  );

  const visibleRuns = useMemo(
    () => runs.filter((r) => {
      if (archivedNames.has(r.definitionName)) return false;
      if (!showCompleted && isTerminalStatus(r.status)) return false;
      return true;
    }),
    [runs, archivedNames, showCompleted],
  );

  const groups = useMemo(
    () => buildDefinitionGroups(visibleRuns),
    [visibleRuns],
  );

  const loading = runsLoading || defsLoading;

  return (
    <div className="flex flex-1 flex-col gap-0">
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-headline font-semibold">My Runs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Process runs overview.</p>
        </div>
        <DisplayPopover
          groupByProcess={groupByProcess}
          onToggleGroup={toggleGroup}
          showCompleted={showCompleted}
          onToggleCompleted={toggleCompleted}
        />
      </div>

      <div className="p-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="rounded-lg border p-4 space-y-3 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/2" />
                <div className="space-y-2">
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleRuns.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            No runs yet.
          </div>
        ) : groupByProcess ? (
          <div className="grid gap-4 md:grid-cols-2">
            {groups.map((group) => (
              <DefinitionCard key={group.definitionName} group={group} steps={stepsByDefinition.get(group.definitionName)} />
            ))}
          </div>
        ) : (
          <FlatRunsList instances={visibleRuns} stepsByDefinition={stepsByDefinition} />
        )}
      </div>
    </div>
  );
}
