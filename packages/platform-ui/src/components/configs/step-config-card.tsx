'use client';

import * as Accordion from '@radix-ui/react-accordion';
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PluginCombobox } from './plugin-combobox';
import { PluginPreviewCard } from './plugin-preview-card';
import { LazyScriptEditor } from './lazy-script-editor';
import type { StepConfig, AgentConfig } from '@mediforce/platform-core';

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

interface StepInfo {
  id: string;
  name: string;
  type: string;
}

interface StepConfigCardProps {
  step: StepInfo;
  config: StepConfig;
  onChange: (updated: StepConfig) => void;
  errors: Map<string, string[]>;
  readOnly: boolean;
  plugins: PluginEntry[];
  onBlur?: (fieldKey: string) => void;
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  disabled,
  hasError,
}: {
  label: string;
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  hasError?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <Select.Trigger
          className={cn(
            'flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            hasError && 'border-destructive',
          )}
          role="combobox"
        >
          <Select.Value />
          <Select.Icon>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
            position="popper"
            sideOffset={4}
          >
            <Select.Viewport className="p-1">
              {options.map((opt) => (
                <Select.Item
                  key={opt.value}
                  value={opt.value}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted data-[highlighted]:bg-muted"
                >
                  <Select.ItemText>{opt.label}</Select.ItemText>
                  <Select.ItemIndicator className="absolute right-2">
                    <Check className="h-3.5 w-3.5" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

const executorTypeOptions = [
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'Agent' },
  { value: 'script', label: 'Script' },
];

const autonomyLevelOptions = [
  { value: 'L0', label: 'L0 — No automation' },
  { value: 'L1', label: 'L1 — Assisted' },
  { value: 'L2', label: 'L2 — Supervised' },
  { value: 'L3', label: 'L3 — Autonomous with review' },
  { value: 'L4', label: 'L4 — Fully autonomous' },
];

const reviewerTypeOptions = [
  { value: 'none', label: 'None' },
  { value: 'human', label: 'Human' },
  { value: 'agent', label: 'Agent' },
];

const fallbackBehaviorOptions = [
  { value: 'escalate_to_human', label: 'Escalate to human' },
  { value: 'continue_with_flag', label: 'Continue with flag' },
  { value: 'pause', label: 'Pause' },
];

const runtimeOptions = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'bash', label: 'Bash' },
];

const scriptModeOptions = [
  { value: 'inline', label: 'Inline' },
  { value: 'container', label: 'Container' },
];

function detectScriptMode(agentConfig?: AgentConfig): 'inline' | 'container' {
  if (agentConfig?.inlineScript !== undefined && agentConfig.inlineScript.length > 0) return 'inline';
  if (agentConfig?.image) return 'container';
  return 'inline'; // default for new script steps
}

export function StepConfigCard({
  step,
  config,
  onChange,
  errors,
  readOnly,
  plugins,
  onBlur,
}: StepConfigCardProps) {
  const updateField = <K extends keyof StepConfig>(
    key: K,
    value: StepConfig[K],
  ) => {
    const updated = { ...config, [key]: value };

    // Auto-set plugin for script executor; clear for non-agent types
    if (key === 'executorType') {
      if (value === 'script') {
        updated.plugin = 'script-container';
      } else if (value !== 'agent') {
        updated.plugin = undefined;
      }
    }
    // Clear reviewer plugin when switching reviewer type away from agent
    if (key === 'reviewerType' && value !== 'agent') {
      updated.reviewerPlugin = undefined;
    }

    onChange(updated);
  };

  const fieldErrors = (fieldName: string): string[] =>
    errors.get(`${step.id}.${fieldName}`) ?? [];

  const executorPlugin = plugins.find((p) => p.name === config.plugin);
  const reviewerPlugin = plugins.find(
    (p) => p.name === config.reviewerPlugin,
  );

  return (
    <Accordion.Item value={step.id} className="border rounded-lg mb-2">
      <Accordion.Trigger className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors [&[data-state=open]>svg]:rotate-180">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {step.id}
          </span>
          <span>{step.name}</span>
          <span className="text-xs text-muted-foreground">({step.type})</span>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200" />
      </Accordion.Trigger>

      <Accordion.Content className="overflow-hidden data-[state=open]:animate-slideDown data-[state=closed]:animate-slideUp">
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          {/* Executor section */}
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Executor Type"
              value={config.executorType}
              onValueChange={(v) =>
                updateField('executorType', v as StepConfig['executorType'])
              }
              options={executorTypeOptions}
              disabled={readOnly}
              hasError={fieldErrors('executorType').length > 0}
            />
            <SelectField
              label="Autonomy Level"
              value={config.autonomyLevel ?? 'L4'}
              onValueChange={(v) =>
                updateField('autonomyLevel', v as StepConfig['autonomyLevel'])
              }
              options={autonomyLevelOptions}
              disabled={readOnly}
            />
          </div>

          {/* Plugin combobox - slides in when executorType is 'agent' (script always uses script-container) */}
          {config.executorType === 'agent' && (
            <div className="animate-in slide-in-from-top-2 duration-200 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Executor Plugin
              </label>
              <PluginCombobox
                plugins={plugins}
                value={config.plugin}
                onChange={(name) => updateField('plugin', name)}
                role="executor"
                disabled={readOnly}
              />
              {fieldErrors('plugin').length > 0 && (
                <p className="text-xs text-destructive">
                  {fieldErrors('plugin')[0]}
                </p>
              )}
              {executorPlugin && (
                <PluginPreviewCard plugin={executorPlugin} />
              )}
            </div>
          )}

          {/* Reviewer section */}
          <SelectField
            label="Reviewer Type"
            value={config.reviewerType ?? 'none'}
            onValueChange={(v) =>
              updateField('reviewerType', v as StepConfig['reviewerType'])
            }
            options={reviewerTypeOptions}
            disabled={readOnly}
          />

          {/* Reviewer plugin combobox */}
          {config.reviewerType === 'agent' && (
            <div className="animate-in slide-in-from-top-2 duration-200 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">
                Reviewer Plugin
              </label>
              <PluginCombobox
                plugins={plugins}
                value={config.reviewerPlugin}
                onChange={(name) => updateField('reviewerPlugin', name)}
                role="reviewer"
                disabled={readOnly}
              />
              {fieldErrors('reviewerPlugin').length > 0 && (
                <p className="text-xs text-destructive">
                  {fieldErrors('reviewerPlugin')[0]}
                </p>
              )}
              {reviewerPlugin && (
                <PluginPreviewCard plugin={reviewerPlugin} />
              )}
            </div>
          )}

          {/* Agent Config section — visible for agent executor with existing agentConfig */}
          {config.executorType === 'agent' && config.agentConfig && (
            <div className="animate-in slide-in-from-top-2 duration-200 space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Agent Config
              </h4>
              <div className="grid grid-cols-2 gap-4">
                {config.agentConfig.skill && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Skill</label>
                    <input
                      type="text"
                      value={config.agentConfig.skill}
                      disabled={readOnly}
                      readOnly
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                )}
                {config.agentConfig.model && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                    <input
                      type="text"
                      value={config.agentConfig.model}
                      disabled={readOnly}
                      readOnly
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                )}
                {config.agentConfig.command && (
                  <div className="space-y-1 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Command</label>
                    <input
                      type="text"
                      value={config.agentConfig.command}
                      disabled={readOnly}
                      readOnly
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                )}
              </div>
              {config.agentConfig.image && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Container Execution
                  </h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Docker Image</label>
                      <input
                        type="text"
                        value={config.agentConfig.image}
                        disabled={readOnly}
                        readOnly
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                    {config.agentConfig.repo && (
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">GitHub Repository</label>
                        <input
                          type="text"
                          value={config.agentConfig.repo}
                          disabled={readOnly}
                          readOnly
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    )}
                    {config.agentConfig.commit && (
                      <div className="space-y-1 col-span-2">
                        <label className="text-xs font-medium text-muted-foreground">Base Commit</label>
                        <input
                          type="text"
                          value={config.agentConfig.commit}
                          disabled={readOnly}
                          readOnly
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {config.agentConfig.skillsDir && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Skills Directory</label>
                  <input
                    type="text"
                    value={config.agentConfig.skillsDir}
                    disabled={readOnly}
                    readOnly
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              )}
            </div>
          )}

          {/* Script config — mode toggle between inline and container */}
          {config.executorType === 'script' && (
            <div className="animate-in slide-in-from-top-2 duration-200 space-y-3">
              <SelectField
                label="Script Mode"
                value={detectScriptMode(config.agentConfig)}
                onValueChange={(v) => {
                  const mode = v as 'inline' | 'container';
                  if (mode === 'inline') {
                    onChange({
                      ...config,
                      agentConfig: {
                        runtime: config.agentConfig?.runtime ?? 'python',
                        inlineScript: config.agentConfig?.inlineScript ?? '',
                      },
                    });
                  } else {
                    onChange({
                      ...config,
                      agentConfig: {
                        image: config.agentConfig?.image ?? '',
                        command: config.agentConfig?.command ?? '',
                      },
                    });
                  }
                }}
                options={scriptModeOptions}
                disabled={readOnly}
              />

              {detectScriptMode(config.agentConfig) === 'inline' ? (
                <div className="space-y-3">
                  <SelectField
                    label="Runtime"
                    value={config.agentConfig?.runtime ?? 'python'}
                    onValueChange={(v) => {
                      const agentConfig = config.agentConfig ?? {};
                      onChange({
                        ...config,
                        agentConfig: { ...agentConfig, runtime: v as 'javascript' | 'python' | 'r' | 'bash' },
                      });
                    }}
                    options={runtimeOptions}
                    disabled={readOnly}
                  />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">
                      Script
                    </label>
                    <LazyScriptEditor
                      value={config.agentConfig?.inlineScript ?? ''}
                      runtime={(config.agentConfig?.runtime as 'javascript' | 'python' | 'r' | 'bash') ?? 'python'}
                      onChange={(script) => {
                        const agentConfig = config.agentConfig ?? {};
                        onChange({
                          ...config,
                          agentConfig: {
                            ...agentConfig,
                            inlineScript: script,
                            runtime: agentConfig.runtime ?? 'python',
                          },
                        });
                      }}
                      readOnly={readOnly}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Docker Image</label>
                    <input
                      type="text"
                      value={config.agentConfig?.image ?? ''}
                      onChange={(event) => {
                        const agentConfig = config.agentConfig ?? {};
                        onChange({ ...config, agentConfig: { ...agentConfig, image: event.target.value } });
                      }}
                      placeholder="e.g. mediforce-script:community-digest"
                      disabled={readOnly}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Command</label>
                    <input
                      type="text"
                      value={config.agentConfig?.command ?? ''}
                      onChange={(event) => {
                        const agentConfig = config.agentConfig ?? {};
                        onChange({ ...config, agentConfig: { ...agentConfig, command: event.target.value } });
                      }}
                      placeholder="e.g. python /app/gather.py"
                      disabled={readOnly}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Optional fields */}
          <details className="group">
            <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              Advanced options
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Confidence Threshold
                </label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.1}
                  value={config.confidenceThreshold ?? ''}
                  onChange={(e) =>
                    updateField(
                      'confidenceThreshold',
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                  disabled={readOnly}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="0.0 - 1.0"
                />
              </div>

              <SelectField
                label="Fallback Behavior"
                value={config.fallbackBehavior ?? 'escalate_to_human'}
                onValueChange={(v) =>
                  updateField(
                    'fallbackBehavior',
                    v as StepConfig['fallbackBehavior'],
                  )
                }
                options={fallbackBehaviorOptions}
                disabled={readOnly}
              />

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Timeout (minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  value={config.timeoutMinutes ?? ''}
                  onChange={(e) =>
                    updateField(
                      'timeoutMinutes',
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                  disabled={readOnly}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="e.g. 30"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Model
                </label>
                <input
                  type="text"
                  value={config.model ?? ''}
                  onChange={(e) =>
                    updateField('model', e.target.value || undefined)
                  }
                  disabled={readOnly}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder="e.g. anthropic/claude-sonnet-4"
                />
              </div>
            </div>
          </details>
        </div>
      </Accordion.Content>
    </Accordion.Item>
  );
}
