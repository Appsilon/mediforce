'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Pencil, Loader2, Archive, ArchiveRestore, Eye, EyeOff } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { VersionLabel } from '@/components/ui/version-label';
import { setDefaultWorkflowVersion, setVersionArchived } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';

interface DefinitionsListProps {
  workflowName: string;
}

export function DefinitionsList({ workflowName }: DefinitionsListProps) {
  const handle = useHandleFromPath();
  const { definitions, latestVersion, defaultVersion, loading, refreshDefault } = useWorkflowDefinitions(workflowName);
  const [showArchived, setShowArchived] = React.useState(true);
  const [archivingVersion, setArchivingVersion] = React.useState<number | null>(null);

  const archivedCount = definitions.filter((d) => d.archived === true).length;
  const visibleDefinitions = showArchived
    ? definitions
    : definitions.filter((d) => d.archived !== true);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          No definitions found.
        </p>
        <Link
          href={`/${handle}/workflows/${encodeURIComponent(workflowName)}/definitions/${latestVersion}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Create first definition
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {definitions.length} version{definitions.length !== 1 ? 's' : ''}
          </p>
          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                showArchived
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30',
              )}
            >
              {showArchived
                ? <><EyeOff className="h-3.5 w-3.5" />Hide archived ({archivedCount})</>
                : <><Eye className="h-3.5 w-3.5" />Show archived ({archivedCount})</>}
            </button>
          )}
        </div>
        <Link
          href={`/${handle}/workflows/${encodeURIComponent(workflowName)}/definitions/${latestVersion}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
      </div>

      <div className="rounded-lg border divide-y">
        {visibleDefinitions.map((def) => {
          const isDefault = def.version === defaultVersion;
          const isArchived = def.archived === true;
          const canSetDefault = !isDefault && !isArchived;
          const isArchiving = archivingVersion === def.version;

          return (
            <div
              key={def.version}
              className={cn(
                'group flex items-center px-4 py-3 transition-colors hover:bg-muted/50',
                isArchived && 'opacity-50',
              )}
            >
              {/* Left: version + title + badges */}
              <Link
                href={`/${handle}/workflows/${encodeURIComponent(workflowName)}/definitions/${def.version}`}
                className="flex items-center gap-2.5 flex-1 min-w-0"
              >
                <VersionLabel version={def.version} title={def.title} className="text-sm shrink-0" />

                {isArchived && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    archived
                  </span>
                )}
              </Link>

              {/* Right: metadata + actions */}
              <div className="flex items-center gap-4 shrink-0 ml-4">
                <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                  {def.steps.length} steps
                </span>

                {def.createdAt && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                    {new Date(def.createdAt).toLocaleDateString()}
                  </span>
                )}

                {isDefault ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400 whitespace-nowrap">
                    default
                  </span>
                ) : (
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      if (canSetDefault) {
                        await setDefaultWorkflowVersion(workflowName, def.version);
                        refreshDefault();
                      }
                    }}
                    disabled={!canSetDefault}
                    className={cn(
                      'text-[11px] whitespace-nowrap transition-colors',
                      canSetDefault
                        ? 'text-muted-foreground/60 hover:text-foreground md:opacity-0 md:group-hover:opacity-100'
                        : 'invisible',
                    )}
                  >
                    Make default
                  </button>
                )}

                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    setArchivingVersion(def.version);
                    await setVersionArchived(workflowName, def.version, !isArchived);
                    setArchivingVersion(null);
                  }}
                  disabled={isArchiving || isDefault}
                  title={isDefault ? 'Cannot archive the default version' : isArchived ? 'Unarchive this version' : 'Archive this version'}
                  className={cn(
                    'rounded-md p-1 transition-colors',
                    isDefault
                      ? 'invisible'
                      : isArchiving
                        ? 'opacity-50 pointer-events-none'
                        : 'text-muted-foreground/60 hover:text-foreground md:opacity-0 md:group-hover:opacity-100',
                  )}
                >
                  {isArchived
                    ? <ArchiveRestore className="h-3.5 w-3.5" />
                    : <Archive className="h-3.5 w-3.5" />}
                </button>

                <Link
                  href={`/${handle}/workflows/${encodeURIComponent(workflowName)}/definitions/${def.version}`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
