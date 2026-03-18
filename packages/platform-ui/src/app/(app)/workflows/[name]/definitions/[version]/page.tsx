'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Play, X, Save, User, Bot, Terminal } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { saveWorkflowDefinition } from '@/app/actions/definitions';
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
            {/* Edit toggle */}
            <button
              onClick={editing ? cancelEditing : enableEditing}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap',
                editing
                  ? 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/20 dark:text-amber-400 dark:hover:bg-amber-900/30'
                  : 'hover:bg-muted',
              )}
            >
              <Pencil className="h-3.5 w-3.5" />
              {editing ? 'Editing' : 'Edit'}
            </button>

            {/* Save (visible in edit mode) */}
            {editing && (
              <>
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
            )}

            {/* Start Run (visible when not editing) */}
            {!editing && (
              <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap">
                <Play className="h-3.5 w-3.5" />
                Start Run
              </button>
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

function StepEditor({ step, onChange }: { step: WorkflowStep; onChange: (patch: Partial<WorkflowStep>) => void }) {
  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <input
          value={step.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Executor */}
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
                    'flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-all',
                    step.executor === ex ? colors[ex] : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {ex}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Autonomy level */}
      {step.executor === 'agent' && step.type !== 'terminal' && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Autonomy</label>
          <div className="flex flex-col gap-1 mt-1">
            {AUTONOMY_LEVELS.map((level) => (
              <button
                key={level.value}
                onClick={() => onChange({ autonomyLevel: level.value })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs text-left transition-all border',
                  step.autonomyLevel === level.value
                    ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300'
                    : 'border-transparent bg-muted/50 text-muted-foreground hover:text-foreground',
                )}
              >
                {level.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Plugin */}
      {step.executor === 'agent' && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Plugin</label>
          <input
            value={step.plugin ?? ''}
            onChange={(e) => onChange({ plugin: e.target.value || undefined })}
            placeholder="e.g. supply-data-collector"
            className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      {/* Allowed roles */}
      {step.executor === 'human' && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Allowed roles</label>
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

      {/* Agent advanced */}
      {step.executor === 'agent' && (
        <details className="group">
          <summary className="text-xs font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
            Advanced agent settings
          </summary>
          <div className="mt-2 space-y-2 pl-2 border-l-2 border-muted">
            <div>
              <label className="text-xs text-muted-foreground">Model</label>
              <input
                value={step.agent?.model ?? ''}
                onChange={(e) => onChange({ agent: { ...step.agent, model: e.target.value || undefined } })}
                placeholder="claude-sonnet-4-6"
                className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Timeout (min)</label>
              <input
                type="number"
                value={step.agent?.timeoutMinutes ?? ''}
                onChange={(e) => onChange({ agent: { ...step.agent, timeoutMinutes: e.target.value ? Number(e.target.value) : undefined } })}
                className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Confidence threshold</label>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={step.agent?.confidenceThreshold ?? ''}
                onChange={(e) => onChange({ agent: { ...step.agent, confidenceThreshold: e.target.value ? Number(e.target.value) : undefined } })}
                className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Skill</label>
              <input
                value={step.agent?.skill ?? ''}
                onChange={(e) => onChange({ agent: { ...step.agent, skill: e.target.value || undefined } })}
                className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Prompt</label>
              <textarea
                value={step.agent?.prompt ?? ''}
                onChange={(e) => onChange({ agent: { ...step.agent, prompt: e.target.value || undefined } })}
                rows={3}
                className="mt-0.5 w-full rounded-md border bg-background px-2 py-1 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </details>
      )}

      {/* Description */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <input
          value={step.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          placeholder="What does this step do?"
          className="mt-1 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step detail (read-only side panel)
// ---------------------------------------------------------------------------

function StepDetail({ step }: { step: WorkflowStep }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">{step.name}</p>
        <p className="font-mono text-xs text-muted-foreground mt-0.5">{step.id}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <StepTypeBadge type={step.type} />
        <ExecutorBadge executor={step.executor} />
        {step.autonomyLevel && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {step.autonomyLevel}
          </span>
        )}
      </div>

      {step.description && (
        <p className="text-sm text-muted-foreground">{step.description}</p>
      )}

      {step.plugin && <Field label="Plugin" value={step.plugin} mono />}

      {step.allowedRoles && step.allowedRoles.length > 0 && (
        <Field label="Allowed roles" value={step.allowedRoles.join(', ')} />
      )}

      {step.agent && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent config</p>
          {step.agent.model && <Field label="Model" value={step.agent.model} mono />}
          {step.agent.skill && <Field label="Skill" value={step.agent.skill} mono />}
          {step.agent.timeoutMinutes !== undefined && <Field label="Timeout" value={`${step.agent.timeoutMinutes} min`} />}
          {step.agent.confidenceThreshold !== undefined && <Field label="Confidence" value={String(step.agent.confidenceThreshold)} />}
          {step.agent.fallbackBehavior && <Field label="Fallback" value={step.agent.fallbackBehavior} />}
          {step.agent.prompt && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Prompt</p>
              <p className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">{step.agent.prompt}</p>
            </div>
          )}
        </div>
      )}

      {step.review && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review config</p>
          {step.review.type && <Field label="Reviewer" value={step.review.type} />}
          {step.review.plugin && <Field label="Plugin" value={step.review.plugin} mono />}
          {step.review.maxIterations !== undefined && <Field label="Max iterations" value={String(step.review.maxIterations)} />}
        </div>
      )}

      {step.verdicts && Object.keys(step.verdicts).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Verdicts</p>
          {Object.entries(step.verdicts).map(([verdictName, verdict]) => (
            <div key={verdictName} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{verdictName}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono">{verdict.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
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
