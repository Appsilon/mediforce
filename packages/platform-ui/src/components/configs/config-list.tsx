'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Copy, ChevronRight, FileText, Archive, ArchiveRestore, Eye, EyeOff } from 'lucide-react';
import { useProcessConfigs } from '@/hooks/use-process-configs';
import { setConfigArchived } from '@/app/actions/definitions';
import { cn } from '@/lib/utils';

interface ConfigListProps {
  processName: string;
}

export function ConfigList({ processName }: ConfigListProps) {
  const { configs, loading } = useProcessConfigs(processName);
  const [showArchived, setShowArchived] = useState(false);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  const activeConfigs = configs.filter((config) => config.archived !== true);
  const archivedConfigs = configs.filter((config) => config.archived === true);
  const visibleConfigs = showArchived ? configs : activeConfigs;

  const sortedConfigs = [...visibleConfigs].sort((a, b) => {
    const nameCompare = a.configName.localeCompare(b.configName);
    if (nameCompare !== 0) return nameCompare;
    return Number(b.configVersion) - Number(a.configVersion);
  });

  const countLabel =
    activeConfigs.length > 0
      ? `${activeConfigs.length} configuration${activeConfigs.length !== 1 ? 's' : ''}${archivedConfigs.length > 0 ? ` (${archivedConfigs.length} archived)` : ''}`
      : '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {countLabel}
        </h3>
        <div className="flex items-center gap-2">
          {archivedConfigs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showArchived ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" />
                  Hide archived
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" />
                  Show archived
                </>
              )}
            </button>
          )}
          <Link
            href={`/configs/new?process=${encodeURIComponent(processName)}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Configuration
          </Link>
        </div>
      </div>

      {sortedConfigs.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>No configurations yet.</p>
          <p className="mt-1">
            Create one to assign executors and reviewers to process steps.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedConfigs.map((config) => {
            const stepCount = config.stepConfigs.length;
            const href = `/configs/${encodeURIComponent(processName)}/${encodeURIComponent(config.configName)}/${encodeURIComponent(config.configVersion)}`;
            const cloneHref = `/configs/new?process=${encodeURIComponent(processName)}&cloneConfig=${encodeURIComponent(config.configName)}&cloneVersion=${encodeURIComponent(config.configVersion)}`;
            const isArchived = config.archived === true;

            return (
              <div
                key={`${config.configName}:${config.configVersion}`}
                className={cn(
                  'flex items-center justify-between rounded-lg border bg-card px-4 py-3',
                  isArchived && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-medium text-sm">{config.configName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {config.configVersion}
                    </span>
                    {isArchived && (
                      <span className="ml-2 text-xs text-muted-foreground">(archived)</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {stepCount} step{stepCount !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    href={cloneHref}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    Clone
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      setConfigArchived(processName, config.configName, config.configVersion, !isArchived)
                    }
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isArchived ? (
                      <>
                        <ArchiveRestore className="h-3 w-3" />
                        Unarchive
                      </>
                    ) : (
                      <>
                        <Archive className="h-3 w-3" />
                        Archive
                      </>
                    )}
                  </button>
                  <Link
                    href={href}
                    className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                  >
                    View <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
