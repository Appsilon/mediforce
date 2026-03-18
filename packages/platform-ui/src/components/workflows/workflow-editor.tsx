'use client';

import { useState, useCallback } from 'react';
import * as Accordion from '@radix-ui/react-accordion';
import * as Select from '@radix-ui/react-select';
import {
  ChevronDown, Check, Plus, Trash2, GripVertical, Save,
  User, Bot, Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

interface WorkflowEditorProps {
  workflowName: string;
  initialDefinition?: WorkflowDefinition;
  onSaved?: (name: string, version: number) => void;
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; version: number }
  | { status: 'error'; message: string };

const AUTONOMY_LEVELS = [
  { value: 'L0', label: 'L0', description: 'Manual only' },
  { value: 'L1', label: 'L1', description: 'Human review' },
  { value: 'L2', label: 'L2', description: 'Auto if confident' },
  { value: 'L3', label: 'L3', description: 'Auto + fallback' },
  { value: 'L4', label: 'L4', description: 'Full autonomy' },
] as const;

const STEP_TYPES = ['creation', 'review', 'decision', 'terminal'] as const;
const EXECUTOR_TYPES = ['human', 'agent', 'script'] as const;

function makeEmptyStep(index: number): WorkflowStep {
  return {
    id: `step-${index + 1}`,
    name: `Step ${index + 1}`,
    type: 'creation',
    executor: 'human',
  };
}

export function WorkflowEditor({ workflowName, initialDefinition, onSaved }: WorkflowEditorProps) {
  const [name] = useState(initialDefinition?.name ?? workflowName);
  const [description, setDescription] = useState(initialDefinition?.description ?? '');
  const [steps, setSteps] = useState<WorkflowStep[]>(
    initialDefinition?.steps ?? [makeEmptyStep(0)],
  );
  const [triggers] = useState(initialDefinition?.triggers ?? [{ type: 'manual' as const, name: 'Start' }]);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  const updateStep = useCallback((index: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((step, idx) => idx === index ? { ...step, ...patch } : step));
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const addStep = useCallback(() => {
    setSteps((prev) => [...prev, makeEmptyStep(prev.length)]);
  }, []);

  async function handleSave() {
    setSaveState({ status: 'saving' });

    // Build transitions from step order (sequential by default)
    const transitions = steps
      .filter((_, idx) => idx < steps.length - 1)
      .map((step, idx) => ({
        from: step.id,
        to: steps[idx + 1].id,
      }));

    // Add verdict-based transitions for review steps
    for (const step of steps) {
      if (step.type === 'review' && step.verdicts) {
        for (const [, verdict] of Object.entries(step.verdicts)) {
          if (verdict.target && !transitions.some((t) => t.from === step.id && t.to === verdict.target)) {
            transitions.push({ from: step.id, to: verdict.target });
          }
        }
      }
    }

    const input = {
      name,
      description: description || undefined,
      steps,
      transitions,
      triggers,
      roles: initialDefinition?.roles,
      env: initialDefinition?.env,
      notifications: initialDefinition?.notifications,
      metadata: initialDefinition?.metadata,
      repo: initialDefinition?.repo,
      url: initialDefinition?.url,
    };

    const result = await saveWorkflowDefinition(input);
    if (result.success) {
      setSaveState({ status: 'saved', version: result.version });
      onSaved?.(result.name, result.version);
    } else {
      setSaveState({ status: 'error', message: result.error });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Workflow</label>
          <p className="text-lg font-semibold">{name}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="wf-desc">Description</label>
          <textarea
            id="wf-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this workflow do?"
            rows={2}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Steps</h2>
          <button
            onClick={addStep}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add step
          </button>
        </div>

        <Accordion.Root type="multiple" defaultValue={steps.map((_, idx) => `step-${idx}`)} className="space-y-2">
          {steps.map((step, index) => (
            <StepEditor
              key={index}
              step={step}
              index={index}
              allSteps={steps}
              onChange={(patch) => updateStep(index, patch)}
              onRemove={() => removeStep(index)}
              canRemove={steps.length > 1}
            />
          ))}
        </Accordion.Root>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2 border-t">
        <button
          onClick={handleSave}
          disabled={saveState.status === 'saving'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors',
            saveState.status === 'saving' && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Save className="h-4 w-4" />
          {saveState.status === 'saving' ? 'Saving...' : 'Save'}
        </button>
        <span className="text-xs text-muted-foreground">Saving creates a new version — existing runs are unaffected.</span>

        {saveState.status === 'saved' && (
          <span className="text-sm text-green-600 dark:text-green-400">
            Saved as v{saveState.version}
          </span>
        )}
        {saveState.status === 'error' && (
          <span className="text-sm text-destructive">{saveState.message}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step editor card
// ---------------------------------------------------------------------------

interface StepEditorProps {
  step: WorkflowStep;
  index: number;
  allSteps: WorkflowStep[];
  onChange: (patch: Partial<WorkflowStep>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function StepEditor({ step, index, allSteps, onChange, onRemove, canRemove }: StepEditorProps) {
  const executorIcon = step.executor === 'human' ? User : step.executor === 'agent' ? Bot : Terminal;
  const ExecutorIcon = executorIcon;

  return (
    <Accordion.Item value={`step-${index}`} className="rounded-lg border bg-card overflow-hidden">
      <Accordion.Header className="flex">
        <Accordion.Trigger className="flex flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors group">
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium flex-1">{step.name || `Step ${index + 1}`}</span>

          <ExecutorBadge executor={step.executor} />

          {step.executor === 'agent' && step.autonomyLevel && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {step.autonomyLevel}
            </span>
          )}

          <StepTypeBadge type={step.type} />

          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </Accordion.Trigger>
      </Accordion.Header>

      <Accordion.Content className="border-t px-4 py-4 space-y-4 data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down overflow-hidden">
        {/* Row 1: name + id */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={step.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">ID</label>
            <input
              value={step.id}
              onChange={(e) => onChange({ id: e.target.value })}
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Row 2: Step type */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Step type</label>
          <div className="flex gap-1.5 mt-1">
            {STEP_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => onChange({ type: t })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors border',
                  step.type === t
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Row 3: Executor — the main toggle */}
        {step.type !== 'terminal' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Executor</label>
            <div className="flex gap-1 mt-1 p-1 rounded-lg bg-muted">
              {EXECUTOR_TYPES.map((ex) => {
                const Icon = ex === 'human' ? User : ex === 'agent' ? Bot : Terminal;
                const colors: Record<string, string> = {
                  human: 'bg-blue-500 text-white',
                  agent: 'bg-violet-500 text-white',
                  script: 'bg-amber-500 text-white',
                };
                return (
                  <button
                    key={ex}
                    onClick={() => onChange({ executor: ex })}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium capitalize transition-all',
                      step.executor === ex
                        ? colors[ex]
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {ex}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Row 4: Autonomy level (agent only) */}
        {step.executor === 'agent' && step.type !== 'terminal' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Autonomy level</label>
            <div className="flex gap-1 mt-1">
              {AUTONOMY_LEVELS.map((level) => (
                <button
                  key={level.value}
                  onClick={() => onChange({ autonomyLevel: level.value })}
                  title={level.description}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded-md px-2 py-2 text-xs font-medium transition-all border',
                    step.autonomyLevel === level.value
                      ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300'
                      : 'border-transparent bg-muted text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="font-bold">{level.label}</span>
                  <span className="text-[10px] opacity-75">{level.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Plugin (agent only) */}
        {step.executor === 'agent' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Plugin</label>
            <input
              value={step.plugin ?? ''}
              onChange={(e) => onChange({ plugin: e.target.value || undefined })}
              placeholder="e.g. supply-data-collector"
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Allowed roles (human only) */}
        {step.executor === 'human' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Allowed roles (comma-separated)</label>
            <input
              value={step.allowedRoles?.join(', ') ?? ''}
              onChange={(e) => onChange({
                allowedRoles: e.target.value ? e.target.value.split(',').map((r) => r.trim()).filter(Boolean) : undefined,
              })}
              placeholder="e.g. qa-lead, analyst"
              className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Verdicts (review steps only) */}
        {step.type === 'review' && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Verdicts</label>
            <div className="mt-1 space-y-2">
              {Object.entries(step.verdicts ?? {}).map(([verdictName, verdict]) => (
                <div key={verdictName} className="flex items-center gap-2">
                  <input
                    value={verdictName}
                    readOnly
                    className="w-28 rounded-md border bg-muted px-2 py-1 text-xs font-mono"
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <SelectField
                    value={verdict.target}
                    onValueChange={(target) => {
                      const newVerdicts = { ...step.verdicts, [verdictName]: { ...verdict, target } };
                      onChange({ verdicts: newVerdicts });
                    }}
                    options={allSteps.filter((s) => s.id !== step.id).map((s) => ({ value: s.id, label: s.name }))}
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  const newName = `verdict-${Object.keys(step.verdicts ?? {}).length + 1}`;
                  const newVerdicts = { ...step.verdicts, [newName]: { target: '' } };
                  onChange({ verdicts: newVerdicts });
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                + Add verdict
              </button>
            </div>
          </div>
        )}

        {/* Advanced section (collapsible) */}
        {step.executor === 'agent' && (
          <details className="group">
            <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              Advanced agent settings
            </summary>
            <div className="mt-3 space-y-3 pl-3 border-l-2 border-muted">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Model</label>
                  <input
                    value={step.agent?.model ?? ''}
                    onChange={(e) => onChange({ agent: { ...step.agent, model: e.target.value || undefined } })}
                    placeholder="claude-sonnet-4-6"
                    className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Timeout (min)</label>
                  <input
                    type="number"
                    value={step.agent?.timeoutMinutes ?? ''}
                    onChange={(e) => onChange({ agent: { ...step.agent, timeoutMinutes: e.target.value ? Number(e.target.value) : undefined } })}
                    placeholder="30"
                    className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Confidence threshold</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={step.agent?.confidenceThreshold ?? ''}
                    onChange={(e) => onChange({ agent: { ...step.agent, confidenceThreshold: e.target.value ? Number(e.target.value) : undefined } })}
                    placeholder="0.85"
                    className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Fallback behavior</label>
                  <select
                    value={step.agent?.fallbackBehavior ?? ''}
                    onChange={(e) => onChange({ agent: { ...step.agent, fallbackBehavior: (e.target.value || undefined) as WorkflowStep['agent'] extends { fallbackBehavior?: infer F } ? F : never } })}
                    className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Default</option>
                    <option value="escalate_to_human">Escalate to human</option>
                    <option value="continue_with_flag">Continue with flag</option>
                    <option value="pause">Pause</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Skill</label>
                <input
                  value={step.agent?.skill ?? ''}
                  onChange={(e) => onChange({ agent: { ...step.agent, skill: e.target.value || undefined } })}
                  placeholder="supply-analysis"
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Prompt</label>
                <textarea
                  value={step.agent?.prompt ?? ''}
                  onChange={(e) => onChange({ agent: { ...step.agent, prompt: e.target.value || undefined } })}
                  rows={3}
                  placeholder="Instructions for the agent..."
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </details>
        )}

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
          <input
            value={step.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value || undefined })}
            placeholder="What does this step do?"
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Remove */}
        {canRemove && (
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
            Remove step
          </button>
        )}
      </Accordion.Content>
    </Accordion.Item>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ExecutorBadge({ executor }: { executor: string }) {
  const colors: Record<string, string> = {
    human: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    agent: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    script: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', colors[executor] ?? 'bg-muted text-muted-foreground')}>
      {executor}
    </span>
  );
}

function StepTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    creation: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    review: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
    decision: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    terminal: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', colors[type] ?? 'bg-muted text-muted-foreground')}>
      {type}
    </span>
  );
}

function SelectField({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className="flex items-center justify-between gap-1 rounded-md border bg-background px-2 py-1 text-xs min-w-[120px]">
        <Select.Value placeholder="Select step..." />
        <Select.Icon>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md" position="popper" sideOffset={4}>
          <Select.Viewport className="p-1">
            {options.map((opt) => (
              <Select.Item key={opt.value} value={opt.value} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none cursor-pointer hover:bg-accent">
                <Select.ItemIndicator>
                  <Check className="h-3 w-3" />
                </Select.ItemIndicator>
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
