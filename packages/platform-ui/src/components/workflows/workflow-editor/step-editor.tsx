'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { User, Bot, Terminal, Users } from 'lucide-react';
import { useParams } from 'next/navigation';
import { usePlugins } from '@/hooks/use-plugins';
import { useAuth } from '@/contexts/auth-context';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';
import { cn } from '@/lib/utils';
import type { WorkflowStep } from '@mediforce/platform-core';
import {
  AUTONOMY_LEVELS,
  STEP_TYPES,
  STEP_TYPE_LABELS,
  FALLBACK_OPTIONS,
  KNOWN_MODELS,
  RUNTIME_OPTIONS,
} from './constants';
import { CoworkSection } from './cowork-section';
import { EditableField, Section } from './step-editor-fields';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function friendlyFieldError(message: string): string {
  if (/too small|>=1|at least 1/i.test(message)) return 'This field cannot be empty.';
  return message;
}

/** Fields that only make sense for 'agent' executor (not script). */
const AGENT_ONLY_FIELDS = ['model', 'skill', 'prompt', 'skillsDir', 'timeoutMs', 'timeoutMinutes', 'confidenceThreshold', 'fallbackBehavior'] as const;
/** Fields that only make sense for 'script' executor (not agent). */
const SCRIPT_ONLY_FIELDS = ['command', 'inlineScript', 'runtime', 'image', 'dockerfile', 'repo', 'commit', 'repoAuth'] as const;

export function buildExecutorChangePatch(step: WorkflowStep, targetExecutor: WorkflowStep['executor']): Partial<WorkflowStep> {
  const base: Partial<WorkflowStep> = { executor: targetExecutor };

  if (targetExecutor === 'human') {
    // Preserve autonomyLevel so it is restored if the user switches back to agent
    return { ...base, plugin: undefined, agent: undefined, cowork: undefined };
  }

  if (targetExecutor === 'agent') {
    const cleanedAgent = step.agent
      ? Object.fromEntries(Object.entries(step.agent).filter(([k]) => !SCRIPT_ONLY_FIELDS.includes(k as typeof SCRIPT_ONLY_FIELDS[number])))
      : undefined;
    return {
      ...base,
      allowedRoles: undefined,
      cowork: undefined,
      plugin: step.plugin ?? 'opencode-agent',
      agent: Object.keys(cleanedAgent ?? {}).length > 0 ? cleanedAgent as WorkflowStep['agent'] : undefined,
    };
  }

  if (targetExecutor === 'script') {
    const cleanedAgent = step.agent
      ? Object.fromEntries(Object.entries(step.agent).filter(([k]) => !AGENT_ONLY_FIELDS.includes(k as typeof AGENT_ONLY_FIELDS[number])))
      : undefined;
    return {
      ...base,
      allowedRoles: undefined,
      autonomyLevel: undefined,
      cowork: undefined,
      plugin: step.plugin ?? 'script-container',
      agent: Object.keys(cleanedAgent ?? {}).length > 0 ? cleanedAgent as WorkflowStep['agent'] : undefined,
    };
  }

  // cowork
  return {
    ...base,
    plugin: undefined,
    autonomyLevel: undefined,
    allowedRoles: undefined,
    agent: undefined,
    cowork: step.cowork ?? { agent: 'chat' },
  };
}

// ---------------------------------------------------------------------------
// StepIdField
// ---------------------------------------------------------------------------

function StepIdField({ currentId, onChange, error }: { currentId: string; onChange: (newId: string) => void; error?: string }) {
  const [draft, setDraft] = useState(currentId);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(currentId);
  }, [currentId, dirty]);

  const commit = useCallback(() => {
    const slug = draft.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slug && slug !== currentId) {
      onChange(slug);
    }
    setDraft(slug || currentId);
    setDirty(false);
  }, [draft, currentId, onChange]);

  return (
    <>
      <input
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        placeholder="step-id"
        className={cn(
          'w-full bg-transparent border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0.5 focus:outline-none transition-colors font-mono text-xs text-muted-foreground mt-0.5',
          error && 'border-red-400 focus:border-red-500',
        )}
      />
      {error && <p className="text-[11px] text-red-500 mt-0.5">{friendlyFieldError(error)}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// StepEditor
// ---------------------------------------------------------------------------

export function StepEditor({
  step,
  allSteps,
  workflowName,
  onChange,
  errors,
}: {
  step: WorkflowStep;
  allSteps: WorkflowStep[];
  workflowName?: string;
  onChange: (patch: Partial<WorkflowStep>) => void;
  errors?: Record<string, string>;
}) {
  const isNewStep = step.id.startsWith('new-step-');
  const { plugins } = usePlugins();
  const { firebaseUser } = useAuth();
  const { handle } = useParams<{ handle: string }>();
  const [secretKeys, setSecretKeys] = useState<string[]>([]);

  useEffect(() => {
    if (handle && workflowName && firebaseUser) {
      getWorkflowSecretKeys(handle, workflowName, firebaseUser.uid)
        .then(setSecretKeys)
        .catch((error) => console.error('Failed to load secret keys:', error));
    }
  }, [handle, workflowName, firebaseUser]);

  const inlineInput = 'w-full bg-transparent border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0.5 focus:outline-none transition-colors';
  const selectInline = 'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors cursor-pointer';
  const otherSteps = allSteps.filter((s) => s.id !== step.id);

  const isAgent = step.executor === 'agent' && step.type !== 'terminal';
  const isHuman = step.executor === 'human' && step.type !== 'terminal';
  const isReview = step.type === 'review';

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div>
        <input
          value={step.name}
          onChange={(e) => {
            const patch: Partial<WorkflowStep> = { name: e.target.value };
            if (isNewStep) patch.id = toSlug(e.target.value) || step.id;
            onChange(patch);
          }}
          className={cn(inlineInput, 'text-[15px] font-semibold text-foreground', errors?.name && 'border-red-400 focus:border-red-500')}
        />
        {errors?.name && <p className="text-[11px] text-red-500 mt-0.5">{friendlyFieldError(errors.name)}</p>}
        <StepIdField currentId={step.id} onChange={(newId) => onChange({ id: newId })} error={errors?.id} />
        <textarea
          value={step.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="Add description..."
          rows={2}
          className={cn(inlineInput, 'mt-2 text-sm text-muted-foreground resize-y leading-relaxed placeholder:italic')}
        />
      </div>

      {/* Executor toggle */}
      <div className="space-y-2">
        {step.type !== 'terminal' && (
          <div className="flex gap-1 p-0.5 rounded-lg bg-muted">
            {([
              { value: 'human', Icon: User, activeColor: 'bg-blue-500 text-white shadow-sm' },
              { value: 'agent', Icon: Bot, activeColor: 'bg-violet-500 text-white shadow-sm' },
              { value: 'script', Icon: Terminal, activeColor: 'bg-amber-500 text-white shadow-sm' },
              { value: 'cowork', Icon: Users, activeColor: 'bg-teal-500 text-white shadow-sm' },
            ] as const).map(({ value: ex, Icon, activeColor }) => (
              <button
                key={ex}
                onClick={() => onChange(buildExecutorChangePatch(step, ex))}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium capitalize transition-all',
                  step.executor === ex ? activeColor : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {ex}
              </button>
            ))}
          </div>
        )}

        {isAgent && (
          <div className="flex flex-col gap-0.5">
            {AUTONOMY_LEVELS.map((level) => (
              <button
                key={level.value}
                onClick={() => onChange({ autonomyLevel: level.value })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs text-left transition-all border',
                  step.autonomyLevel === level.value
                    ? 'border-violet-400 bg-violet-50 text-violet-700 font-medium dark:bg-violet-900/20 dark:text-violet-300'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50',
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Core config */}
      <div className="space-y-1.5">
        {isAgent && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground shrink-0">Plugin</span>
            <select
              value={step.plugin ?? ''}
              onChange={(e) => onChange({ plugin: e.target.value || undefined })}
              className={selectInline}
            >
              <option value="">None</option>
              {plugins.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
              {step.plugin && !plugins.some((p) => p.name === step.plugin) && (
                <option value={step.plugin}>{step.plugin}</option>
              )}
            </select>
          </div>
        )}
        {step.executor === 'script' && step.type !== 'terminal' && (
          <EditableField label="Plugin" value={step.plugin ?? ''} mono placeholder="e.g. script-container"
            onChange={(v) => onChange({ plugin: v || undefined })} />
        )}
        {isHuman && (
          <EditableField label="Roles" value={step.allowedRoles?.join(', ') ?? ''} placeholder="e.g. qa-lead, analyst"
            onChange={(v) => onChange({ allowedRoles: v ? v.split(',').map((r) => r.trim()).filter(Boolean) : undefined })} />
        )}
      </div>

      {/* Cowork config */}
      {step.executor === 'cowork' && (
        <CoworkSection step={step} onChange={onChange} isNewStep={isNewStep} />
      )}

      {/* Parameters */}
      {step.type !== 'terminal' && (
        <Section title="Parameters">
          <div className="space-y-3">
            {(step.params ?? []).map((param, idx) => (
              <div key={idx} className="rounded-lg border border-border/60 p-2.5 space-y-1.5 relative group">
                {/* Name + type row */}
                <div className="flex items-center gap-2">
                  <input
                    value={param.name}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], name: e.target.value };
                      onChange({ params: next });
                    }}
                    placeholder="param-name"
                    className="flex-1 bg-transparent text-xs font-mono font-medium border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors"
                  />
                  <select
                    value={param.type ?? 'string'}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], type: e.target.value as 'string' | 'number' | 'boolean' | 'date' };
                      onChange({ params: next });
                    }}
                    className="bg-transparent text-xs border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors cursor-pointer text-muted-foreground"
                  >
                    {(['string', 'number', 'boolean', 'date'] as const).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={param.required ?? false}
                      onChange={(e) => {
                        const next = [...(step.params ?? [])];
                        next[idx] = { ...next[idx], required: e.target.checked };
                        onChange({ params: next });
                      }}
                      className="w-3 h-3 accent-primary"
                    />
                    required
                  </label>
                  <button
                    onClick={() => {
                      const next = (step.params ?? []).filter((_, i) => i !== idx);
                      onChange({ params: next.length > 0 ? next : undefined });
                    }}
                    className="text-[10px] text-muted-foreground/30 hover:text-red-500 transition-colors shrink-0"
                  >
                    ×
                  </button>
                </div>
                {/* Description */}
                <input
                  value={param.description ?? ''}
                  onChange={(e) => {
                    const next = [...(step.params ?? [])];
                    next[idx] = { ...next[idx], description: e.target.value || undefined };
                    onChange({ params: next });
                  }}
                  placeholder="Description…"
                  className="w-full bg-transparent text-[11px] text-muted-foreground border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors placeholder:italic"
                />
                {/* Default value */}
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">default</span>
                  <input
                    value={param.default !== undefined ? String(param.default) : ''}
                    onChange={(e) => {
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], default: e.target.value || undefined };
                      onChange({ params: next });
                    }}
                    placeholder="—"
                    className="flex-1 bg-transparent text-[11px] font-mono border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors placeholder:text-muted-foreground/30"
                  />
                </div>
                {/* Options (for string enum dropdowns) */}
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">options</span>
                  <input
                    value={param.options?.join(', ') ?? ''}
                    onChange={(e) => {
                      const opts = e.target.value.split(',').map((o) => o.trim()).filter(Boolean);
                      const next = [...(step.params ?? [])];
                      next[idx] = { ...next[idx], options: opts.length > 0 ? opts : undefined };
                      onChange({ params: next });
                    }}
                    placeholder="comma-separated choices"
                    className="flex-1 bg-transparent text-[11px] border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors placeholder:italic placeholder:text-muted-foreground/30"
                  />
                </div>
              </div>
            ))}
            <button
              onClick={() => {
                const next = [...(step.params ?? []), { name: '', type: 'string' as const, required: false }];
                onChange({ params: next });
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              + Add parameter
            </button>
          </div>
        </Section>
      )}

      {/* Agent section */}
      {isAgent && (
        <Section title="Agent">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground shrink-0">Model</span>
            <select
              value={step.agent?.model ?? ''}
              onChange={(e) => onChange({ agent: { ...step.agent, model: e.target.value || undefined } })}
              className={selectInline}
            >
              {KNOWN_MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
              {step.agent?.model && !KNOWN_MODELS.some((m) => m.value === step.agent?.model) && (
                <option value={step.agent.model}>{step.agent.model}</option>
              )}
            </select>
          </div>
          <EditableField label="Skill" value={step.agent?.skill ?? ''} mono placeholder="skill-name"
            onChange={(v) => onChange({ agent: { ...step.agent, skill: v || undefined } })} />
          <EditableField label="Timeout" value={step.agent?.timeoutMinutes !== undefined ? `${step.agent.timeoutMinutes}` : ''} placeholder="30"
            onChange={(v) => onChange({ agent: { ...step.agent, timeoutMinutes: v ? Number(v) : undefined } })} suffix="min" />
          <EditableField label="Confidence" value={step.agent?.confidenceThreshold !== undefined ? `${step.agent.confidenceThreshold}` : ''} placeholder="0.85"
            onChange={(v) => onChange({ agent: { ...step.agent, confidenceThreshold: v ? Number(v) : undefined } })} />
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground shrink-0">Fallback</span>
            <select
              value={step.agent?.fallbackBehavior ?? ''}
              onChange={(e) => onChange({ agent: { ...step.agent, fallbackBehavior: (e.target.value || undefined) as 'escalate_to_human' | 'continue_with_flag' | 'pause' | undefined } })}
              className={selectInline}
            >
              {FALLBACK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="mt-2">
            <p className="text-[11px] text-muted-foreground mb-1">Prompt</p>
            <textarea
              value={step.agent?.prompt ?? ''}
              onChange={(e) => onChange({ agent: { ...step.agent, prompt: e.target.value || undefined } })}
              rows={3}
              placeholder="Instructions for the agent..."
              className="w-full text-xs bg-muted/50 rounded-md p-2.5 leading-relaxed border-0 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
          </div>
        </Section>
      )}

      {/* Review section */}
      {isReview && (
        <Section title="Review">
          <div className="flex gap-1 mb-2">
            {(['human', 'agent', 'none'] as const).map((rt) => (
              <button
                key={rt}
                onClick={() => onChange({ review: { ...step.review, type: rt } })}
                className={cn(
                  'flex-1 rounded-md py-1 text-[11px] font-medium capitalize transition-all border',
                  step.review?.type === rt
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-transparent bg-muted/50 text-muted-foreground hover:text-foreground',
                )}
              >
                {rt}
              </button>
            ))}
          </div>
          <EditableField label="Plugin" value={step.review?.plugin ?? ''} mono placeholder="review-plugin"
            onChange={(v) => onChange({ review: { ...step.review, plugin: v || undefined } })} />
          <EditableField label="Max iterations" value={step.review?.maxIterations !== undefined ? `${step.review.maxIterations}` : ''} placeholder="3"
            onChange={(v) => onChange({ review: { ...step.review, maxIterations: v ? Number(v) : undefined } })} />
          <EditableField label="Time box" value={step.review?.timeBoxDays !== undefined ? `${step.review.timeBoxDays}` : ''} placeholder="5"
            onChange={(v) => onChange({ review: { ...step.review, timeBoxDays: v ? Number(v) : undefined } })} suffix="days" />
        </Section>
      )}

      {/* Verdicts */}
      {isReview && (
        <Section title="Verdicts">
          <div className="space-y-1.5">
            {Object.entries(step.verdicts ?? {}).map(([verdictName, verdict]) => (
              <div key={verdictName} className="flex items-center gap-1.5">
                <input
                  value={verdictName}
                  onChange={(e) => {
                    const newVerdicts: Record<string, { target: string }> = {};
                    for (const [k, v] of Object.entries(step.verdicts ?? {})) {
                      newVerdicts[k === verdictName ? e.target.value : k] = v;
                    }
                    onChange({ verdicts: newVerdicts });
                  }}
                  className="bg-transparent text-xs font-medium border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-20"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <select
                  value={verdict.target}
                  onChange={(e) => {
                    const newVerdicts = { ...step.verdicts, [verdictName]: { ...verdict, target: e.target.value } };
                    onChange({ verdicts: newVerdicts });
                  }}
                  className={cn(selectInline, 'flex-1')}
                >
                  <option value="">Select step...</option>
                  {otherSteps.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const newVerdicts = { ...step.verdicts };
                    delete newVerdicts[verdictName];
                    onChange({ verdicts: Object.keys(newVerdicts).length > 0 ? newVerdicts : undefined });
                  }}
                  className="text-[10px] text-muted-foreground/40 hover:text-red-500 transition-colors"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => onChange({ verdicts: { ...step.verdicts, 'new-verdict': { target: '' } } })}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              + Add verdict
            </button>
          </div>
        </Section>
      )}

      {/* Runtime */}
      {(step.executor === 'script' || step.executor === 'agent') && step.type !== 'terminal' && (
        <Section title="Runtime">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs text-muted-foreground shrink-0">Runtime</span>
            <select
              value={step.agent?.runtime ?? ''}
              onChange={(e) => onChange({ agent: { ...step.agent, runtime: (e.target.value || undefined) as 'javascript' | 'python' | 'r' | 'bash' | undefined } })}
              className={selectInline}
            >
              {RUNTIME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <EditableField label="Command" value={step.agent?.command ?? ''} mono placeholder="run.sh"
            onChange={(v) => onChange({ agent: { ...step.agent, command: v || undefined } })} />
          <EditableField label="Image" value={step.agent?.image ?? ''} mono placeholder="docker-image:tag"
            onChange={(v) => onChange({ agent: { ...step.agent, image: v || undefined } })} />
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">Inline script</p>
            <textarea
              value={step.agent?.inlineScript ?? ''}
              onChange={(e) => onChange({ agent: { ...step.agent, inlineScript: e.target.value || undefined } })}
              rows={3}
              placeholder="Script code..."
              className="w-full text-[11px] font-mono bg-muted/50 rounded-md p-2 leading-relaxed border-0 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
          </div>
        </Section>
      )}

      {/* Environment variables */}
      {step.type !== 'terminal' && (
        <Section title="Environment">
          {Object.entries(step.env ?? {}).map(([key, val]) => (
            <div key={key} className="flex items-baseline gap-1.5">
              <input
                value={key}
                onChange={(e) => {
                  const newEnv: Record<string, string> = {};
                  for (const [k, v] of Object.entries(step.env ?? {})) {
                    newEnv[k === key ? e.target.value : k] = v;
                  }
                  onChange({ env: newEnv });
                }}
                className="bg-transparent text-xs font-mono text-muted-foreground border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-24"
              />
              <span className="text-xs text-muted-foreground">=</span>
              <div className="relative flex-1 group">
                <input
                  value={val}
                  onChange={(e) => onChange({ env: { ...step.env, [key]: e.target.value } })}
                  className="bg-transparent text-xs font-mono border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-full"
                />
                {secretKeys.length > 0 && !val.startsWith('{{') && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        onChange({ env: { ...step.env, [key]: `{{${e.target.value}}}` } });
                      }
                    }}
                    className="absolute right-0 top-0 h-full opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent text-xs cursor-pointer transition-opacity w-5"
                    title="Insert secret reference"
                  >
                    <option value="">🔑</option>
                    {secretKeys.map((sk) => (
                      <option key={sk} value={sk}>{sk}</option>
                    ))}
                  </select>
                )}
              </div>
              <button
                onClick={() => {
                  const newEnv = { ...step.env };
                  delete newEnv[key];
                  onChange({ env: Object.keys(newEnv).length > 0 ? newEnv : undefined });
                }}
                className="text-[10px] text-muted-foreground/40 hover:text-red-500 transition-colors"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ env: { ...step.env, NEW_VAR: '' } })}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add variable
          </button>
        </Section>
      )}

      {/* Step definition (collapsed) */}
      <details className="group">
        <summary className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 cursor-pointer hover:text-muted-foreground transition-colors select-none">
          Step definition
        </summary>
        <div className="mt-2 space-y-2.5">
          <div className="flex gap-1">
            {STEP_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => onChange({ type: t })}
                className={cn(
                  'flex-1 rounded-md py-1 text-[11px] font-medium transition-all border',
                  step.type === t
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-transparent bg-muted/50 text-muted-foreground hover:text-foreground',
                )}
              >
                {STEP_TYPE_LABELS[t] ?? t}
              </button>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}
