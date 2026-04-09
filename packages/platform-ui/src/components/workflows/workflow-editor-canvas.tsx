'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, PenLine, Search, GitBranch, Flag } from 'lucide-react';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { cn } from '@/lib/utils';
import { WorkflowStepSchema, TransitionSchema } from '@mediforce/platform-core';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { StepEditor } from './workflow-editor/step-editor';

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
  // When adding via an edge + button, we insert after this step id without changing selectedStepId.
  const [pendingInsertAfterId, setPendingInsertAfterId] = useState<string | null>(null);
  const addStepDropdownRef = useRef<HTMLDivElement>(null);
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
  // Keep refs in sync so saveSnapshot can read current state without being
  // recreated on every steps/transitions change (which would cascade to
  // addStep, removeStep, moveStep, etc.).
  const editedStepsRef = useRef(editedSteps);
  const editedTransitionsRef = useRef(editedTransitions);
  useEffect(() => { editedStepsRef.current = editedSteps; }, [editedSteps]);
  useEffect(() => { editedTransitionsRef.current = editedTransitions; }, [editedTransitions]);

  const saveSnapshot = useCallback(() => {
    setEditHistory((prev) => [...prev, { steps: editedStepsRef.current, transitions: editedTransitionsRef.current }]);
  }, []);

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

  // ── Close Add Step dropdown on outside click ───────────────────────────────
  useEffect(() => {
    if (!addingStep) return;
    const handler = (e: MouseEvent) => {
      if (!addStepDropdownRef.current?.contains(e.target as Node)) {
        setAddingStep(false);
        setPendingStepType(null);
        setPendingInsertAfterId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addingStep]);

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
      setSelectedStepId((prev) => (prev === stepId ? newId : prev));
    }
  }, []);

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

    // pendingInsertAfterId is set when adding via an edge + button — use it
    // in preference to selectedStepId so the right panel stays unchanged.
    const insertAfterId = pendingInsertAfterId ?? selectedStepId;

    if (!terminalStep || type === 'terminal') {
      // No terminal yet (or we're adding the terminal itself): append at end
      const lastId = editedSteps[editedSteps.length - 1]?.id;
      setEditedSteps((prev) => [...prev, newStep]);
      setEditedTransitions((prev) => lastId ? [...prev, { from: lastId, to: newId }] : prev);
    } else if (insertAfterId && insertAfterId !== terminalStep.id) {
      // Insert after the target step
      const insertIdx = editedSteps.findIndex((s) => s.id === insertAfterId);
      setEditedSteps((prev) => {
        const next = [...prev];
        next.splice(insertIdx + 1, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) => {
        // Edges from insertAfterId → their targets now go through newStep
        const outgoing = prev.filter((t) => t.from === insertAfterId);
        const others = prev.filter((t) => t.from !== insertAfterId);
        const rewired = outgoing.map((t) => ({ from: newId, to: t.to }));
        return [...others, { from: insertAfterId, to: newId }, ...rewired];
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

    // Only auto-select the new step when not inserting via an edge button
    // (edge button should leave the right panel unchanged).
    if (pendingInsertAfterId === null) {
      setSelectedStepId(newId);
    }
    setPendingInsertAfterId(null);
    setAddingStep(false);
    setPendingStepType(null);
  }, [editedSteps, selectedStepId, pendingInsertAfterId, saveSnapshot]);

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
          <div className="relative" ref={addStepDropdownRef}>
            <button
              onClick={() => { setAddingStep(!addingStep); setPendingStepType(null); setPendingInsertAfterId(null); }}
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
                      { type: 'creation', icon: PenLine,   label: 'Input',    description: 'A step where content or data is produced — by a human, an AI agent, or a script.', color: 'text-blue-600 dark:text-blue-400',   activeBg: 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-400' },
                      { type: 'review',   icon: Search,     label: 'Review',   description: 'A step where someone evaluates work and gives a verdict such as approve or reject.', color: 'text-amber-600 dark:text-amber-400', activeBg: 'bg-amber-50 dark:bg-amber-900/30 ring-1 ring-amber-400' },
                      { type: 'decision', icon: GitBranch,  label: 'Decision', description: 'A branching step that routes the workflow to different paths based on a condition.', color: 'text-purple-600 dark:text-purple-400', activeBg: 'bg-purple-50 dark:bg-purple-900/30 ring-1 ring-purple-400' },
                      { type: 'terminal', icon: Flag,       label: 'End',      description: 'Marks the final state of the workflow — all paths must lead here.',                 color: 'text-emerald-600 dark:text-emerald-400', activeBg: '' },
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
                          <div className="flex items-center gap-1.5">
                            <opt.icon className={cn('h-3.5 w-3.5 shrink-0', opt.color)} strokeWidth={1.5} />
                            <span className={cn('text-xs font-semibold', opt.color)}>{opt.label}</span>
                          </div>
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
            onEdgeAdd={(fromStepId) => { setPendingInsertAfterId(fromStepId); setAddingStep(true); }}
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
                        const doc = yamlParse(yamlDraft) as Record<string, unknown>;
                        const stepsResult = WorkflowStepSchema.array().safeParse(doc?.steps);
                        if (!stepsResult.success) {
                          setYamlError(`steps: ${stepsResult.error.issues[0]?.message ?? 'invalid'}`);
                          return;
                        }
                        const transitionsResult = TransitionSchema.array().safeParse(
                          Array.isArray(doc?.transitions) ? doc.transitions : [],
                        );
                        if (!transitionsResult.success) {
                          setYamlError(`transitions: ${transitionsResult.error.issues[0]?.message ?? 'invalid'}`);
                          return;
                        }
                        saveSnapshot();
                        setEditedSteps(stepsResult.data);
                        setEditedTransitions(transitionsResult.data);
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

