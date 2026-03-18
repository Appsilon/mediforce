'use client';

import * as React from 'react';
import { useMemo } from 'react';
import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { GitBranch, Plus, Layers, Github, ExternalLink, Archive, Play, SlidersHorizontal, Check, ChevronRight } from 'lucide-react';
import { useProcessDefinitions } from '@/hooks/use-process-definitions';
import { useProcessInstances } from '@/hooks/use-process-instances';
import { ProcessInstanceRow } from '@/components/processes/process-run-section';
import { StartRunDialog } from '@/components/processes/start-run-dialog';
import { formatStepName } from '@/components/tasks/task-utils';
import { cn } from '@/lib/utils';
import type { ProcessInstance } from '@mediforce/platform-core';
import type { DefinitionGroup } from '@/hooks/use-process-definitions';

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

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed';
}

const PREVIEW_LIMIT = 3;

function DisplayPopover({
  showCompleted,
  onToggleCompleted,
  showArchived,
  onToggleArchived,
  hasArchivedDefinitions,
}: {
  showCompleted: boolean;
  onToggleCompleted: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  hasArchivedDefinitions: boolean;
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
          className="z-50 w-52 rounded-lg border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <div className="px-2 py-1.5">
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
          {hasArchivedDefinitions && (
            <button
              onClick={onToggleArchived}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm',
                'hover:bg-accent hover:text-accent-foreground transition-colors',
                showArchived ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              Archived workflows
              {showArchived && <Check className="h-3.5 w-3.5" />}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ProcessCard({
  definition,
  instances,
  showCompleted,
  steps,
}: {
  definition: DefinitionGroup;
  instances: ProcessInstance[];
  showCompleted: boolean;
  steps?: string[];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [startRunOpen, setStartRunOpen] = React.useState(false);

  const filteredInstances = useMemo(() => {
    return instances.filter((instance) => {
      if (!showCompleted && isTerminalStatus(instance.status)) return false;
      return true;
    });
  }, [instances, showCompleted]);

  const sortedInstances = useMemo(() => {
    return [...filteredInstances].sort((instanceA, instanceB) => {
      const statusDiff = (STATUS_ORDER[instanceA.status] ?? 99) - (STATUS_ORDER[instanceB.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      return new Date(instanceB.createdAt).getTime() - new Date(instanceA.createdAt).getTime();
    });
  }, [filteredInstances]);

  const activeCount = sortedInstances.filter((instance) => isActiveStatus(instance.status)).length;
  const totalCount = sortedInstances.length;
  const previewInstances = expanded ? sortedInstances : sortedInstances.slice(0, PREVIEW_LIMIT);
  const hasMore = totalCount > PREVIEW_LIMIT;

  return (
    <>
      <div
        className={cn(
          'rounded-lg border bg-card flex flex-col transition-all overflow-hidden',
          definition.archived ? 'opacity-60' : 'hover:border-primary/40 hover:shadow-sm',
        )}
      >
        {/* Definition header — primary content */}
        <Link
          href={`/processes/${encodeURIComponent(definition.name)}`}
          className="group flex items-start justify-between gap-2 px-4 py-4 hover:bg-muted/20 transition-colors"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 mt-0.5">
              <GitBranch className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-base group-hover:text-primary transition-colors">
                  {formatStepName(definition.name)}
                </span>
                {definition.archived && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Archived
                  </span>
                )}
              </div>
              {definition.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 max-w-[280px]">
                  {definition.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <span className="font-mono">v{definition.latestVersion}</span>
                <span className="text-border">·</span>
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {definition.stepCount} {definition.stepCount === 1 ? 'step' : 'steps'}
                </span>
                {definition.repo && (
                  <>
                    <span className="text-border">·</span>
                    <CatalogRepoIcon repo={definition.repo} />
                  </>
                )}
                {definition.url && (
                  <>
                    <span className="text-border">·</span>
                    <CatalogAppIcon url={definition.url} />
                  </>
                )}
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
        <div className="flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {totalCount > 0 ? (
              <>
                <span>{totalCount} {totalCount === 1 ? 'run' : 'runs'}</span>
                {activeCount > 0 && (
                  <span className="inline-flex rounded-full bg-green-500/10 px-1.5 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                    {activeCount} active
                  </span>
                )}
              </>
            ) : (
              <span>No runs</span>
            )}
          </div>
          {definition.hasManualTrigger && !definition.archived && (
            <button
              onClick={() => setStartRunOpen(true)}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              <Play className="h-3 w-3" />
              Start Run
            </button>
          )}
        </div>

        {/* Runs preview — compact list only */}
        {previewInstances.length > 0 && (
        <div className="border-t">

          <div className={cn(expanded && 'max-h-[300px] overflow-y-auto')}>
            {previewInstances.map((instance) => (
              <ProcessInstanceRow
                key={instance.id}
                instance={instance}
                steps={steps}
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
          {expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="w-full px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors border-t border-border/30"
            >
              Show less
            </button>
          )}
        </div>
        )}
      </div>

      {startRunOpen && (
        <StartRunDialog
          processName={definition.name}
          definitionVersion={definition.latestVersion}
          open={startRunOpen}
          onClose={() => setStartRunOpen(false)}
        />
      )}
    </>
  );
}

function CatalogRepoIcon({ repo }: { repo: { url: string; branch?: string; directory?: string } }) {
  let href = repo.url;
  if (repo.branch) {
    href += `/tree/${repo.branch}`;
    if (repo.directory) href += `/${repo.directory}`;
  }
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
      }}
    >
      <Github className="h-3 w-3" />
    </button>
  );
}

function CatalogAppIcon({ url }: { url: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.open(url, '_blank', 'noopener,noreferrer');
      }}
    >
      <ExternalLink className="h-3 w-3" />
    </button>
  );
}

export default function ProcessCatalogPage() {
  const [showCompleted, setShowCompleted] = React.useState(true);
  const [showArchived, setShowArchived] = React.useState(false);

  const { definitions, stepsByDefinition, loading: defsLoading } = useProcessDefinitions();
  const { data: allInstances, loading: instancesLoading } = useProcessInstances('all');

  const loading = defsLoading || instancesLoading;

  const hasArchivedDefinitions = definitions.some((d) => d.archived === true);

  const visibleDefinitions = useMemo(() => {
    return definitions.filter((d) => showArchived || d.archived !== true);
  }, [definitions, showArchived]);

  // Group instances by definition name
  const instancesByDefinition = useMemo((): Map<string, ProcessInstance[]> => {
    const map = new Map<string, ProcessInstance[]>();
    for (const instance of allInstances) {
      const existing = map.get(instance.definitionName) ?? [];
      existing.push(instance);
      map.set(instance.definitionName, existing);
    }
    return map;
  }, [allInstances]);

  // Sort definitions: those with active runs first, then alphabetically
  const sortedDefinitions = useMemo(() => {
    return [...visibleDefinitions].sort((defA, defB) => {
      const instancesA = instancesByDefinition.get(defA.name) ?? [];
      const instancesB = instancesByDefinition.get(defB.name) ?? [];
      const activeA = instancesA.some((instance) => isActiveStatus(instance.status));
      const activeB = instancesB.some((instance) => isActiveStatus(instance.status));
      if (activeA && !activeB) return -1;
      if (!activeA && activeB) return 1;
      return defA.name.localeCompare(defB.name);
    });
  }, [visibleDefinitions, instancesByDefinition]);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-headline font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Business workflows defined in the platform — each one orchestrates agents and humans.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DisplayPopover
            showCompleted={showCompleted}
            onToggleCompleted={() => setShowCompleted((prev) => !prev)}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((prev) => !prev)}
            hasArchivedDefinitions={hasArchivedDefinitions}
          />
          <Link
            href="/processes/new"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
              'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            New Workflow
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border bg-card overflow-hidden animate-pulse">
              <div className="px-4 pt-4 pb-3 flex gap-3">
                <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-32 rounded bg-muted" />
                  <div className="h-3 w-48 rounded bg-muted" />
                  <div className="h-3 w-20 rounded bg-muted" />
                </div>
              </div>
              <div className="border-t border-border/50 px-4 py-2 space-y-2">
                <div className="h-3 w-16 rounded bg-muted" />
                <div className="h-8 w-full rounded bg-muted" />
                <div className="h-8 w-full rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : definitions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center py-24">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <GitBranch className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">No workflows defined yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first workflow to start orchestrating agents and humans.
            </p>
          </div>
          <Link
            href="/processes/new"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Workflow
          </Link>
        </div>
      ) : sortedDefinitions.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          All workflows are archived.{' '}
          <button onClick={() => setShowArchived(true)} className="text-primary hover:underline">
            Show archived
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sortedDefinitions.map((definition) => (
            <ProcessCard
              key={definition.name}
              definition={definition}
              instances={instancesByDefinition.get(definition.name) ?? []}
              showCompleted={showCompleted}
              steps={stepsByDefinition.get(definition.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
