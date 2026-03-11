'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Play, X, Loader2 } from 'lucide-react';
import { useProcessConfigs } from '@/hooks/use-process-configs';
import { useAuth } from '@/contexts/auth-context';
import { startProcessRun } from '@/app/actions/processes';
import { cn } from '@/lib/utils';
import type { ProcessConfig } from '@mediforce/platform-core';

interface StartRunDialogProps {
  processName: string;
  definitionVersion: string;
  open: boolean;
  onClose: () => void;
}

export function StartRunDialog({
  processName,
  definitionVersion,
  open,
  onClose,
}: StartRunDialogProps) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { configs, loading: configsLoading } = useProcessConfigs(processName);
  const [selectedConfig, setSelectedConfig] = React.useState<ProcessConfig | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Auto-select when there's only one config
  React.useEffect(() => {
    if (configs.length === 1 && selectedConfig === null) {
      setSelectedConfig(configs[0]);
    }
  }, [configs, selectedConfig]);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedConfig(configs.length === 1 ? configs[0] : null);
      setStarting(false);
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function handleStart() {
    if (!selectedConfig || !firebaseUser) return;

    setStarting(true);
    setError(null);

    const result = await startProcessRun({
      definitionName: processName,
      definitionVersion,
      configName: selectedConfig.configName,
      configVersion: selectedConfig.configVersion,
      triggeredBy: firebaseUser.uid,
    });

    if (result.success && result.instanceId) {
      onClose();
      router.push(
        `/processes/${encodeURIComponent(processName)}/runs/${result.instanceId}`,
      );
    } else {
      setError(result.error ?? 'Failed to start run');
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">Start New Run</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Process
            </label>
            <p className="text-sm mt-0.5">
              {processName}{' '}
              <span className="font-mono text-xs text-muted-foreground">
                v{definitionVersion}
              </span>
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Configuration
            </label>
            {configsLoading ? (
              <div className="mt-1.5 h-10 rounded-md bg-muted animate-pulse" />
            ) : configs.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                No configurations available. Create one first.
              </p>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {configs.map((config) => {
                  const isSelected =
                    selectedConfig?.configName === config.configName &&
                    selectedConfig?.configVersion === config.configVersion;
                  return (
                    <button
                      key={`${config.configName}:${config.configVersion}`}
                      onClick={() => setSelectedConfig(config)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50',
                      )}
                    >
                      <span className="font-medium">{config.configName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {config.configVersion}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={!selectedConfig || starting || configs.length === 0}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
              'hover:bg-primary/90',
              'disabled:opacity-50 disabled:pointer-events-none',
            )}
          >
            {starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {starting ? 'Starting…' : 'Start Run'}
          </button>
        </div>
      </div>
    </div>
  );
}
