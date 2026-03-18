'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Play, X, Loader2, ChevronDown } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useAuth } from '@/contexts/auth-context';
import { startWorkflowRun } from '@/app/actions/processes';
import { cn } from '@/lib/utils';

interface StartRunDialogProps {
  workflowName: string;
  open: boolean;
  onClose: () => void;
}

export function StartRunDialog({
  workflowName,
  open,
  onClose,
}: StartRunDialogProps) {
  const router = useRouter();
  const { firebaseUser } = useAuth();
  const { definitions, latestVersion, loading } = useWorkflowDefinitions(workflowName);
  const [selectedVersion, setSelectedVersion] = React.useState<number | null>(null);
  const [versionPickerOpen, setVersionPickerOpen] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Derived: the version to use — selected override or latest
  const effectiveVersion = selectedVersion ?? latestVersion;

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setSelectedVersion(null);
      setVersionPickerOpen(false);
      setStarting(false);
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  async function handleStart() {
    if (!firebaseUser || effectiveVersion === 0) return;

    setStarting(true);
    setError(null);

    const result = await startWorkflowRun({
      definitionName: workflowName,
      definitionVersion: effectiveVersion,
      triggeredBy: firebaseUser.uid,
    });

    if (result.success && result.instanceId) {
      onClose();
      router.push(
        `/workflows/${encodeURIComponent(workflowName)}/runs/${result.instanceId}`,
      );
    } else {
      setError(result.error ?? 'Failed to start run');
      setStarting(false);
    }
  }

  const canStart = !loading && effectiveVersion > 0 && !starting;

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
              Workflow
            </label>
            <p className="text-sm mt-0.5">{workflowName}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Version
            </label>
            {loading ? (
              <div className="mt-1.5 h-10 rounded-md bg-muted animate-pulse" />
            ) : effectiveVersion === 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                No versions available.
              </p>
            ) : (
              <div className="mt-1.5 relative">
                <button
                  onClick={() => setVersionPickerOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <span>
                    <span className="font-mono">v{effectiveVersion}</span>
                    {(selectedVersion === null || selectedVersion === latestVersion) && (
                      <span className="ml-2 text-xs text-muted-foreground">(latest)</span>
                    )}
                  </span>
                  <ChevronDown className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    versionPickerOpen && 'rotate-180',
                  )} />
                </button>

                {versionPickerOpen && definitions.length > 1 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                    {definitions.map((def) => (
                      <button
                        key={def.version}
                        onClick={() => {
                          setSelectedVersion(def.version);
                          setVersionPickerOpen(false);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors first:rounded-t-md last:rounded-b-md',
                          def.version === effectiveVersion && 'bg-primary/5 font-medium',
                        )}
                      >
                        <span className="font-mono">v{def.version}</span>
                        {def.version === latestVersion && (
                          <span className="text-xs text-muted-foreground">latest</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
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
            disabled={!canStart}
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
