'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { useRouter } from 'next/navigation';
import { Play, FlaskConical, ChevronDown, Loader2, Check, AlertTriangle, X, CircleDot, KeyRound, FileInput, ExternalLink } from 'lucide-react';
import { useWorkflowVersions, useWorkflowVersion } from '@/hooks/use-workflow-versions';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useAuth } from '@/contexts/auth-context';
import { mediforce } from '@/lib/mediforce';
import { useStartRun } from '@/hooks/use-run-mutations';
import { useWorkflowSecretKeysContext } from '@/hooks/use-workflow-secret-keys';
import { describeRoles, useWorkflowAccess } from '@/hooks/use-workflow-access';
import { VersionLabel } from '@/components/ui/version-label';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { cn } from '@/lib/utils';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useOpenRouterCredits } from '@/hooks/use-openrouter-credits';
import { useNamespaceAdminContact } from '@/hooks/use-namespace-admin-contact';
import { useModelValidation } from '@/hooks/use-model-validation';
import { runPreflightChecks, findSkippedChecks, type PreflightWarning } from '@/lib/preflight-checks';
import { ParamField } from '@/components/ui/param-field';
import { buildTriggerPayload, hasInvalidObjectInput } from '@/lib/trigger-input-payload';
import { VERIFY_WORKFLOW_URL, type TriggerInputField } from '@mediforce/platform-core';

interface StartRunButtonProps {
  workflowName: string;
  version?: number;
  showVersionPicker?: boolean;
  hasManualTrigger?: boolean;
  /**
   * Whether this caller holds the workflow's `run` roles (ADR-0019), when the
   * caller already knows — the catalog gets it on the same read that returned
   * the card, so a list of thirty does not become thirty requests. Left
   * undefined, the button asks the server itself.
   */
  mayRun?: boolean;
  archived?: boolean;
  label?: string;
  disabled?: boolean;
  /**
   * Tooltip shown while `disabled` is true and no more specific internal
   * reason (archived, trigger stopped, no version) applies — e.g. the caller
   * gating the button on unsaved required fields.
   */
  disabledTooltip?: string;
  /**
   * Saves the workflow before starting and reports where it landed. The run must
   * start in the workspace the save targeted, which is not always the route.
   */
  onBeforeStart?: () => Promise<{ version: number; namespace: string } | undefined>;
  /**
   * Whether to run workflow-scoped preflight fetches (versions, secrets, model
   * validation). Set false when the workflow does not exist yet — e.g. the new
   * workflow page, where `onBeforeStart` saves it first — so those fetches don't
   * 404 against a not-yet-created workflow.
   */
  preflightEnabled?: boolean;
  /**
   * Fixes the run mode this button starts. When set, the button carries the
   * intent (e.g. "Save & Dry Run" -> 'dry-run') so the preflight dialog no
   * longer re-asks Dry Run vs Start — it shows a single confirm for this mode.
   * Left undefined, the button is mode-agnostic and the dialog offers both.
   */
  mode?: 'production' | 'dry-run';
}

export function StartRunButton({
  workflowName,
  version,
  showVersionPicker,
  hasManualTrigger = true,
  mayRun: mayRunFromCaller,
  archived = false,
  label,
  disabled = false,
  disabledTooltip,
  onBeforeStart,
  preflightEnabled = true,
  mode,
}: StartRunButtonProps) {
  const router = useRouter();
  const handle = useHandleFromPath();
  const { user } = useAuth();
  // Empty name disables the workflow-scoped queries (see useWorkflowVersions),
  // so a not-yet-created workflow never triggers a 404 preflight.
  const preflightName = preflightEnabled ? workflowName : '';
  const { versions: definitions, effectiveVersion: hookEffectiveVersion } = useWorkflowVersions(preflightName, handle);
  const { images: dockerImages, isAvailable: dockerAvailable, isLoading: dockerLoading } = useDockerImages();
  // ADR-0019 `run`. Asked of the server rather than derived here: a grant
  // narrowed to this workflow is not in the session, so a locally computed
  // answer would grey the button out for people the gate would have admitted.
  // `null` while unresolved leaves the button enabled — the server refuses if
  // it must, and hiding the action on an unanswered read is the worse error.
  const { access: workflowAccess, caller: accessCaller } = useWorkflowAccess(handle, preflightName, {
    enabled: mayRunFromCaller === undefined,
  });
  const mayRun = mayRunFromCaller ?? accessCaller?.mayRun ?? null;
  const runRoles = workflowAccess?.run ?? [];
  const openRouterCredits = useOpenRouterCredits();
  const adminContact = useNamespaceAdminContact(handle);
  const [starting, setStarting] = React.useState(false);
  const [runningBeforeStart, setRunningBeforeStart] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const startMutation = useStartRun();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [pendingVersion, setPendingVersion] = React.useState<number | undefined>(undefined);
  const secretKeysCtx = useWorkflowSecretKeysContext();
  const [localSecretKeys, setLocalSecretKeys] = React.useState<string[] | undefined>(undefined);
  const [localNsSecretKeys, setLocalNsSecretKeys] = React.useState<string[]>([]);
  const [localSecretsLoading, setLocalSecretsLoading] = React.useState(true);
  const effectiveVersion = version ?? hookEffectiveVersion;
  const preflightVersion = pendingVersion ?? effectiveVersion;
  const { definition: effectiveDefinition, loading: definitionLoading } = useWorkflowVersion(
    preflightName,
    handle,
    preflightVersion,
  );
  const modelValidation = useModelValidation(effectiveDefinition);

  const hasContext = secretKeysCtx !== null;
  const uid = user?.id;

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
    if (!handle || !preflightName || !uid) return;
    let cancelled = false;
    setLocalSecretsLoading(true);
    Promise.all([
      mediforce.secrets.list({ namespace: handle, workflow: preflightName }),
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
  }, [hasContext, handle, preflightName, uid]);

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
        effectiveRemaining: openRouterCredits.effectiveRemaining,
      },
      handle,
      workflowName,
      version: preflightVersion ?? undefined,
      adminEmail: adminContact.email ?? undefined,
      modelValidation: modelValidation.isLoading ? undefined : { unknown: modelValidation.unknown },
    });
  }, [effectiveDefinition, dockerImages, dockerAvailable, secretKeys, namespaceSecretKeys, openRouterCredits.isLoading, openRouterCredits.available, openRouterCredits.effectiveRemaining, handle, workflowName, adminContact.email, modelValidation.isLoading, modelValidation.unknown]);

  // A probe that failed produces no warnings, exactly like one that passed, so a
  // skipped check has to be said out loud rather than read as a pass.
  const skippedChecks = React.useMemo(() => {
    if (!effectiveDefinition) return [];
    return findSkippedChecks(effectiveDefinition, {
      dockerAvailable,
      creditsFailed: openRouterCredits.error !== undefined,
      modelValidationFailed: modelValidation.error !== null,
    });
  }, [effectiveDefinition, dockerAvailable, openRouterCredits.error, modelValidation.error]);

  const preflightLoading = preflightEnabled && (definitionLoading || dockerLoading || secretKeysLoading || openRouterCredits.isLoading || adminContact.isLoading || modelValidation.isLoading);
  const hasWarnings = warnings.length > 0;
  const missingSecretKeys = warnings.filter((w) => w.category === 'missing-secret').map((w) => w.resource);

  // Appended to whichever description the dialog shows: a run with trigger
  // input still needs to hear that a probe never completed.
  const skippedChecksNote =
    preflightLoading === false && skippedChecks.length > 0
      ? ' Some checks could not run, so the readiness warnings may be incomplete.'
      : '';

  // Where the run starts. The route handle is right everywhere except the
  // new-workflow page, where `onBeforeStart` may have saved elsewhere.
  const savedNamespaceRef = React.useRef<string | null>(null);

  async function executeStart(v?: number, dryRun?: boolean) {
    const targetVersion = v ?? effectiveVersion;
    const startNamespace = savedNamespaceRef.current ?? handle;
    if (!user || targetVersion === null || targetVersion === 0) return;

    setStarting(true);
    setError(null);
    setDropdownOpen(false);
    setDialogOpen(false);

    const payload = hasTriggerInput ? buildTriggerPayload(triggerInput, inputValues) : undefined;

    try {
      const result = await startMutation.mutateAsync({
        namespace: startNamespace,
        definitionName: workflowName,
        definitionVersion: targetVersion,
        triggerName: 'manual',
        triggeredBy: user.id,
        payload,
        ...(dryRun ? { dryRun: true } : {}),
      });
      router.push(`/${startNamespace}/workflows/${encodeURIComponent(workflowName)}/runs/${result.run.id}`);
    } catch (err) {
      console.error('[StartRunButton] Failed to start run:', err);
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
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

  // An `object` field holding text the payload validator would reject (ADR-0012)
  // guarantees a 400, so block the submit the same way a missing required field does.
  const inputBlocked = hasTriggerInput
    && (requiredInputMissing || hasInvalidObjectInput(triggerInput, inputValues));

  async function handleStart(v?: number) {
    let targetVersion = v;
    if (onBeforeStart) {
      setRunningBeforeStart(true);
      setError(null);
      try {
        const saved = await onBeforeStart();
        targetVersion = saved?.version;
        savedNamespaceRef.current = saved?.namespace ?? null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save before starting');
        setRunningBeforeStart(false);
        return;
      }
      setRunningBeforeStart(false);
      if (targetVersion === undefined) return;
    }

    const versionChanged = targetVersion !== undefined && targetVersion !== effectiveVersion;
    if (hasTriggerInput || hasWarnings || (versionChanged && !onBeforeStart)) {
      setPendingVersion(targetVersion);
      setDialogOpen(true);
    } else {
      executeStart(targetVersion, mode === 'dry-run');
    }
  }

  const disabledReason: string | null = archived
    ? 'Workflow is archived'
    : !hasManualTrigger
      ? 'Manual trigger is stopped — start it in the Triggers tab to run this workflow by hand'
      : effectiveVersion === 0 && !onBeforeStart
        ? 'No workflow version available'
        : mayRun === false
          ? `Starting this workflow is restricted to ${describeRoles(runRoles)} — see the Access tab`
          : null;
  const isDisabled = disabledReason !== null || starting || preflightLoading || runningBeforeStart || disabled;
  const tooltip = preflightLoading
    ? 'Checking workflow readiness...'
    : (disabledReason ?? (disabled ? disabledTooltip : undefined));

  const errorBanner = error ? (
    <p className="mt-1 text-xs text-destructive max-w-xs truncate" title={error}>{error}</p>
  ) : null;

  const isDryRun = mode === 'dry-run';
  const buttonClasses = isDryRun
    ? 'border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/20 dark:text-violet-300 dark:hover:bg-violet-900/40'
    : 'bg-primary text-primary-foreground hover:bg-primary/90';

  const buttonIcon = starting || preflightLoading || runningBeforeStart
    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
    : isDryRun
      ? <FlaskConical className="h-3.5 w-3.5" />
      : <Play className="h-3.5 w-3.5" />;

  const buttonLabel = starting ? 'Starting...' : runningBeforeStart ? 'Saving...' : preflightLoading ? 'Checking...' : (label ?? 'Start Run');

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
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-lg border bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
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
                  : preflightLoading
                    ? 'Checking workflow readiness...'
                    : `${warnings.length} item${warnings.length !== 1 ? 's' : ''} to review for a smooth run.`}
                {skippedChecksNote}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {(hasWarnings || preflightLoading) && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 mb-4">
              {preflightLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500 shrink-0" />
                  <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                    Checking models and dependencies...
                  </span>
                </div>
              ) : (
              <>
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
                  <WarningGroup
                    title="Unknown models"
                    warnings={warnings.filter((w) => w.category === 'unknown-model')}
                  />
                </div>
              </>
              )}
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
            <a
              href={VERIFY_WORKFLOW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              How verification works
              <ExternalLink className="h-3 w-3" />
            </a>
            <div className="flex-1" />
            <Dialog.Close className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </Dialog.Close>
            {mode !== 'production' && (
              <button
                onClick={() => executeStart(pendingVersion, true)}
                disabled={inputBlocked}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-900/20 dark:hover:bg-violet-900/40 px-3 py-1.5 text-sm font-medium text-violet-700 dark:text-violet-300 transition-colors',
                  inputBlocked && 'opacity-50 cursor-not-allowed',
                )}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                Dry Run
              </button>
            )}
            {mode !== 'dry-run' && (
              <button
                onClick={() => executeStart(pendingVersion)}
                disabled={inputBlocked}
                className={cn(
                  'rounded-md bg-primary hover:bg-primary/90 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors',
                  inputBlocked && 'opacity-50 cursor-not-allowed',
                )}
              >
                {startButtonLabel}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  if (!showVersionPicker || definitions.length <= 1) {
    return (
      <div>
        <InstantTooltip label={tooltip}>
          <div className="relative inline-flex">
            <button
              disabled={isDisabled}
              onClick={() => handleStart()}
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
        </InstantTooltip>
        {errorBanner}
        {preflightDialog}
      </div>
    );
  }

  return (
    <div>
      <InstantTooltip label={tooltip}>
      <div className="relative inline-flex">
        <button
          disabled={isDisabled}
          onClick={() => handleStart()}
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
        <Popover.Root open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <Popover.Trigger asChild>
            <button
              disabled={isDisabled}
              aria-disabled={isDisabled}
              className={cn(
                'inline-flex items-center rounded-r-md border-l border-white/20 px-1.5 py-1.5 transition-colors',
                buttonClasses,
                isDisabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', dropdownOpen && 'rotate-180')} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[200px] max-h-60 overflow-y-auto rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95"
            >
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
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {warningBadge}
      </div>
      </InstantTooltip>
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
                {w.actions.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    {w.actions.map((action) => (
                      <a
                        key={action.label}
                        href={action.href}
                        target={action.href.startsWith('mailto:') || action.href.startsWith('/') ? undefined : '_blank'}
                        rel={action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="text-primary hover:underline"
                      >
                        {action.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

