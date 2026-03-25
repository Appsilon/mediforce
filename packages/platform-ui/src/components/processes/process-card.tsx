'use client';

import * as React from 'react';
import { useMemo } from 'react';
import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { GitBranch, Layers, Github, ExternalLink, SlidersHorizontal, Check, ChevronRight, Plus } from 'lucide-react';
import { ProcessInstanceRow } from '@/components/processes/process-run-section';
import { StartRunButton } from '@/components/processes/start-run-button';
import { formatStepName } from '@/components/tasks/task-utils';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';
import type { ProcessInstance } from '@mediforce/platform-core';
import type { DefinitionGroup } from '@/hooks/use-process-definitions';

export function isActiveStatus(status: string): boolean {
  return status === 'running' || status === 'created' || status === 'paused';
}

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed';
}

const PREVIEW_LIMIT = 3;

export function DisplayPopover({
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

export function ProcessCard({
  definition,
  instances,
  showCompleted,
  steps,
  handle,
}: {
  definition: DefinitionGroup;
  instances: ProcessInstance[];
  showCompleted: boolean;
  steps?: string[];
  handle: string;
}) {
  const filteredInstances = useMemo(() => {
    return instances.filter((instance) => {
      if (!showCompleted && isTerminalStatus(instance.status)) return false;
      return true;
    });
  }, [instances, showCompleted]);

  const sortedInstances = useMemo(() => {
    return [...filteredInstances].sort((instanceA, instanceB) => {
      return new Date(instanceB.createdAt).getTime() - new Date(instanceA.createdAt).getTime();
    });
  }, [filteredInstances]);

  const activeCount = sortedInstances.filter((instance) => isActiveStatus(instance.status)).length;
  const totalCount = sortedInstances.length;
  const previewInstances = sortedInstances.slice(0, PREVIEW_LIMIT);
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
          href={`/${handle}/workflows/${encodeURIComponent(definition.name)}`}
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
                {definition.namespace && (
                  <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">
                    @{definition.namespace}
                  </span>
                )}
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
                <VersionLabel version={definition.latestVersion} title={definition.title} variant="inline" />
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
            <StartRunButton workflowName={definition.name} showVersionPicker />
          )}
        </div>

        {/* Runs preview — compact list only */}
        {previewInstances.length > 0 && (
        <div className="border-t">

          <div>
            {previewInstances.map((instance) => (
              <ProcessInstanceRow
                key={instance.id}
                instance={instance}
                steps={steps}
              />
            ))}
          </div>

          {hasMore && (
            <Link
              href={`/${handle}/runs?workflow=${encodeURIComponent(definition.name)}`}
              className="block w-full px-4 py-2 text-xs font-medium text-primary hover:bg-muted/30 transition-colors border-t border-border/30 text-center"
            >
              Show all {totalCount} runs
            </Link>
          )}
        </div>
        )}
      </div>

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

export function WorkflowCatalogSkeletons() {
  return (
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
  );
}
