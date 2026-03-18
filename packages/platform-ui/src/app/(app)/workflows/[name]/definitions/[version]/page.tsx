'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, X, Save, User, Bot, Terminal } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
import { StartRunButton } from '@/components/processes/start-run-button';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

const EXECUTOR_TYPES = ['human', 'agent', 'script'] as const;
const AUTONOMY_LEVELS = [
  { value: 'L0', label: 'L0 — Manual only' },
  { value: 'L1', label: 'L1 — Human review' },
  { value: 'L2', label: 'L2 — Auto if confident' },
  { value: 'L3', label: 'L3 — Auto + fallback' },
  { value: 'L4', label: 'L4 — Full autonomy' },
] as const;

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; version: number }
  | { status: 'error'; message: string };

export default function WorkflowDefinitionVersionPage() {
  const { name, version } = useParams<{ name: string; version: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);
  const versionNumber = parseInt(version, 10);

  const { definitions, loading } = useWorkflowDefinitions(decodedName);
  const definition = definitions.find((def) => def.version === versionNumber) ?? null;

  const [editing, setEditing] = useState(false);
  const [editedSteps, setEditedSteps] = useState<WorkflowStep[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  const currentSteps = editing ? editedSteps : (definition?.steps ?? []);
  const selectedStep = currentSteps.find((s) => s.id === selectedStepId) ?? null;

  const enableEditing = useCallback(() => {
    if (!definition) return;
    setEditedSteps(structuredClone(definition.steps));
    setEditing(true);
    setSaveState({ status: 'idle' });
  }, [definition]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditedSteps([]);
    setSaveState({ status: 'idle' });
  }, []);

  const updateStep = useCallback((stepId: string, patch: Partial<WorkflowStep>) => {
    setEditedSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    );
  }, []);

  const handleSave = useCallback(async () => {
    if (!definition) return;
    setSaveState({ status: 'saving' });

    const transitions = editedSteps
      .filter((_, idx) => idx < editedSteps.length - 1)
      .map((step, idx) => ({ from: step.id, to: editedSteps[idx + 1].id }));

    for (const step of editedSteps) {
      if (step.type === 'review' && step.verdicts) {
        for (const verdict of Object.values(step.verdicts)) {
          if (verdict.target && !transitions.some((t) => t.from === step.id && t.to === verdict.target)) {
            transitions.push({ from: step.id, to: verdict.target });
          }
        }
      }
    }

    const result = await saveWorkflowDefinition({
      name: definition.name,
      description: definition.description,
      steps: editedSteps,
      transitions,
      triggers: definition.triggers,
      roles: definition.roles,
      env: definition.env,
      notifications: definition.notifications,
      metadata: definition.metadata,
      repo: definition.repo,
      url: definition.url,
    });

    if (result.success) {
      setSaveState({ status: 'saved', version: result.version });
      setTimeout(() => {
        router.push(`/workflows/${name}/definitions/${result.version}`);
      }, 500);
    } else {
      setSaveState({ status: 'error', message: result.error });
    }
  }, [definition, editedSteps, name, router]);

  // Build a WorkflowDefinition from edited steps for the diagram
  const diagramDefinition: WorkflowDefinition | null = definition
    ? { ...definition, steps: currentSteps }
    : null;

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (!loading && definition === null) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Definition v{version} for &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link href={`/workflows/${name}`} className="underline">Back to workflow</Link>
      </div>
    );
  }

  if (definition === null || diagramDefinition === null) return null;

  return (
    <div className="flex flex-1 flex-col relative">
      {/* Header */}
      <div className="border-b px-6 py-4 sticky top-0 z-30 bg-background">
        <Link
          href={`/workflows/${name}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {decodedName}
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-headline font-semibold">{decodedName}</h1>
              <span className="font-mono bg-muted px-2 py-0.5 text-sm rounded">
                v{definition.version}
              </span>
              {editing && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  editing
                </span>
              )}
            </div>
            {definition.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{definition.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                {/* Cancel — ghost button, clearly "discard" */}
                <button
                  onClick={() => {
                    if (confirm('Discard unsaved changes?')) cancelEditing();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>

                {/* Save — primary action */}
                <button
                  onClick={handleSave}
                  disabled={saveState.status === 'saving'}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                    saveState.status === 'saving' && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saveState.status === 'saving' ? 'Saving...' : 'Save new version'}
                </button>

                {saveState.status === 'saved' && (
                  <span className="text-sm text-green-600 dark:text-green-400">Saved v{saveState.version}</span>
                )}
                {saveState.status === 'error' && (
                  <span className="text-sm text-destructive">{saveState.message}</span>
                )}
              </>
            ) : (
              <>
                {/* Edit — enters edit mode */}
                <button
                  onClick={enableEditing}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>

                {/* Start Run */}
                <StartRunButton workflowName={decodedName} version={definition.version} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Content: diagram + optional side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Diagram */}
        <div className={cn('flex-1 p-6', selectedStep && 'pr-0')}>
          <WorkflowDiagram
            definition={diagramDefinition}
            className="border-0"
            onNodeClick={(stepId) => setSelectedStepId(stepId === selectedStepId ? null : stepId)}
            selectedStepId={selectedStepId}
          />
        </div>

        {/* Side panel */}
        {selectedStep && (
          <div className="w-80 shrink-0 border-l bg-background overflow-y-auto">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{editing ? 'Edit step' : 'Step details'}</h2>
                <button
                  onClick={() => setSelectedStepId(null)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {editing ? (
                <StepEditor
                  step={selectedStep}
                  onChange={(patch) => updateStep(selectedStep.id, patch)}
                />
              ) : (
                <StepDetail step={selectedStep} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step editor (edit mode side panel)
// ---------------------------------------------------------------------------

const STEP_TYPES = ['creation', 'review', 'decision', 'terminal'] as const;
const FALLBACK_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'escalate_to_human', label: 'Escalate to human' },
  { value: 'continue_with_flag', label: 'Continue with flag' },
  { value: 'pause', label: 'Pause' },
] as const;

function StepEditor({ step, onChange }: { step: WorkflowStep; onChange: (patch: Partial<WorkflowStep>) => void }) {
  const inlineInput = 'w-full bg-transparent border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0.5 focus:outline-none transition-colors';
  const fieldInput = 'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-24';

  const isAgent = step.executor === 'agent' && step.type !== 'terminal';
  const isHuman = step.executor === 'human' && step.type !== 'terminal';
  const isReview = step.type === 'review';
  const hasAgent = step.agent && Object.values(step.agent).some((v) => v !== undefined);

  return (
    <div className="space-y-5">
      {/* ─── Identity — mirrors StepDetail header ─── */}
      <div>
        <input
          value={step.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className={cn(inlineInput, 'text-[15px] font-semibold text-foreground')}
        />
        <p className="font-mono text-xs text-muted-foreground mt-0.5">{step.id}</p>
        <textarea
          value={step.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="Add description..."
          rows={2}
          className={cn(inlineInput, 'mt-2 text-sm text-muted-foreground resize-y leading-relaxed placeholder:italic')}
        />
      </div>

      {/* ─── Badges row — executor is a toggle, type + autonomy are clickable ─── */}
      <div className="space-y-2">
        {/* Executor — Human/Agent toggle (script steps show agent/human options too) */}
        {step.type !== 'terminal' && step.executor !== 'script' && (
          <div className="flex gap-1 p-0.5 rounded-lg bg-muted">
            {(['human', 'agent'] as const).map((ex) => {
              const Icon = ex === 'human' ? User : Bot;
              const activeColors: Record<string, string> = {
                human: 'bg-blue-500 text-white shadow-sm',
                agent: 'bg-violet-500 text-white shadow-sm',
              };
              return (
                <button
                  key={ex}
                  onClick={() => onChange({ executor: ex })}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium capitalize transition-all',
                    step.executor === ex ? activeColors[ex] : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {ex}
                </button>
              );
            })}
          </div>
        )}

        {/* Autonomy — the #1 tunable */}
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

      {/* ─── Core config — mirrors StepDetail fields, but editable ─── */}
      <div className="space-y-1.5">
        {isAgent && (
          <EditableField label="Plugin" value={step.plugin ?? ''} mono placeholder="e.g. supply-data-collector"
            onChange={(v) => onChange({ plugin: v || undefined })} />
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

      {/* ─── Agent section — mirrors StepDetail "Agent" section ─── */}
      {isAgent && (
        <Section title="Agent">
          <EditableField label="Model" value={step.agent?.model ?? ''} mono placeholder="claude-sonnet-4-6"
            onChange={(v) => onChange({ agent: { ...step.agent, model: v || undefined } })} />
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
              className="bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors cursor-pointer"
            >
              {FALLBACK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {(hasAgent || true) && (
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
          )}
        </Section>
      )}

      {/* ─── Review section ─── */}
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

      {/* ─── Verdicts (review steps) ─── */}
      {isReview && (
        <Section title="Verdicts">
          <div className="space-y-1.5">
            {Object.entries(step.verdicts ?? {}).map(([verdictName, verdict]) => (
              <div key={verdictName} className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{verdictName}</span>
                <span className="text-xs text-muted-foreground">→</span>
                <input
                  value={verdict.target}
                  onChange={(e) => {
                    const newVerdicts = { ...step.verdicts, [verdictName]: { ...verdict, target: e.target.value } };
                    onChange({ verdicts: newVerdicts });
                  }}
                  className="bg-transparent text-xs font-mono border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-24"
                />
              </div>
            ))}
            <button
              onClick={() => {
                const name = `verdict-${Object.keys(step.verdicts ?? {}).length + 1}`;
                onChange({ verdicts: { ...step.verdicts, [name]: { target: '' } } });
              }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              + Add verdict
            </button>
          </div>
        </Section>
      )}

      {/* ─── Runtime — for script/agent steps with runtime config ─── */}
      {(step.executor === 'script' || step.executor === 'agent') && step.type !== 'terminal' && (
        <Section title="Runtime">
          <EditableField label="Runtime" value={step.agent?.runtime ?? ''} placeholder="javascript"
            onChange={(v) => onChange({ agent: { ...step.agent, runtime: (v || undefined) as 'javascript' | 'python' | 'r' | 'bash' | undefined } })} />
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

      {/* ─── Environment variables ─── */}
      {step.type !== 'terminal' && (
        <Section title="Environment">
          {Object.entries(step.env ?? {}).map(([key, val]) => (
            <EditableField key={key} label={key} value={val} mono
              onChange={(v) => {
                const newEnv = { ...step.env };
                if (v) { newEnv[key] = v; } else { delete newEnv[key]; }
                onChange({ env: Object.keys(newEnv).length > 0 ? newEnv : undefined });
              }} />
          ))}
          <button
            onClick={() => {
              const key = `VAR_${Object.keys(step.env ?? {}).length + 1}`;
              onChange({ env: { ...step.env, [key]: '' } });
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            + Add variable
          </button>
        </Section>
      )}

      {/* ─── Step definition (collapsed — rarely changed) ─── */}
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
                  'flex-1 rounded-md py-1 text-[11px] font-medium capitalize transition-all border',
                  step.type === t
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-transparent bg-muted/50 text-muted-foreground hover:text-foreground',
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <EditableField label="Step ID" value={step.id} mono onChange={(v) => onChange({ id: v })} />
          {step.type !== 'terminal' && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">Automated step</span>
              <button
                onClick={() => onChange({ executor: step.executor === 'script' ? 'human' : 'script' })}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                  step.executor === 'script' ? 'bg-amber-500' : 'bg-muted',
                )}
              >
                <span className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                  step.executor === 'script' ? 'translate-x-4' : 'translate-x-0',
                )} />
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function EditableField({ label, value, onChange, mono, placeholder, suffix }: {
  label: string; value: string; onChange: (v: string) => void;
  mono?: boolean; placeholder?: string; suffix?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-baseline gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-28',
            mono && 'font-mono',
            !value && 'placeholder:text-muted-foreground/40 placeholder:italic',
          )}
        />
        {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step detail (read-only side panel)
// ---------------------------------------------------------------------------

const FALLBACK_LABELS: Record<string, string> = {
  escalate_to_human: 'Escalate to human',
  continue_with_flag: 'Continue with flag',
  pause: 'Pause',
};

function StepDetail({ step }: { step: WorkflowStep }) {
  const hasAgent = step.agent && Object.values(step.agent).some((v) => v !== undefined);
  const hasReview = step.review && Object.values(step.review).some((v) => v !== undefined);
  const hasVerdicts = step.verdicts && Object.keys(step.verdicts).length > 0;

  return (
    <div className="space-y-5">
      {/* Identity */}
      <div>
        <p className="text-[15px] font-semibold">{step.name}</p>
        <p className="font-mono text-xs text-muted-foreground mt-0.5">{step.id}</p>
        {step.description && (
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{step.description}</p>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <StepTypeBadge type={step.type} />
        {step.type !== 'terminal' && <ExecutorBadge executor={step.executor} />}
        {step.type !== 'terminal' && step.autonomyLevel && (
          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
            {step.autonomyLevel}
          </span>
        )}
      </div>

      {/* Core config */}
      <div className="space-y-1.5">
        {step.plugin && <Field label="Plugin" value={step.plugin} mono />}
        {step.allowedRoles && step.allowedRoles.length > 0 && (
          <Field label="Roles" value={step.allowedRoles.join(', ')} />
        )}
      </div>

      {/* Agent config */}
      {hasAgent && step.executor === 'agent' && (
        <Section title="Agent">
          {step.agent!.model && <Field label="Model" value={step.agent!.model} mono />}
          {step.agent!.skill && <Field label="Skill" value={step.agent!.skill} mono />}
          {step.agent!.timeoutMinutes !== undefined && <Field label="Timeout" value={`${step.agent!.timeoutMinutes} min`} />}
          {step.agent!.confidenceThreshold !== undefined && <Field label="Confidence" value={`${step.agent!.confidenceThreshold}`} />}
          {step.agent!.fallbackBehavior && (
            <Field label="Fallback" value={FALLBACK_LABELS[step.agent!.fallbackBehavior] ?? step.agent!.fallbackBehavior} />
          )}
          {step.agent!.prompt && (
            <div className="mt-2">
              <p className="text-[11px] text-muted-foreground mb-1">Prompt</p>
              <p className="text-xs bg-muted/50 rounded-md p-2.5 whitespace-pre-wrap leading-relaxed">{step.agent!.prompt}</p>
            </div>
          )}
        </Section>
      )}

      {/* Review config */}
      {hasReview && (
        <Section title="Review">
          {step.review!.type && <Field label="Reviewer" value={step.review!.type} />}
          {step.review!.plugin && <Field label="Plugin" value={step.review!.plugin} mono />}
          {step.review!.maxIterations !== undefined && <Field label="Max iterations" value={String(step.review!.maxIterations)} />}
          {step.review!.timeBoxDays !== undefined && <Field label="Time box" value={`${step.review!.timeBoxDays} days`} />}
        </Section>
      )}

      {/* Verdicts */}
      {hasVerdicts && (
        <Section title="Verdicts">
          <div className="space-y-1.5">
            {Object.entries(step.verdicts!).map(([name, verdict]) => (
              <div key={name} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{name}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-muted-foreground">{verdict.target}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Env vars */}
      {step.env && Object.keys(step.env).length > 0 && (
        <Section title="Environment">
          {Object.entries(step.env).map(([key, val]) => (
            <Field key={key} label={key} value={val} mono />
          ))}
        </Section>
      )}

      {/* Script & runtime config, step params */}
      {(step.agent?.command || step.agent?.inlineScript || step.agent?.runtime || step.agent?.image || step.stepParams) && (
        <Section title="Runtime">
          {step.agent?.runtime && <Field label="Runtime" value={step.agent.runtime} />}
          {step.agent?.command && <Field label="Command" value={step.agent.command} mono />}
          {step.agent?.inlineScript && (
            <details>
              <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors">Inline script</summary>
              <pre className="mt-1 text-[10px] bg-muted/50 rounded-md p-2 overflow-x-auto font-mono">{step.agent.inlineScript}</pre>
            </details>
          )}
          {step.agent?.image && <Field label="Image" value={step.agent.image} mono />}
          {step.agent?.repo && <Field label="Repo" value={step.agent.repo} mono />}
          {step.agent?.commit && <Field label="Commit" value={step.agent.commit} mono />}
          {step.stepParams && Object.keys(step.stepParams).length > 0 && (
            <div>
              <p className="text-[11px] text-muted-foreground mb-1">Parameters</p>
              <pre className="text-[10px] bg-muted/50 rounded-md p-2 overflow-x-auto font-mono">{JSON.stringify(step.stepParams, null, 2)}</pre>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-xs text-right truncate', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

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

const STEP_TYPE_LABELS: Record<string, string> = {
  creation: 'Task',
  review: 'Review',
  decision: 'Decision',
  terminal: 'End',
};

function StepTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    creation: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    review: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
    decision: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    terminal: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', colors[type] ?? 'bg-muted text-muted-foreground')}>
      {STEP_TYPE_LABELS[type] ?? type}
    </span>
  );
}
