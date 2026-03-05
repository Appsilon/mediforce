'use client';

import Link from 'next/link';
import { Plus, Copy, ChevronRight, FileText } from 'lucide-react';
import { useProcessConfigs } from '@/hooks/use-process-configs';

interface ConfigListProps {
  processName: string;
}

export function ConfigList({ processName }: ConfigListProps) {
  const { configs, loading } = useProcessConfigs(processName);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {configs.length > 0
            ? `${configs.length} configuration${configs.length !== 1 ? 's' : ''}`
            : ''}
        </h3>
        <Link
          href={`/configs/new?process=${encodeURIComponent(processName)}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Configuration
        </Link>
      </div>

      {configs.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p>No configurations yet.</p>
          <p className="mt-1">
            Create one to assign executors and reviewers to process steps.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((config) => {
            const stepCount = config.stepConfigs.length;
            const href = `/configs/${encodeURIComponent(processName)}/${encodeURIComponent(config.configName)}/${encodeURIComponent(config.configVersion)}`;
            const cloneHref = `/configs/new?process=${encodeURIComponent(processName)}&cloneConfig=${encodeURIComponent(config.configName)}&cloneVersion=${encodeURIComponent(config.configVersion)}`;

            return (
              <div
                key={`${config.configName}:${config.configVersion}`}
                className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <span className="font-medium text-sm">{config.configName}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {config.configVersion}
                    </span>
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
