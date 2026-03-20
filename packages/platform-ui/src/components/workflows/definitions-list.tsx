'use client';

import Link from 'next/link';
import { ChevronRight, Pencil, Loader2, Star } from 'lucide-react';
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

      <div className="space-y-2">
        {definitions.map((def) => {
          const isLatest = def.version === latestVersion;
          const isDefault = def.version === defaultVersion;
          const isArchived = def.archived === true;

          return (
            <div
              key={def.version}
              className={cn(
                'flex items-center gap-3 w-full rounded-lg border px-4 py-3 transition-colors',
                'bg-card hover:bg-muted/50',
                isDefault && 'border-amber-300 dark:border-amber-700',
                isArchived && 'opacity-60',
              )}
            >
              {/* Default star — clickable */}
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  if (!isDefault) {
                    await setDefaultWorkflowVersion(workflowName, def.version);
                    refreshDefault();
                  }
                }}
                className={cn(
                  'shrink-0 transition-colors',
                  isDefault
                    ? 'text-amber-500'
                    : 'text-muted-foreground/30 hover:text-amber-400',
                )}
                title={isDefault ? 'Default version' : 'Set as default'}
              >
                <Star className={cn('h-4 w-4', isDefault && 'fill-current')} />
              </button>

              <Link
                href={`/workflows/${encodeURIComponent(workflowName)}/definitions/${def.version}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <span className="font-mono text-sm font-medium">v{def.version}</span>

                {isLatest && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    latest
                  </span>
                )}
                {isDefault && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    default
                  </span>
                )}
                {isArchived && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    archived
                  </span>
                )}

                {def.description && (
                  <span className="text-sm text-muted-foreground truncate">{def.description}</span>
                )}

                <span className="text-xs text-muted-foreground ml-auto mr-1">
                  {def.steps.length} steps
                </span>

                {def.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(def.createdAt).toLocaleDateString()}
                  </span>
                )}

                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
