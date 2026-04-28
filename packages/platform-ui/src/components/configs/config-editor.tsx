'use client';

import { useState, useMemo, useCallback } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import Link from 'next/link';
import { Save, CheckCircle, XCircle, Pencil, Clock, Play, Webhook, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePlugins } from '@/hooks/use-plugins';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';
import { StepConfigCard } from './step-config-card';
import { ConfigValidationBanner } from './config-validation-banner';
import { saveConfig } from '@/app/actions/configs';
import type { ProcessDefinition, StepConfig } from '@mediforce/platform-core';

interface PluginMetadata {
  name: string;
  description: string;
  inputDescription: string;
  outputDescription: string;
  roles: ('executor' | 'reviewer')[];
}

interface PluginEntry {
  name: string;
  metadata?: PluginMetadata;
}

interface ConfigEditorProps {
  processName: string;
  definition: ProcessDefinition;
  initialConfig?: {
    processName: string;
    configName: string;
    configVersion: string;
    stepConfigs: StepConfig[];
  };
  readOnly?: boolean;
  onSaved?: (configName: string, configVersion: string) => void;
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; configName: string; configVersion: string }
  | { status: 'error'; message: string };

function buildDefaultStepConfigs(
  definition: ProcessDefinition,
): StepConfig[] {
  return definition.steps.map((step) => ({
    stepId: step.id,
    executorType: 'human' as const,
    autonomyLevel: 'L4' as const,
    reviewerType: 'none' as const,
  }));
}

export function ConfigEditor({
  processName,
  definition,
  initialConfig,
  readOnly = false,
  onSaved,
}: ConfigEditorProps) {
  const { plugins } = usePlugins();
  const handle = useHandleFromPath();

  // Form state
  const [configName, setConfigName] = useState(
    initialConfig?.configName ?? '',
  );
  const [configVersion, setConfigVersion] = useState(
    // Clone workflow: clear version to force new version name
    initialConfig && !readOnly ? '' : (initialConfig?.configVersion ?? ''),
  );
  const [stepConfigs, setStepConfigs] = useState<StepConfig[]>(() => {
    if (initialConfig) {
      return structuredClone(initialConfig.stepConfigs);
    }
    return buildDefaultStepConfigs(definition);
  });

  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<Map<string, string[]>>(
    () => new Map(),
  );
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);

  // Validation
  const validationErrors = useMemo(() => {
    const errors: string[] = [...serverErrors];
    for (const sc of stepConfigs) {
      if (sc.executorType === 'agent' && !sc.plugin) {
        errors.push(`Step "${sc.stepId}": executor plugin is required when type is agent`);
      }
      if (sc.reviewerType === 'agent' && !sc.reviewerPlugin) {
        errors.push(`Step "${sc.stepId}": reviewer plugin is required when type is agent`);
      }
    }
    return errors;
  }, [stepConfigs, serverErrors]);

  const validationWarnings = useMemo(() => {
    const warnings: string[] = [...serverWarnings];
    for (const sc of stepConfigs) {
      if (
        sc.executorType === 'agent' &&
        sc.reviewerType === 'agent' &&
        sc.plugin &&
        sc.reviewerPlugin &&
        sc.plugin === sc.reviewerPlugin
      ) {
        warnings.push(
          `Step "${sc.stepId}": same plugin used as executor and reviewer (self-review)`,
        );
      }
    }
    return warnings;
  }, [stepConfigs, serverWarnings]);

  const hasHardErrors = validationErrors.length > 0;
  const canSave =
    !readOnly &&
    configName.trim() !== '' &&
    configVersion.trim() !== '' &&
    !hasHardErrors &&
    saveState.status !== 'saving';

  // Update a single step's config
  const updateStepConfig = useCallback(
    (stepId: string, updated: StepConfig) => {
      setStepConfigs((prev) =>
        prev.map((sc) => (sc.stepId === stepId ? updated : sc)),
      );
      // Clear server errors when user makes changes
      setServerErrors([]);
      setServerWarnings([]);
      if (saveState.status !== 'idle') {
        setSaveState({ status: 'idle' });
      }
    },
    [saveState.status],
  );

  const handleSave = async () => {
    setSaveState({ status: 'saving' });
    setServerErrors([]);
    setServerWarnings([]);

    try {
      const trimmedName = configName.trim();
      const trimmedVersion = configVersion.trim();

      const result = await saveConfig({
        processName,
        configName: trimmedName,
        configVersion: trimmedVersion,
        stepConfigs,
      });

      if (result.success) {
        setSaveState({
          status: 'saved',
          configName: trimmedName,
          configVersion: trimmedVersion,
        });
        onSaved?.(trimmedName, trimmedVersion);
      } else if (result.conflict) {
        setSaveState({
          status: 'error',
          message: 'This version already exists. Choose a different version name.',
        });
      } else {
        if (result.errors?.length) {
          setServerErrors(result.errors);
        }
        if (result.warnings?.length) {
          setServerWarnings(result.warnings);
        }
        setSaveState({
          status: 'error',
          message: result.error ?? 'Validation failed',
        });
      }
    } catch (err) {
      setSaveState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Save failed',
      });
    }
  };

  const cloneUrl = initialConfig
    ? routes.configNew(handle, { process: processName, cloneConfig: initialConfig.configName, cloneVersion: String(initialConfig.configVersion) })
    : undefined;

  return (
    <div className="space-y-6">
      {/* Config name and version */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="config-name" className="text-sm font-medium">
            Config Name
          </label>
          <input
            id="config-name"
            type="text"
            value={configName}
            onChange={(e) => {
              setConfigName(e.target.value);
              if (saveState.status !== 'idle') setSaveState({ status: 'idle' });
            }}
            disabled={readOnly}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="e.g. default, pilot-v2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="config-version" className="text-sm font-medium">
            Version
          </label>
          <input
            id="config-version"
            type="text"
            value={configVersion}
            onChange={(e) => {
              setConfigVersion(e.target.value);
              if (saveState.status !== 'idle') setSaveState({ status: 'idle' });
            }}
            disabled={readOnly}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="e.g. 1.0, pilot-v2"
          />
        </div>
      </div>

      {/* Side-by-side layout */}
      <div className="flex gap-6">
        {/* Left: definition steps overview */}
        <div className="w-64 shrink-0 border-r pr-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Process Steps
          </h3>
          {definition.steps.map((step) => (
            <div key={step.id} className="py-2 text-sm">
              <span className="font-mono text-xs">{step.id}</span>
              <span className="text-muted-foreground ml-2">{step.name}</span>
              <span className="text-xs text-muted-foreground ml-1">
                ({step.type})
              </span>
            </div>
          ))}

          {/* Triggers */}
          {definition.triggers.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Triggers
              </h3>
              {definition.triggers.map((trigger) => (
                <div key={trigger.name} className="py-2 text-sm flex items-start gap-2">
                  {trigger.type === 'cron' && <Clock className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
                  {trigger.type === 'manual' && <Play className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
                  {trigger.type === 'webhook' && <Webhook className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
                  {trigger.type === 'event' && <Zap className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
                  <div>
                    <div className="font-mono text-xs">{trigger.name}</div>
                    <div className="text-xs text-muted-foreground">{trigger.type}</div>
                    {trigger.schedule && (
                      <code className="text-xs bg-muted px-1 py-0.5 rounded mt-0.5 inline-block">
                        {trigger.schedule}
                      </code>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: accordion config cards */}
        <div className="flex-1">
          <Accordion.Root
            type="multiple"
            defaultValue={definition.steps.map((s) => s.id)}
          >
            {definition.steps.map((step) => {
              const stepConfig = stepConfigs.find(
                (sc) => sc.stepId === step.id,
              ) ?? {
                stepId: step.id,
                executorType: 'human' as const,
                autonomyLevel: 'L4' as const,
                reviewerType: 'none' as const,
              };

              return (
                <StepConfigCard
                  key={step.id}
                  step={step}
                  config={stepConfig}
                  onChange={(updated) => updateStepConfig(step.id, updated)}
                  errors={fieldErrors}
                  readOnly={readOnly}
                  plugins={plugins}
                />
              );
            })}
          </Accordion.Root>
        </div>
      </div>

      {/* Validation banner */}
      <ConfigValidationBanner
        errors={validationErrors}
        warnings={validationWarnings}
      />

      {/* Save / Read-only actions */}
      <div className="flex items-center gap-3">
        {readOnly ? (
          cloneUrl && (
            <Link
              href={cloneUrl}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit (new version)
            </Link>
          )
        ) : (
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <Save className="h-3.5 w-3.5" />
            {saveState.status === 'saving' ? 'Saving...' : 'Save Configuration'}
          </button>
        )}

        {saveState.status === 'saved' && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            Saved — {saveState.configName} v{saveState.configVersion}
          </span>
        )}

        {saveState.status === 'error' && (
          <span className="flex items-center gap-1.5 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            {saveState.message}
          </span>
        )}
      </div>
    </div>
  );
}
