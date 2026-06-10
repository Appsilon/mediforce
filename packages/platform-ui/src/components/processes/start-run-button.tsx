'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { Play, FlaskConical, ChevronDown, Loader2, Check, AlertTriangle, X, CircleDot, KeyRound, FileInput } from 'lucide-react';
import { useWorkflowVersions, useWorkflowVersion } from '@/hooks/use-workflow-versions';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useAuth } from '@/contexts/auth-context';
import { mediforce } from '@/lib/mediforce';
import { useStartRun } from '@/hooks/use-run-mutations';
import { useWorkflowSecretKeysContext } from '@/hooks/use-workflow-secret-keys';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useOpenRouterCredits } from '@/hooks/use-openrouter-credits';
import { runPreflightChecks, type PreflightWarning } from '@/lib/preflight-checks';
import { ParamField } from '@/components/ui/param-field';
import type { TriggerInputField } from '@mediforce/platform-core';

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
  const { versions: definitions, effectiveVersion: hookEffectiveVersion } = useWorkflowVersions(workflowName, handle);
  const { images: dockerImages, isAvailable: dockerAvailable, isLoading: dockerLoading } = useDockerImages();
  const openRouterCredits = useOpenRouterCredits();
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const startMutation = useStartRun();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pendingVersion, setPendingVersion] = React.useState<number | undefined>(undefined);
  const secretKeysCtx = useWorkflowSecretKeysContext();
  const [localSecretKeys, setLocalSecretKeys] = React.useState<string[] | undefined>(undefined);
  const [localNsSecretKeys, setLocalNsSecretKeys] = React.useState<string[]>([]);
  const [localSecretsLoading, setLocalSecretsLoading] = React.useState(true);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const effectiveVersion = version ?? hookEffectiveVersion;
  const preflightVersion = pendingVersion ?? effectiveVersion;
  const { definition: effectiveDefinition } = useWorkflowVersion(
    workflowName,
    handle,
    preflightVersion,
  );

  const hasContext = secretKeysCtx !== null;
  const uid = firebaseUser?.uid;

  const triggerInput: TriggerInputField[] = effectiveDefinition?.triggerInput ?? [];
  const hasTriggerInput = triggerInput.length > 0;

  const [inputValues, setInputValues] = React.useState<Record<string, unknown>>({});

  React.useEffect(() => {
    const fields = effectiveDefinition?.triggerInput ?? [];
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.default !== undefined) {
        initial[field.name] = field.default;
      } else if (field.type === 'boolean') {
        initial[field.name] = false;
      } else if (field.type === 'multiselect') {
        initial[field.name] = [];
      } else {
        initial[field.name] = '';
      }
    }
    setInputValues(initial);
  }, [effectiveDefinition]);

  React.useEffect(() => {
    if (hasContext) {
      setLocalSecretsLoading(false);
      return;
    }
    if (!handle || !workflowName || !uid) return;
    let cancelled = false;
    setLocalSecretsLoading(true);
    Promise.all([
      mediforce.secrets.list({ namespace: handle, workflow: workflowName }),
      mediforce.secrets.list({ namespace: handle }),
    ])
      .then(([wf, ns]) => {
        if (cancelled) return;
        setLocalSecretKeys(wf.keys);
        setLocalNsSecretKeys(ns.keys);
        setLocalSecretsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLocalSecretKeys(undefined);
        setLocalNsSecretKeys([]);
        setLocalSecretsLoading(false);
      });
    return () => { cancelled = true; };
  }, [hasContext, handle, workflowName, uid]);

  const secretKeys = hasContext ? secretKeysCtx.getKeys(workflowName) : localSecretKeys;
  const namespaceSecretKeys = hasContext ? secretKeysCtx.namespaceKeys : localNsSecretKeys;
  const secretKeysLoading = hasContext ? secretKeysCtx.loading : localSecretsLoading;

  const warnings = React.useMemo(() => {
    if (!effectiveDefinition) return [];
    return runPreflightChecks(effectiveDefinition, {
      dockerImages,
      dockerAvailable,
      secretKeys,
      namespaceSecretKeys,
      openRouterCredits: openRouterCredits.isLoading ? undefined : {
        available: openRouterCredits.available,
        remaining: openRouterCredits.remaining,
      },
    });
  }, [effectiveDefinition, dockerImages, dockerAvailable, secretKeys, namespaceSecretKeys, openRouterCredits.isLoading, openRouterCredits.available, openRouterCredits.remaining]);

  const preflightLoading = dockerLoading || secretKeysLoading || openRouterCredits.isLoading;
  const hasWarnings = warnings.length > 0;
  const missingSecretKeys = warnings.filter((w) => w.category === 'missing-secret').map((w) => w.resource);

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

  async function executeStart(v?: number, dryRun?: boolean) {
    const targetVersion = v ?? effectiveVersion;
    if (!firebaseUser || targetVersion === null || targetVersion === 0) return;

    setStarting(true);
    setError(null);
    setDropdownOpen(false);
    setDialogOpen(false);

    const payload = hasTriggerInput ? buildPayload() : undefined;

    try {
      const result = await startMutation.mutateAsync({
        namespace: handle,
        definitionName: workflowName,
        definitionVersion: targetVersion,
        triggerName: 'manual',
        triggeredBy: firebaseUser.uid,
        payload,
        ...(dryRun ? { dryRun: true } : {}),
      });
      router.push(`/${handle}/workflows/${encodeURIComponent(workflowName)}/runs/${result.run.id}`);
    } catch (err) {
      console.error('[StartRunButton] Failed to start run:', err);
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      // Reset on every code path — under the legacy Server Action the implicit
      // revalidate-on-success remounted the component; the headless migration
      // (PR #520) lost that side-effect, so success without unmount left the
      // button stuck on "Starting...".
      setStarting(false);
    }
  }

  const requiredInputMissing = triggerInput.some((field) => {
    if (!field.required) return false;
    const val = inputValues[field.name];
    if (val === '' || val === undefined) return true;
    if (field.type === 'multiselect' && Array.isArray(val) && val.length === 0) return true;
    return false;
  });

  function buildPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const field of triggerInput) {
      const raw = inputValues[field.name];
      if (raw === '' || raw === undefined) continue;
      if (Array.isArray(raw) && raw.length === 0) continue;
      if (field.type === 'number') {
        const num = parseFloat(String(raw));
        if (!isNaN(num)) {
          payload[field.name] = num;
        }
      } else {
        payload[field.name] = raw;
      }
    }
    return payload;
  }

  function handleStart(v?: number) {
    if (hasTriggerInput || hasWarnings) {
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
  const isDisabled = disabledReason !== null || starting || preflightLoading;
  const tooltip = preflightLoading ? 'Checking workflow readiness...' : (disabledReason ?? undefined);

  const errorBanner = error ? (
    <p className="mt-1 text-xs text-destructive max-w-xs truncate" title={error}>{error}</p>
  ) : null;

  const buttonClasses = 'bg-primary text-primary-foreground hover:bg-primary/90';

  const buttonIcon = starting || preflightLoading
    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
    : <Play className="h-3.5 w-3.5" />;

  const buttonLabel = starting ? 'Starting...' : preflightLoading ? 'Checking...' : 'Start Run';

  const warningBadge = hasWarnings && !isDisabled ? (
    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
      {warnings.length}
    </span>
  ) : null;

  const startButtonLabel = hasWarnings ? 'Start anyway' : 'Start run';

  const preflightDialog = (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start gap-3 mb-4">
            <div className="rounded-full bg-muted p-2">
              {hasTriggerInput ? (
                <FileInput className="h-5 w-5 text-primary" />
              ) : (
                <CircleDot className="h-5 w-5 text-amber-500" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-sm font-semibold">
                {hasTriggerInput ? 'Run input' : 'Before you start'}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-0.5">
                {hasTriggerInput
                  ? 'Provide input values for this workflow run.'
                  : `${warnings.length} item${warnings.length !== 1 ? 's' : ''} to review for a smooth run.`}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {hasWarnings && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
                </span>
                {missingSecretKeys.length > 0 && (
                  <button
                    onClick={() => {
                      setDialogOpen(false);
                      const setup = encodeURIComponent(missingSecretKeys.join(','));
                      const wf = encodeURIComponent(workflowName);
                      router.push(`/${handle}/workflows/${wf}?tab=secrets&setup=${setup}`);
                    }}
                    className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <KeyRound className="h-3 w-3" />
                    Set secrets
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                <WarningGroup
                  title="Missing Docker images"
                  warnings={warnings.filter((w) => w.category === 'missing-image')}
                />
                <WarningGroup
                  title="Missing secrets"
                  warnings={warnings.filter((w) => w.category === 'missing-secret')}
                />
                <WarningGroup
                  title="LLM credits"
                  warnings={warnings.filter((w) => w.category === 'low-credits')}
                />
              </div>
            </div>
          )}

          {hasTriggerInput && (
            <div className="space-y-4 max-h-80 overflow-y-auto">
              {triggerInput.map((field) => (
                <ParamField
                  key={field.name}
                  param={field}
                  value={inputValues[field.name]}
                  onChange={(value) => setInputValues((prev) => ({ ...prev, [field.name]: value }))}
                  disabled={starting}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-5">
            <div className="flex-1" />
            <Dialog.Close className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </Dialog.Close>
            <button
              onClick={() => executeStart(pendingVersion, true)}
              disabled={hasTriggerInput && requiredInputMissing}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/20 dark:hover:bg-violet-900/40 px-3 py-1.5 text-sm font-medium text-violet-700 dark:text-violet-300 transition-colors',
                hasTriggerInput && requiredInputMissing && 'opacity-50 cursor-not-allowed',
              )}
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Dry Run
            </button>
            <button
              onClick={() => executeStart(pendingVersion)}
              disabled={hasTriggerInput && requiredInputMissing}
              className={cn(
                'rounded-md bg-primary hover:bg-primary/90 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
                hasTriggerInput && requiredInputMissing && 'opacity-50 cursor-not-allowed',
              )}
            >
              {startButtonLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  if (!showVersionPicker || definitions.length <= 1) {
    return (
      <div>
        <div className="relative inline-flex">
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
            {buttonLabel}
          </button>
          {warningBadge}
        </div>
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
          {buttonLabel}
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
        {warningBadge}

        {dropdownOpen && (
          <div className="absolute right-0 top-full mt-1 z-30 min-w-[200px] rounded-md border bg-popover shadow-md">
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

function formatStepList(names: string[], max: number = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')}, +${String(names.length - max)} more`;
}

function WarningGroup({ title, warnings }: { title: string; warnings: PreflightWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">{title}</p>
      <ul className="space-y-2.5">
        {warnings.map((w, idx) => (
          <li key={idx} className="text-xs">
            <div className="flex items-start gap-2">
              <span className="text-amber-500 shrink-0 mt-0.5">•</span>
              <div>
                <p className="font-mono font-medium">{w.message || w.resource}</p>
                <p className="text-muted-foreground mt-0.5">Used by: {formatStepList(w.stepNames)}</p>
                <p className="text-muted-foreground/70 mt-0.5">{w.hint}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
