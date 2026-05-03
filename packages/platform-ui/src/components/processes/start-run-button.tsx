'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { Play, ChevronDown, Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useAuth } from '@/contexts/auth-context';
import { startWorkflowRun } from '@/app/actions/processes';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { runPreflightChecks, type PreflightWarning } from '@/lib/preflight-checks';

interface StartRunButtonProps {
  workflowName: string;
  version?: number;
  showVersionPicker?: boolean;
  hasManualTrigger?: boolean;
  archived?: boolean;
}

export function StartRunButton({
  workflowName,
  version,
  showVersionPicker,
  hasManualTrigger = true,
  archived = false,
}: StartRunButtonProps) {
  const router = useRouter();
  const handle = useHandleFromPath();
  const { firebaseUser } = useAuth();
  const { definitions, effectiveVersion: hookEffectiveVersion } = useWorkflowDefinitions(workflowName);
  const { images: dockerImages, isAvailable: dockerAvailable } = useDockerImages();
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pendingVersion, setPendingVersion] = React.useState<number | undefined>(undefined);
  const [secretKeys, setSecretKeys] = React.useState<string[] | undefined>(undefined);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const effectiveVersion = version ?? hookEffectiveVersion;

  const effectiveDefinition = React.useMemo(
    () => definitions.find((d) => d.version === effectiveVersion),
    [definitions, effectiveVersion],
  );

  React.useEffect(() => {
    if (!handle || !workflowName || !firebaseUser) return;
    let cancelled = false;
    getWorkflowSecretKeys(handle, workflowName, firebaseUser.uid)
      .then((keys) => { if (!cancelled) setSecretKeys(keys); })
      .catch(() => { if (!cancelled) setSecretKeys(undefined); });
    return () => { cancelled = true; };
  }, [handle, workflowName, firebaseUser]);

  const warnings = React.useMemo(() => {
    if (!effectiveDefinition) return [];
    return runPreflightChecks(effectiveDefinition, {
      dockerImages,
      dockerAvailable,
      secretKeys,
    });
  }, [effectiveDefinition, dockerImages, dockerAvailable, secretKeys]);

  const hasWarnings = warnings.length > 0;

  React.useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  async function executeStart(v?: number) {
    const targetVersion = v ?? effectiveVersion;
    if (!firebaseUser || targetVersion === 0) return;

    setStarting(true);
    setError(null);
    setDropdownOpen(false);
    setDialogOpen(false);

    const result = await startWorkflowRun({
      definitionName: workflowName,
      definitionVersion: targetVersion,
      triggeredBy: firebaseUser.uid,
    });

    if (result.success && result.instanceId) {
      router.push(`/${handle}/workflows/${encodeURIComponent(workflowName)}/runs/${result.instanceId}`);
    } else {
      console.error('[StartRunButton] Failed to start run:', result.error);
      setError(result.error ?? 'Failed to start run');
      setStarting(false);
    }
  }

  function handleStart(v?: number) {
    if (hasWarnings) {
      setPendingVersion(v);
      setDialogOpen(true);
    } else {
      executeStart(v);
    }
  }

  const disabledReason: string | null = archived
    ? 'Workflow is archived'
    : !hasManualTrigger
      ? 'This workflow has no manual trigger'
      : effectiveVersion === 0
        ? 'No workflow version available'
        : null;
  const isDisabled = disabledReason !== null || starting;
  const tooltip = disabledReason ?? undefined;

  const errorBanner = error ? (
    <p className="mt-1 text-xs text-destructive max-w-xs truncate" title={error}>{error}</p>
  ) : null;

  const buttonClasses = hasWarnings && !isDisabled
    ? 'bg-amber-500 hover:bg-amber-600 text-white'
    : 'bg-primary text-primary-foreground hover:bg-primary/90';

  const buttonIcon = hasWarnings && !isDisabled
    ? <AlertTriangle className="h-3.5 w-3.5" />
    : starting
      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
      : <Play className="h-3.5 w-3.5" />;

  const preflightDialog = (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start gap-3 mb-4">
            <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-sm font-semibold">Pre-flight warnings</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-0.5">
                {warnings.length} issue{warnings.length !== 1 ? 's' : ''} detected. The run may fail.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto">
            <WarningGroup
              title="Missing Docker images"
              warnings={warnings.filter((w) => w.category === 'missing-image')}
            />
            <WarningGroup
              title="Missing secrets"
              warnings={warnings.filter((w) => w.category === 'missing-secret')}
            />
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <Dialog.Close className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </Dialog.Close>
            <button
              onClick={() => executeStart(pendingVersion)}
              className="rounded-md bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-sm font-medium text-white transition-colors"
            >
              Start anyway
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  if (!showVersionPicker || definitions.length <= 1) {
    return (
      <div>
        <button
          disabled={isDisabled}
          onClick={() => handleStart()}
          title={tooltip}
          aria-disabled={isDisabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
            buttonClasses,
            isDisabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          {buttonIcon}
          {starting ? 'Starting...' : 'Start Run'}
        </button>
        {errorBanner}
        {preflightDialog}
      </div>
    );
  }

  return (
    <div>
      <div className="relative inline-flex" ref={dropdownRef}>
        <button
          disabled={isDisabled}
          onClick={() => handleStart()}
          title={tooltip}
          aria-disabled={isDisabled}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-l-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
            buttonClasses,
            isDisabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          {buttonIcon}
          {starting ? 'Starting...' : 'Start Run'}
        </button>
        <button
          disabled={isDisabled}
          onClick={() => setDropdownOpen((prev) => !prev)}
          title={tooltip}
          aria-disabled={isDisabled}
          className={cn(
            'inline-flex items-center rounded-r-md border-l border-white/20 px-1.5 py-1.5 transition-colors',
            buttonClasses,
            isDisabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', dropdownOpen && 'rotate-180')} />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 z-10 min-w-[200px] rounded-md border bg-popover shadow-md">
            {definitions.filter((def) => def.archived !== true).map((def) => {
              const isEffective = def.version === effectiveVersion;

              return (
                <button
                  key={def.version}
                  onClick={() => handleStart(def.version)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors first:rounded-t-md last:rounded-b-md',
                    isEffective && 'bg-muted/30 font-medium',
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5 shrink-0', isEffective ? 'text-primary' : 'invisible')} />
                  <VersionLabel version={def.version} title={def.title} variant="inline" />
                  {isEffective && (
                    <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400 ml-auto shrink-0">
                      default
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {errorBanner}
      {preflightDialog}
    </div>
  );
}

function WarningGroup({ title, warnings }: { title: string; warnings: PreflightWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
      <ul className="space-y-1">
        {warnings.map((w, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs">
            <span className="text-muted-foreground shrink-0">•</span>
            <span>
              <span className="font-medium">{w.stepName}</span>
              <span className="text-muted-foreground"> — {w.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
