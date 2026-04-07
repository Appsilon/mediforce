'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { X, User, Bot, Terminal, Users } from 'lucide-react';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { usePlugins } from '@/hooks/use-plugins';
import { useAuth } from '@/contexts/auth-context';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';
import { cn } from '@/lib/utils';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTONOMY_LEVELS = [
  { value: 'L0', label: 'L0 — Manual only' },
  { value: 'L1', label: 'L1 — Human review' },
  { value: 'L2', label: 'L2 — Auto if confident' },
  { value: 'L3', label: 'L3 — Auto + fallback' },
  { value: 'L4', label: 'L4 — Full autonomy' },
] as const;

const STEP_TYPES = ['creation', 'review', 'decision', 'terminal'] as const;
const STEP_TYPE_LABELS: Record<string, string> = { creation: 'Input', review: 'Review', decision: 'Decision', terminal: 'End' };

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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface WorkflowEditorCanvasProps {
  /** Starting steps — component re-initialises whenever React key changes. */
  initialSteps: WorkflowStep[];
  /** Starting transitions — same lifecycle as initialSteps. */
  initialTransitions: WorkflowDefinition['transitions'];
  /**
   * Extra fields merged into the YAML preview (name, description, triggers, …).
   * Steps and transitions are always added on top.
   */
  yamlFields?: Record<string, unknown>;
  /**
   * Optional workflow name used to load available secret keys inside StepEditor.
   * Pass undefined for new (unsaved) workflows.
   */
  workflowName?: string;
  /**
   * Render prop for save controls shown at the bottom of the YAML panel.
   * Receives the current steps + transitions + a discard callback.
   * Return null to hide the save panel.
   */
  renderSavePanel?: (
    steps: WorkflowStep[],
    transitions: WorkflowDefinition['transitions'],
    onDiscard: () => void,
  ) => React.ReactNode;
  /**
   * Called whenever the edited steps or transitions change.
   * Useful for lifting state up (e.g. to put a save button in the page header).
   */
  onChange?: (steps: WorkflowStep[], transitions: WorkflowDefinition['transitions']) => void;
  /**
   * Field-level validation errors keyed by stepId → fieldName → message.
   * Drives red highlights on diagram nodes and inline error text in StepEditor.
   */
  stepErrors?: Record<string, Record<string, string>>;
}

export function WorkflowEditorCanvas({
  initialSteps,
  initialTransitions,
  yamlFields,
  workflowName,
  renderSavePanel,
  onChange,
  stepErrors,
}: WorkflowEditorCanvasProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [editedSteps, setEditedSteps] = useState<WorkflowStep[]>(() => structuredClone(initialSteps));
  const [editedTransitions, setEditedTransitions] = useState<WorkflowDefinition['transitions']>(() => structuredClone(initialTransitions));
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [addingStep, setAddingStep] = useState(false);
  const [pendingStepType, setPendingStepType] = useState<WorkflowStep['type'] | null>(null);
  const [editHistory, setEditHistory] = useState<Array<{ steps: WorkflowStep[]; transitions: WorkflowDefinition['transitions'] }>>([]);
  const [yamlEditMode, setYamlEditMode] = useState(false);
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);

  const selectedStep = editedSteps.find((s) => s.id === selectedStepId) ?? null;

  // ── Move eligibility ───────────────────────────────────────────────────────
  const canMoveSelectedUp = (() => {
    if (!selectedStepId) return false;
    const incoming = editedTransitions.filter((t) => t.to === selectedStepId);
    if (incoming.length !== 1) return false;
    const pred = incoming[0].from;
    return editedTransitions.filter((t) => t.from === pred).length === 1;
  })();

  const canMoveSelectedDown = (() => {
    if (!selectedStepId) return false;
    const outgoing = editedTransitions.filter((t) => t.from === selectedStepId);
    if (outgoing.length !== 1) return false;
    const succ = outgoing[0].to;
    return editedTransitions.filter((t) => t.to === succ).length === 1;
  })();

  // ── History ────────────────────────────────────────────────────────────────
  const saveSnapshot = useCallback(() => {
    setEditHistory((prev) => [...prev, { steps: editedSteps, transitions: editedTransitions }]);
  }, [editedSteps, editedTransitions]);

  const undoEdit = useCallback(() => {
    setEditHistory((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setEditedSteps(snapshot.steps);
      setEditedTransitions(snapshot.transitions);
      return prev.slice(0, -1);
    });
  }, []);

  const discardChanges = useCallback(() => {
    setEditedSteps(structuredClone(initialSteps));
    setEditedTransitions(structuredClone(initialTransitions));
    setEditHistory([]);
    setSelectedStepId(null);
  }, [initialSteps, initialTransitions]);

  // ── Ctrl+Z ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undoEdit]);

  // ── Notify parent of changes ───────────────────────────────────────────────
  useEffect(() => {
    onChange?.(editedSteps, editedTransitions);
  }, [editedSteps, editedTransitions, onChange]);

  // ── Auto-select first errored step ─────────────────────────────────────────
  useEffect(() => {
    if (!stepErrors || Object.keys(stepErrors).length === 0) return;
    setSelectedStepId(Object.keys(stepErrors)[0]);
  }, [stepErrors]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const updateStep = useCallback((stepId: string, patch: Partial<WorkflowStep>) => {
    setEditedSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
    );
    if (patch.id && patch.id !== stepId) {
      const newId = patch.id;
      setEditedTransitions((prev) =>
        prev.map((t) => ({
          from: t.from === stepId ? newId : t.from,
          to: t.to === stepId ? newId : t.to,
          ...(t.when ? { when: t.when } : {}),
        })),
      );
      setEditedSteps((prev) =>
        prev.map((s) => {
          if (!s.verdicts) return s;
          const hasRef = Object.values(s.verdicts).some((v) => v.target === stepId);
          if (!hasRef) return s;
          const updatedVerdicts: Record<string, { target: string }> = {};
          for (const [vName, v] of Object.entries(s.verdicts)) {
            updatedVerdicts[vName] = { target: v.target === stepId ? newId : v.target };
          }
          return { ...s, verdicts: updatedVerdicts };
        }),
      );
      if (selectedStepId === stepId) setSelectedStepId(newId);
    }
  }, [selectedStepId]);

  const addStep = useCallback((type: WorkflowStep['type'], executor: WorkflowStep['executor']) => {
    const terminalStep = editedSteps.find((s) => s.type === 'terminal');

    // Only one terminal allowed
    if (type === 'terminal' && terminalStep) return;

    saveSnapshot();
    const stepNum = editedSteps.length + 1;
    const newId = `new-step-${stepNum}`;
    const newStep: WorkflowStep = {
      id: newId,
      name: `New Step ${stepNum}`,
      type,
      executor,
      ...(executor === 'agent' ? { plugin: 'opencode-agent', autonomyLevel: 'L2' } : {}),
      ...(executor === 'script' ? { plugin: 'script-container' } : {}),
      ...(executor === 'cowork' ? { cowork: { agent: 'chat' as const } } : {}),
    };

    if (!terminalStep || type === 'terminal') {
      // No terminal yet (or we're adding the terminal itself): append at end
      const lastId = editedSteps[editedSteps.length - 1]?.id;
      setEditedSteps((prev) => [...prev, newStep]);
      setEditedTransitions((prev) => lastId ? [...prev, { from: lastId, to: newId }] : prev);
    } else if (selectedStepId && selectedStepId !== terminalStep.id) {
      // Insert after the currently selected step
      const selectedIdx = editedSteps.findIndex((s) => s.id === selectedStepId);
      setEditedSteps((prev) => {
        const next = [...prev];
        next.splice(selectedIdx + 1, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) => {
        // Edges from selectedStep → their targets now go through newStep
        const outgoing = prev.filter((t) => t.from === selectedStepId);
        const others = prev.filter((t) => t.from !== selectedStepId);
        const rewired = outgoing.map((t) => ({ from: newId, to: t.to }));
        return [...others, { from: selectedStepId, to: newId }, ...rewired];
      });
    } else {
      // No step selected: insert immediately before the terminal step
      const terminalIdx = editedSteps.findIndex((s) => s.id === terminalStep.id);
      setEditedSteps((prev) => {
        const next = [...prev];
        next.splice(terminalIdx, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) => {
        // Redirect all edges that previously pointed at terminal → now point at newStep
        const rewired = prev.map((t) =>
          t.to === terminalStep.id ? { ...t, to: newId } : t,
        );
        return [...rewired, { from: newId, to: terminalStep.id }];
      });
    }

    setSelectedStepId(newId);
    setAddingStep(false);
    setPendingStepType(null);
  }, [editedSteps, selectedStepId, saveSnapshot]);

  const removeStep = useCallback((stepId: string) => {
    saveSnapshot();
    setEditedSteps((prev) => prev.filter((s) => s.id !== stepId));
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
  }, [selectedStepId, saveSnapshot]);

  const moveStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    saveSnapshot();
    setEditedTransitions((prev) => {
      if (direction === 'up') {
        const incoming = prev.filter((t) => t.to === stepId);
        if (incoming.length !== 1) return prev;
        const pred = incoming[0].from;
        const predIncoming = prev.filter((t) => t.to === pred);
        const predOutgoing = prev.filter((t) => t.from === pred);
        if (predOutgoing.length !== 1) return prev;
        const stepOutgoing = prev.filter((t) => t.from === stepId);
        const toRemove = new Set([
          ...predIncoming.map((t) => `${t.from}|${t.to}`),
          `${pred}|${stepId}`,
          ...stepOutgoing.map((t) => `${t.from}|${t.to}`),
        ]);
        return [
          ...prev.filter((t) => !toRemove.has(`${t.from}|${t.to}`)),
          ...predIncoming.map((t) => ({ from: t.from, to: stepId })),
          { from: stepId, to: pred },
          ...stepOutgoing.map((t) => ({ from: pred, to: t.to })),
        ];
      } else {
        const outgoing = prev.filter((t) => t.from === stepId);
        if (outgoing.length !== 1) return prev;
        const succ = outgoing[0].to;
        const succIncoming = prev.filter((t) => t.to === succ);
        if (succIncoming.length !== 1) return prev;
        const succOutgoing = prev.filter((t) => t.from === succ);
        const stepIncoming = prev.filter((t) => t.to === stepId);
        const toRemove = new Set([
          ...stepIncoming.map((t) => `${t.from}|${t.to}`),
          `${stepId}|${succ}`,
          ...succOutgoing.map((t) => `${t.from}|${t.to}`),
        ]);
        return [
          ...prev.filter((t) => !toRemove.has(`${t.from}|${t.to}`)),
          ...stepIncoming.map((t) => ({ from: t.from, to: succ })),
          { from: succ, to: stepId },
          ...succOutgoing.map((t) => ({ from: stepId, to: t.to })),
        ];
      }
    });
    setEditedSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === stepId);
      if (idx === -1) return prev;
      const next = [...prev];
      if (direction === 'up' && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      } else if (direction === 'down' && idx < next.length - 1) {
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      }
      return next;
    });
  }, [saveSnapshot]);

  // ── Diagram definition ─────────────────────────────────────────────────────
  const diagramDefinition = {
    steps: editedSteps,
    transitions: editedTransitions,
  } as WorkflowDefinition;

  const yamlPreview = yamlStringify(
    { ...(yamlFields ?? {}), steps: editedSteps, transitions: editedTransitions },
    { indent: 2 },
  );

  const savePanel = renderSavePanel?.(editedSteps, editedTransitions, discardChanges) ?? null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0">
      {/* Diagram column */}
      <div className="flex-1 flex flex-col pr-0">
        {/* Toolbar */}
        <div className="border-b px-4 py-2 flex items-center gap-1.5 bg-muted/30 shrink-0 flex-wrap">
          {/* Add Step */}
          <div className="relative">
            <button
              onClick={() => { setAddingStep(!addingStep); setPendingStepType(null); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              + Add Step
            </button>
            {addingStep && (
              <div className="absolute top-full left-0 mt-1.5 bg-background border rounded-xl shadow-xl p-3 z-50 w-80 space-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Step type</p>
                  <div className="flex flex-col gap-1">
                    {([
                      { type: 'creation', label: 'Input', description: 'A step where content or data is produced — by a human, an AI agent, or a script.', color: 'text-blue-600 dark:text-blue-400', activeBg: 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-400' },
                      { type: 'review', label: 'Review', description: 'A step where someone evaluates work and gives a verdict such as approve or reject.', color: 'text-amber-600 dark:text-amber-400', activeBg: 'bg-amber-50 dark:bg-amber-900/30 ring-1 ring-amber-400' },
                      { type: 'decision', label: 'Decision', description: 'A branching step that routes the workflow to different paths based on a condition.', color: 'text-purple-600 dark:text-purple-400', activeBg: 'bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-400' },
                      { type: 'terminal', label: 'End', description: 'Marks the final state of the workflow — all paths must lead here.', color: 'text-emerald-600 dark:text-emerald-400', activeBg: '' },
                    ] as const).map((opt) => {
                      const isTerminalDisabled = opt.type === 'terminal' && editedSteps.some((s) => s.type === 'terminal');
                      const isActive = pendingStepType === opt.type;
                      return (
                        <button
                          key={opt.type}
                          disabled={isTerminalDisabled}
                          onClick={() => {
                            if (opt.type === 'terminal') { addStep('terminal', 'human'); }
                            else { setPendingStepType(opt.type); }
                          }}
                          className={cn(
                            'rounded-lg px-3 py-2 text-left transition-all w-full',
                            isTerminalDisabled
                              ? 'opacity-40 cursor-not-allowed'
                              : isActive
                                ? opt.activeBg
                                : 'hover:bg-muted',
                          )}
                        >
                          <span className={cn('text-xs font-semibold', opt.color)}>{opt.label}</span>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{opt.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {pendingStepType && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Executor</p>
                    <div className="flex gap-1.5">
                      {(pendingStepType === 'creation'
                        ? (['human', 'agent', 'script', 'cowork'] as const)
                        : (['human', 'agent'] as const)
                      ).map((executor) => (
                        <button
                          key={executor}
                          onClick={() => addStep(pendingStepType, executor)}
                          className="flex-1 rounded-lg py-1.5 text-xs font-semibold hover:bg-muted transition-all capitalize border"
                        >
                          {executor}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="w-px h-4 bg-border mx-0.5" />

          <button
            onClick={() => selectedStepId && moveStep(selectedStepId, 'up')}
            disabled={!canMoveSelectedUp}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors',
              canMoveSelectedUp ? 'hover:bg-muted text-foreground' : 'opacity-40 cursor-not-allowed text-muted-foreground',
            )}
          >
            ↑ Move Up
          </button>

          <button
            onClick={() => selectedStepId && moveStep(selectedStepId, 'down')}
            disabled={!canMoveSelectedDown}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors',
              canMoveSelectedDown ? 'hover:bg-muted text-foreground' : 'opacity-40 cursor-not-allowed text-muted-foreground',
            )}
          >
            ↓ Move Down
          </button>

          <button
            onClick={undoEdit}
            disabled={editHistory.length === 0}
            title="Undo last change (Ctrl+Z)"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors',
              editHistory.length > 0 ? 'hover:bg-muted text-foreground' : 'opacity-40 cursor-not-allowed text-muted-foreground',
            )}
          >
            ↩ Undo
          </button>

          <div className="w-px h-4 bg-border mx-0.5" />

          <button
            onClick={() => selectedStepId && removeStep(selectedStepId)}
            disabled={!selectedStepId}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors',
              selectedStepId
                ? 'hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-foreground dark:hover:bg-red-900/20 dark:hover:text-red-400'
                : 'opacity-40 cursor-not-allowed text-muted-foreground',
            )}
          >
            Remove Step
          </button>

          {selectedStepId && (
            <span className="ml-auto text-xs text-muted-foreground">
              Selected: <span className="font-mono">{selectedStepId}</span>
            </span>
          )}
        </div>

        {/* Diagram */}
        <div className="flex-1 p-6 pt-4">
          <WorkflowDiagram
            definition={diagramDefinition}
            className="border-0"
            onNodeClick={(stepId) => setSelectedStepId(stepId === selectedStepId ? null : stepId)}
            onNodeDelete={removeStep}
            onPaneClick={() => setSelectedStepId(null)}
            selectedStepId={selectedStepId}
            errorStepIds={stepErrors ? new Set(Object.keys(stepErrors)) : undefined}
          />
        </div>
      </div>

      {/* Side panel */}
      <div className="w-1/2 shrink-0 border-l bg-background overflow-y-auto">
        <div className="p-4 space-y-4">
          {selectedStep ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Edit step</h2>
                <button
                  onClick={() => setSelectedStepId(null)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <StepEditor
                step={selectedStep}
                allSteps={editedSteps}
                workflowName={workflowName}
                onChange={(patch) => updateStep(selectedStep.id, patch)}
                errors={stepErrors?.[selectedStep.id]}
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">YAML</h2>
                <button
                  onClick={() => {
                    if (yamlEditMode) {
                      setYamlEditMode(false);
                      setYamlError(null);
                    } else {
                      setYamlDraft(yamlPreview);
                      setYamlError(null);
                      setYamlEditMode(true);
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors border rounded-md px-2 py-0.5"
                >
                  {yamlEditMode ? 'Cancel' : 'Edit YAML'}
                </button>
              </div>
              {yamlEditMode ? (
                <div className="space-y-2">
                  <textarea
                    value={yamlDraft}
                    onChange={(e) => { setYamlDraft(e.target.value); setYamlError(null); }}
                    rows={20}
                    spellCheck={false}
                    className="w-full text-[11px] font-mono bg-muted/30 rounded-lg p-4 border focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
                  />
                  {yamlError && (
                    <p className="text-xs text-red-600 dark:text-red-400">{yamlError}</p>
                  )}
                  <button
                    onClick={() => {
                      try {
                        const parsed = yamlParse(yamlDraft) as { steps?: unknown; transitions?: unknown };
                        if (!parsed?.steps || !Array.isArray(parsed.steps)) {
                          setYamlError('YAML must contain a "steps" array');
                          return;
                        }
                        saveSnapshot();
                        setEditedSteps(parsed.steps as WorkflowStep[]);
                        setEditedTransitions((Array.isArray(parsed.transitions) ? parsed.transitions : []) as WorkflowDefinition['transitions']);
                        setYamlEditMode(false);
                        setYamlError(null);
                      } catch (err) {
                        setYamlError(err instanceof Error ? err.message : 'Invalid YAML');
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Apply YAML
                  </button>
                </div>
              ) : (
                <pre className="text-[11px] font-mono bg-muted/30 rounded-lg p-4 overflow-x-auto overflow-y-auto leading-relaxed">
                  {yamlPreview}
                </pre>
              )}
              {!yamlEditMode && savePanel && (
                <div className="border-t pt-4">
                  {savePanel}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepEditor
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
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

function buildExecutorChangePatch(step: WorkflowStep, targetExecutor: WorkflowStep['executor']): Partial<WorkflowStep> {
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
// CoworkSection
// ---------------------------------------------------------------------------

const VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

function CoworkSection({
  step,
  onChange,
  isNewStep,
}: {
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
  isNewStep: boolean;
}) {
  const cowork = step.cowork ?? { agent: 'chat' as const };
  const isVoice = cowork.agent === 'voice-realtime';

  const patchCowork = (patch: Partial<NonNullable<WorkflowStep['cowork']>>) =>
    onChange({ cowork: { ...cowork, ...patch } });

  const selectInline = 'bg-transparent text-xs text-right border-0 border-b border-transparent hover:border-muted-foreground/20 focus:border-primary px-0 py-0 focus:outline-none transition-colors cursor-pointer';

  return (
    <Section title="Cowork">
      {isNewStep && (
        <div className="rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-3 mb-3 space-y-1.5">
          <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">What is a Cowork step?</p>
          <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
            A Cowork step opens a shared workspace where a human and an AI agent collaborate to produce a structured artifact — a document, decision, or dataset — before the workflow can continue.
          </p>
          <p className="text-[11px] text-teal-700/80 dark:text-teal-300/80 leading-relaxed">
            Choose <strong>Chat</strong> for a text conversation with Claude, or <strong>Voice</strong> for a spoken session with a real-time voice model. The artifact schema defines the structured output both sides are working toward.
          </p>
        </div>
      )}

      {/* Agent mode toggle */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-muted mb-3">
        {(['chat', 'voice-realtime'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => patchCowork({
              agent: mode,
              chat: mode === 'chat' ? (cowork.chat ?? {}) : undefined,
              voiceRealtime: mode === 'voice-realtime' ? (cowork.voiceRealtime ?? {}) : undefined,
            })}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-all',
              cowork.agent === mode
                ? 'bg-teal-500 text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {mode === 'chat' ? 'Chat' : 'Voice'}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {/* Model */}
        <EditableField
          label="Model"
          value={isVoice ? (cowork.voiceRealtime?.model ?? '') : (cowork.chat?.model ?? '')}
          placeholder={isVoice ? 'gpt-4o-realtime-preview' : 'anthropic/claude-sonnet-4'}
          onChange={(v) => isVoice
            ? patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, model: v || undefined } })
            : patchCowork({ chat: { ...cowork.chat, model: v || undefined } })
          }
        />

        {/* Voice-specific fields */}
        {isVoice && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground shrink-0">Voice</span>
              <select
                value={cowork.voiceRealtime?.voice ?? ''}
                onChange={(e) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, voice: e.target.value || undefined } })}
                className={selectInline}
              >
                <option value="">Default</option>
                {VOICE_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <EditableField
              label="Synthesis model"
              value={cowork.voiceRealtime?.synthesisModel ?? ''}
              placeholder="e.g. claude-sonnet-4"
              onChange={(v) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, synthesisModel: v || undefined } })}
            />
            <EditableField
              label="Max duration"
              value={cowork.voiceRealtime?.maxDurationSeconds !== undefined ? String(cowork.voiceRealtime.maxDurationSeconds) : ''}
              placeholder="600"
              suffix="sec"
              onChange={(v) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, maxDurationSeconds: v ? Number(v) : undefined } })}
            />
            <EditableField
              label="Idle timeout"
              value={cowork.voiceRealtime?.idleTimeoutSeconds !== undefined ? String(cowork.voiceRealtime.idleTimeoutSeconds) : ''}
              placeholder="30"
              suffix="sec"
              onChange={(v) => patchCowork({ voiceRealtime: { ...cowork.voiceRealtime, idleTimeoutSeconds: v ? Number(v) : undefined } })}
            />
          </>
        )}
      </div>

      {/* System prompt */}
      <div className="mt-3">
        <p className="text-[11px] text-muted-foreground mb-1">System prompt</p>
        <textarea
          value={cowork.systemPrompt ?? ''}
          onChange={(e) => patchCowork({ systemPrompt: e.target.value || undefined })}
          rows={4}
          placeholder="Instructions for the AI collaborator…"
          className="w-full text-xs bg-muted/50 rounded-md p-2.5 leading-relaxed border-0 focus:outline-none focus:ring-1 focus:ring-primary resize-y"
        />
      </div>

      {/* Output schema */}
      <div className="mt-2">
        <p className="text-[11px] text-muted-foreground mb-1">Output schema <span className="opacity-60">(JSON)</span></p>
        <CoworkOutputSchemaEditor
          value={cowork.outputSchema}
          onChange={(schema) => patchCowork({ outputSchema: schema })}
        />
      </div>
    </Section>
  );
}

function CoworkOutputSchemaEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (schema: Record<string, unknown> | undefined) => void;
}) {
  const [draft, setDraft] = useState(() => value !== undefined ? JSON.stringify(value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);

  // Keep draft in sync when value changes externally (e.g. YAML apply)
  const valueRef = useRef(value);
  useEffect(() => {
    if (value !== valueRef.current) {
      valueRef.current = value;
      setDraft(value !== undefined ? JSON.stringify(value, null, 2) : '');
      setError(null);
    }
  }, [value]);

  const handleBlur = () => {
    if (draft.trim() === '') {
      onChange(undefined);
      setError(null);
      return;
    }
    try {
      onChange(JSON.parse(draft));
      setError(null);
    } catch {
      setError('Invalid JSON');
    }
  };

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        rows={5}
        placeholder={'{\n  "type": "object",\n  "required": [],\n  "properties": {}\n}'}
        className={cn(
          'w-full text-xs font-mono bg-muted/50 rounded-md p-2.5 leading-relaxed border-0 focus:outline-none focus:ring-1 resize-y',
          error ? 'ring-1 ring-destructive' : 'focus:ring-primary',
        )}
      />
      {error && <p className="text-[10px] text-destructive mt-0.5">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StepEditor
// ---------------------------------------------------------------------------

function StepEditor({
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
// Shared UI helpers
// ---------------------------------------------------------------------------

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">{title}</p>
      {children}
    </div>
  );
}
