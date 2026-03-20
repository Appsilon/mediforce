'use client';

import Link from 'next/link';
import { ChevronRight, Pencil, Loader2 } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { setDefaultWorkflowVersion } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';

interface DefinitionsListProps {
  workflowName: string;
}

export function DefinitionsList({ workflowName }: DefinitionsListProps) {
  const { definitions, latestVersion, defaultVersion, loading, refreshDefault } = useWorkflowDefinitions(workflowName);

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
          href={`/workflows/${encodeURIComponent(workflowName)}/definitions/${latestVersion}`}
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
        <p className="text-sm text-muted-foreground">
          {definitions.length} version{definitions.length !== 1 ? 's' : ''}
        </p>
        <Link
          href={`/workflows/${encodeURIComponent(workflowName)}/definitions/${latestVersion}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
      </div>

      <div className="rounded-lg border divide-y">
        {definitions.map((def) => {
          const isLatest = def.version === latestVersion;
          const isDefault = def.version === defaultVersion;
          const isArchived = def.archived === true;

          return (
            <div
              key={def.version}
              className={cn(
                'flex items-center px-4 py-3 transition-colors hover:bg-muted/50',
                isArchived && 'opacity-50',
              )}
            >
              {/* Left: version + badges */}
              <Link
                href={`/workflows/${encodeURIComponent(workflowName)}/definitions/${def.version}`}
                className="flex items-center gap-2.5 flex-1 min-w-0"
              >
                <span className="font-mono text-sm font-semibold w-8 shrink-0">v{def.version}</span>

                <div className="flex items-center gap-1.5">
                  {isDefault && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      default
                    </span>
                  )}
                  {isLatest && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      latest
                    </span>
                  )}
                  {isArchived && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      archived
                    </span>
                  )}
                </div>

                {def.description && (
                  <span className="text-sm text-muted-foreground truncate ml-1">{def.description}</span>
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

                {!isDefault && !isArchived ? (
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      await setDefaultWorkflowVersion(workflowName, def.version);
                      refreshDefault();
                    }}
                    className="text-[11px] text-muted-foreground/50 hover:text-foreground transition-colors whitespace-nowrap"
                  >
                    Set as default
                  </button>
                ) : (
                  <span className="w-[85px]" /> // spacer for alignment
                )}

                <Link
                  href={`/workflows/${encodeURIComponent(workflowName)}/definitions/${def.version}`}
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
