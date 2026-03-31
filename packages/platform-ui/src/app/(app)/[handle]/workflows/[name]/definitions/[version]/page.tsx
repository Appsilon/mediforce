'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, X, Save, User, Bot, Terminal } from 'lucide-react';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useAuth } from '@/contexts/auth-context';
import { usePlugins } from '@/hooks/use-plugins';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { saveWorkflowDefinition, setPublishedWorkflowVersion } from '@/app/actions/definitions';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';
import { StartRunButton } from '@/components/processes/start-run-button';
import { VersionLabel } from '@/components/ui/version-label';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';
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
  const { name, version, handle } = useParams<{ name: string; version: string; handle: string }>();
  const router = useRouter();
  const decodedName = decodeURIComponent(name);
  const versionNumber = parseInt(version, 10);

  const { definitions, loading, publishedVersion, refreshPublished } = useWorkflowDefinitions(decodedName);
  const definition = definitions.find((def) => def.version === versionNumber) ?? null;

  const [editing, setEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedSteps, setEditedSteps] = useState<WorkflowStep[]>([]);
  const [editedTransitions, setEditedTransitions] = useState<WorkflowDefinition['transitions']>([]);
  const [editedDefinitionOverrides, setEditedDefinitionOverrides] = useState<Partial<WorkflowDefinition>>({});
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [publishing, setPublishing] = useState(false);

  const isPublished = publishedVersion !== null && publishedVersion === versionNumber;

  const handlePublish = useCallback(async () => {
    if (!definition) return;
    setPublishing(true);
    const result = await setPublishedWorkflowVersion(decodedName, definition.version);
    if (result.success) {
      await refreshPublished();
    }
    setPublishing(false);
  }, [definition, decodedName, refreshPublished]);

  const currentSteps = editing ? editedSteps : (definition?.steps ?? []);
  const currentTransitions = editing ? editedTransitions : (definition?.transitions ?? []);
  const selectedStep = currentSteps.find((s) => s.id === selectedStepId) ?? null;

  const enableEditing = useCallback(() => {
    if (!definition) return;
    setEditedTitle('');
    setEditedSteps(structuredClone(definition.steps));
    setEditedTransitions(structuredClone(definition.transitions));
    setEditedDefinitionOverrides({});
    setEditing(true);
    setSaveState({ status: 'idle' });
  }, [definition]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditedSteps([]);
    setEditedDefinitionOverrides({});
    setSaveState({ status: 'idle' });
  }, []);

  const updateStep = useCallback((stepId: string, patch: Partial<WorkflowStep>) => {
    setEditedSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    );
    // When step ID changes, update all references: transitions + verdict targets in other steps
    if (patch.id && patch.id !== stepId) {
      const newId = patch.id;
      setEditedTransitions((prev) =>
        prev.map((t) => ({
          from: t.from === stepId ? newId : t.from,
          to: t.to === stepId ? newId : t.to,
          ...(t.when ? { when: t.when } : {}),
        })),
      );
      // Update verdict targets in other steps that point to the renamed step
      setEditedSteps((prev) =>
        prev.map((s) => {
          if (!s.verdicts) return s;
          const hasRef = Object.values(s.verdicts).some((v) => v.target === stepId);
          if (!hasRef) return s;
          const updatedVerdicts: Record<string, { target: string }> = {};
          for (const [name, v] of Object.entries(s.verdicts)) {
            updatedVerdicts[name] = { target: v.target === stepId ? newId : v.target };
          }
          return { ...s, verdicts: updatedVerdicts };
        }),
      );
      if (selectedStepId === stepId) setSelectedStepId(newId);
    }
  }, [selectedStepId]);

  const addStepAfter = useCallback((afterStepId: string, beforeStepId: string, executor: 'human' | 'agent' | 'script' = 'human') => {
    const stepNum = editedSteps.length + 1;
    const newId = `new-step-${stepNum}`;
    setEditedSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === afterStepId);
      if (idx === -1) return prev;
      const newStep: WorkflowStep = {
        id: newId,
        name: `New Step ${stepNum}`,
        type: 'creation',
        executor,
        ...(executor === 'agent' ? { plugin: 'opencode-agent', autonomyLevel: 'L2' } : {}),
        ...(executor === 'script' ? { plugin: 'script-container' } : {}),
      };
      const next = [...prev];
      next.splice(idx + 1, 0, newStep);
      return next;
    });
    // Rewire the specific edge: afterStep→beforeStep becomes afterStep→new→beforeStep
    setEditedTransitions((prev) => {
      const targetEdge = prev.find((t) => t.from === afterStepId && t.to === beforeStepId);
      if (!targetEdge) {
        // Edge not found in explicit transitions — might be a verdict edge.
        // Insert new step with both connections anyway.
        return [
          ...prev,
          { from: afterStepId, to: newId },
          { from: newId, to: beforeStepId },
        ];
      }
      return [
        ...prev.filter((t) => t !== targetEdge),
        { from: afterStepId, to: newId },
        { from: newId, to: beforeStepId },
      ];
    });
  }, [editedSteps.length]);

  const removeStep = useCallback((stepId: string) => {
    setEditedSteps((prev) => prev.filter((s) => s.id !== stepId));
    // Rewire transitions: if A→removed→B, create A→B
    setEditedTransitions((prev) => {
      const incoming = prev.filter((t) => t.to === stepId);
      const outgoing = prev.filter((t) => t.from === stepId);
      const unrelated = prev.filter((t) => t.from !== stepId && t.to !== stepId);
      const rewired = incoming.flatMap((inc) =>
        outgoing.map((out) => ({ from: inc.from, to: out.to })),
      );
      return [...unrelated, ...rewired];
    });
    if (selectedStepId === stepId) setSelectedStepId(null);
  }, [selectedStepId]);

  const handleSave = useCallback(async () => {
    if (!definition) return;

    // Validate: agent/script steps must have a plugin set
    const missingPlugin = editedSteps.filter(
      (s) => s.type !== 'terminal' && (s.executor === 'agent' || s.executor === 'script') && !s.plugin,
    );
    if (missingPlugin.length > 0) {
      const names = missingPlugin.map((s) => `"${s.name}"`).join(', ');
      setSaveState({ status: 'error', message: `Plugin required for agent/script steps: ${names}` });
      return;
    }

    // Validate: steps must have non-empty IDs
    const emptyIds = editedSteps.filter((s) => !s.id);
    if (emptyIds.length > 0) {
      const names = emptyIds.map((s) => `"${s.name}"`).join(', ');
      setSaveState({ status: 'error', message: `Step ID is empty for: ${names}` });
      return;
    }

    // Validate: no duplicate step IDs
    const idCounts = new Map<string, number>();
    for (const s of editedSteps) idCounts.set(s.id, (idCounts.get(s.id) ?? 0) + 1);
    const dupes = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    if (dupes.length > 0) {
      setSaveState({ status: 'error', message: `Duplicate step IDs: ${dupes.join(', ')}` });
      return;
    }

    setSaveState({ status: 'saving' });

    // Merge explicit transitions with verdict-based transitions
    const transitions = [...editedTransitions];
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
      title: editedTitle.trim() || undefined,
      description: editedDefinitionOverrides.description ?? definition.description,
      preamble: editedDefinitionOverrides.preamble ?? definition.preamble,
      steps: editedSteps,
      transitions,
      triggers: editedDefinitionOverrides.triggers ?? definition.triggers,
      roles: editedDefinitionOverrides.roles ?? definition.roles,
      env: editedDefinitionOverrides.env ?? definition.env,
      notifications: editedDefinitionOverrides.notifications ?? definition.notifications,
      metadata: editedDefinitionOverrides.metadata ?? definition.metadata,
      repo: definition.repo,
      url: definition.url,
    });

    if (result.success) {
      setSaveState({ status: 'saved', version: result.version });
      setTimeout(() => {
        router.push(`/${handle}/workflows/${name}/definitions/${result.version}`);
      }, 500);
    } else {
      setSaveState({ status: 'error', message: result.error });
    }
  }, [definition, editedTitle, editedSteps, editedTransitions, editedDefinitionOverrides, name, router, handle]);

  // Build a WorkflowDefinition from edited steps for the diagram
  const diagramDefinition: WorkflowDefinition | null = definition
    ? { ...definition, steps: currentSteps, transitions: currentTransitions }
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
        <Link href={routes.workflow(handle, decodedName)} className="underline">Back to workflow</Link>
      </div>
    );
  }

  if (definition === null || diagramDefinition === null) return null;

  return (
    <div className="flex flex-1 flex-col relative">
      {/* Header */}
      <div className="border-b px-6 py-4 sticky top-0 z-30 bg-background">
        <Link
          href={routes.workflow(handle, decodedName)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {decodedName}
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-headline font-semibold">{decodedName}</h1>
              <VersionLabel version={definition.version} title={!editing ? definition.title : undefined} className="text-sm" />
              {editing && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  editing
                </span>
              )}
              {!editing && isPublished && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  published
                </span>
              )}
            </div>
            {editing && (
              <input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                placeholder="Version title (required) — e.g. &quot;Added automated review step&quot;"
                className="mt-1 w-full max-w-md text-sm border rounded-md px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
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
                  disabled={saveState.status === 'saving' || !editedTitle.trim()}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap',
                    (saveState.status === 'saving' || !editedTitle.trim()) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saveState.status === 'saving' ? 'Saving...' : 'Save new version'}
                </button>

                {saveState.status === 'saved' && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-sm font-medium text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
                    Saved as v{saveState.version}
                  </span>
                )}
                {saveState.status === 'error' && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 border border-red-200 px-3 py-1.5 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400">
                    {saveState.message}
                  </span>
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
                <StartRunButton workflowName={decodedName} version={definition.version} label={isPublished ? undefined : 'Test run'} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Draft banner */}
      {!editing && !isPublished && (
        <div className="mx-6 mt-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
          <span className="text-sm text-amber-800 dark:text-amber-200">
            This version is a draft
          </span>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors whitespace-nowrap',
              publishing && 'opacity-50 cursor-not-allowed',
            )}
          >
            {publishing ? 'Publishing...' : 'Publish this version'}
          </button>
        </div>
      )}

      {/* Content: diagram + optional side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Diagram */}
        <div className={cn('flex-1 p-6', selectedStep && 'pr-0')}>
          <WorkflowDiagram
            definition={diagramDefinition}
            className="border-0"
            onNodeClick={(stepId) => setSelectedStepId(stepId === selectedStepId ? null : stepId)}
            selectedStepId={selectedStepId}
            editing={editing}
            onAddStep={editing ? addStepAfter : undefined}
            onRemoveStep={editing ? removeStep : undefined}
          />

          {/* YAML — readonly preview or editable textarea in edit mode */}
          <details className="mt-4">
            <summary className="text-[11px] font-medium text-muted-foreground/40 cursor-pointer hover:text-muted-foreground transition-colors select-none">
              {editing ? 'Edit YAML' : 'View YAML'}
            </summary>
            {editing ? (
              <YamlEditor
                definition={diagramDefinition}
                onChange={(updates) => {
                  setEditedSteps(updates.steps);
                  setEditedTransitions(updates.transitions);
                  const { steps: _s, transitions: _t, name: _n, ...overrides } = updates;
                  setEditedDefinitionOverrides(overrides);
                }}
              />
            ) : (
              <pre className="mt-2 text-[11px] font-mono bg-muted/30 rounded-lg p-4 overflow-x-auto max-h-[400px] overflow-y-auto leading-relaxed">
                {yamlStringify(
                  { ...diagramDefinition, version: undefined, createdAt: undefined },
                  { indent: 2 },
                )}
              </pre>
            )}
          </details>
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
                  allSteps={currentSteps}
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
// YAML editor — direct text editing of full workflow definition
// ---------------------------------------------------------------------------

/** Fields excluded from YAML editing (immutable identifiers / system fields) */
const YAML_EXCLUDED_KEYS = new Set(['version', 'createdAt', 'name']);

function YamlEditor({ definition, onChange }: {
  definition: WorkflowDefinition;
  onChange: (updates: Omit<WorkflowDefinition, 'version' | 'createdAt'>) => void;
}) {
  const [yamlText, setYamlText] = useState(() => {
    const editable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(definition)) {
      if (!YAML_EXCLUDED_KEYS.has(key) && value !== undefined) {
        editable[key] = value;
      }
    }
    return yamlStringify(editable, { indent: 2 });
  });
  const [error, setError] = useState<string | null>(null);

  const applyYaml = useCallback(() => {
    try {
      const parsed = yamlParse(yamlText) as Record<string, unknown>;
      if (!parsed?.steps || !Array.isArray(parsed.steps)) {
        setError('YAML must contain a "steps" array');
        return;
      }
      setError(null);
      onChange({
        ...parsed,
        name: definition.name,
        steps: parsed.steps as WorkflowStep[],
        transitions: (parsed.transitions as WorkflowDefinition['transitions']) ?? [],
        triggers: (parsed.triggers as WorkflowDefinition['triggers']) ?? definition.triggers,
      } as Omit<WorkflowDefinition, 'version' | 'createdAt'>);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid YAML');
    }
  }, [yamlText, onChange, definition.name, definition.triggers]);

  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={yamlText}
        onChange={(e) => setYamlText(e.target.value)}
        rows={20}
        spellCheck={false}
        className="w-full text-[11px] font-mono bg-muted/30 rounded-lg p-4 border-0 focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
      <button
        onClick={applyYaml}
        className="text-xs font-medium text-primary hover:underline"
      >
        Apply YAML to diagram
      </button>
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

const KNOWN_MODELS = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
] as const;

const RUNTIME_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'r', label: 'R' },
  { value: 'bash', label: 'Bash' },
] as const;

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function StepEditor({ step, allSteps, onChange }: { step: WorkflowStep; allSteps: WorkflowStep[]; onChange: (patch: Partial<WorkflowStep>) => void }) {
  const isNewStep = step.id.startsWith('new-step-');
  const { plugins } = usePlugins();
  const { firebaseUser } = useAuth();
  const { handle, name: workflowNameParam } = useParams<{ handle: string; name: string }>();
  const [secretKeys, setSecretKeys] = useState<string[]>([]);
  useEffect(() => {
    if (handle && workflowNameParam && firebaseUser) {
      getWorkflowSecretKeys(handle, decodeURIComponent(workflowNameParam), firebaseUser.uid)
        .then(setSecretKeys)
        .catch((error) => console.error('Failed to load secret keys:', error));
    }
  }, [handle, workflowNameParam, firebaseUser]);
  const inlineInput = 'w-full bg-transparent border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0.5 focus:outline-none transition-colors';
  const selectInline = 'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors cursor-pointer';
  const otherSteps = allSteps.filter((s) => s.id !== step.id);

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
          onChange={(e) => {
            const patch: Partial<WorkflowStep> = { name: e.target.value };
            // Auto-slug ID for new steps only
            if (isNewStep) patch.id = toSlug(e.target.value) || step.id;
            onChange(patch);
          }}
          className={cn(inlineInput, 'text-[15px] font-semibold text-foreground')}
        />
        <StepIdField currentId={step.id} onChange={(newId) => onChange({ id: newId })} />
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
                  onClick={() => onChange({
                    executor: ex,
                    // Default plugin when switching to agent (prevents "plugin not registered" errors)
                    ...(ex === 'agent' && !step.plugin ? { plugin: 'opencode-agent' } : {}),
                  })}
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

      {/* ─── Agent section — mirrors StepDetail "Agent" section ─── */}
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
              onClick={() => {
                onChange({ verdicts: { ...step.verdicts, ['new-verdict']: { target: '' } } });
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

      {/* ─── Environment variables ─── */}
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
                  onChange={(e) => {
                    const newEnv = { ...step.env, [key]: e.target.value };
                    onChange({ env: newEnv });
                  }}
                  className="bg-transparent text-xs font-mono border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors w-full"
                />
                {secretKeys.length > 0 && !val.startsWith('{{') && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        const newEnv = { ...step.env, [key]: `{{${e.target.value}}}` };
                        onChange({ env: newEnv });
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
            onClick={() => {
              onChange({ env: { ...step.env, NEW_VAR: '' } });
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
          {/* Step ID is now editable in the identity section above */}
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

function StepIdField({ currentId, onChange }: { currentId: string; onChange: (newId: string) => void }) {
  const [draft, setDraft] = useState(currentId);
  const [dirty, setDirty] = useState(false);
  const prevIdRef = useRef(currentId);

  // Sync draft immediately when external id changes (e.g. auto-slug from name)
  if (currentId !== prevIdRef.current && !dirty) {
    prevIdRef.current = currentId;
    // Direct state set during render — React handles this correctly
    setDraft(currentId);
  }
  prevIdRef.current = currentId;

  const commit = useCallback(() => {
    const slug = draft.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (slug && slug !== currentId) {
      onChange(slug);
    }
    setDraft(slug || currentId);
    setDirty(false);
  }, [draft, currentId, onChange]);

  return (
    <input
      value={draft}
      onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      placeholder="step-id"
      className="w-full bg-transparent border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0.5 focus:outline-none transition-colors font-mono text-xs text-muted-foreground mt-0.5"
    />
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
