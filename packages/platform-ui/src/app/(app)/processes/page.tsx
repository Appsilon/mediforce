'use client';

import * as React from 'react';
import Link from 'next/link';
import { GitBranch, Plus, Layers, Zap, Github, ExternalLink, Archive, ArchiveRestore } from 'lucide-react';
import { useProcessDefinitions } from '@/hooks/use-process-definitions';
import { setProcessArchived } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';

export default function ProcessCatalogPage() {
  const { definitions, loading } = useProcessDefinitions();
  const [showArchived, setShowArchived] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);

  const activeDefinitions = definitions.filter((d) => !d.archived);
  const archivedDefinitions = definitions.filter((d) => d.archived);
  const visibleDefinitions = showArchived ? definitions : activeDefinitions;

  async function handleArchiveToggle(name: string, archived: boolean) {
    setPendingAction(name);
    await setProcessArchived(name, archived);
    setPendingAction(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-headline font-semibold">Processes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Business processes defined in the platform — each one orchestrates agents and humans.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {archivedDefinitions.length > 0 && (
            <button
              onClick={() => setShowArchived((prev) => !prev)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors border',
                showArchived
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Archive className="h-3.5 w-3.5" />
              {showArchived ? 'Hide' : 'Show'} archived ({archivedDefinitions.length})
            </button>
          )}
          <Link
            href="/processes/new"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
              'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            New Process
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-5 space-y-3 animate-pulse">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-48 rounded bg-muted" />
              <div className="h-3 w-20 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : definitions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center py-24">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <GitBranch className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">No processes defined yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first process to start orchestrating agents and humans.
            </p>
          </div>
          <Link
            href="/processes/new"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Process
          </Link>
        </div>
      ) : visibleDefinitions.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          All processes are archived.{' '}
          <button onClick={() => setShowArchived(true)} className="text-primary hover:underline">
            Show archived
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleDefinitions.map((def) => (
            <div
              key={def.name}
              className={cn(
                'group rounded-lg border bg-card p-5 flex flex-col gap-3 transition-all',
                def.archived ? 'opacity-60' : 'hover:border-primary/50 hover:shadow-sm',
              )}
            >
              <Link
                href={`/processes/${encodeURIComponent(def.name)}`}
                className="flex flex-col gap-3 flex-1"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                    <GitBranch className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {def.archived && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Archived
                      </span>
                    )}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                      v{def.latestVersion}
                    </span>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-sm group-hover:text-primary transition-colors">
                    {def.name}
                  </p>
                  {def.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {def.description}
                    </p>
                  )}
                </div>
              </Link>

              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-auto pt-2 border-t">
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {def.stepCount} steps
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  {def.versions.length} {def.versions.length === 1 ? 'version' : 'versions'}
                </span>
                <CatalogRepoIcon repo={def.repo} />
                <CatalogAppIcon url={def.url} hasRepo={!!def.repo} />
                <button
                  onClick={() => handleArchiveToggle(def.name, !def.archived)}
                  disabled={pendingAction === def.name}
                  className={cn(
                    'inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto',
                    pendingAction === def.name && 'opacity-50 pointer-events-none',
                  )}
                  title={def.archived ? 'Unarchive' : 'Archive'}
                >
                  {def.archived ? (
                    <ArchiveRestore className="h-3 w-3" />
                  ) : (
                    <Archive className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogRepoIcon({ repo }: { repo?: { url: string; branch?: string; directory?: string } }) {
  if (!repo) return null;
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

function CatalogAppIcon({ url, hasRepo }: { url?: string; hasRepo: boolean }) {
  if (!url) return null;
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 hover:text-foreground transition-colors', !hasRepo && 'ml-auto')}
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
