'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, HelpCircle, Save, Undo2, Redo2 } from 'lucide-react';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { tags } from '@lezer/highlight';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { cn } from '@/lib/utils';
import { WorkflowStepSchema, TransitionSchema } from '@mediforce/platform-core';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { StepEditor } from './workflow-editor/step-editor';
import { computeMoveEligibility, ensureTerminalConnected } from './workflow-editor-utils';

// ---------------------------------------------------------------------------
// YAML code editor (CodeMirror 6)
// ---------------------------------------------------------------------------

function YamlCodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const externalUpdateRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        yamlLang(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdateRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { fontSize: '11px', height: 'auto' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'visible' },
          '.cm-content': { padding: '8px 0' },
          '.cm-gutters': { borderRight: '1px solid var(--border)', background: 'transparent', color: 'hsl(var(--muted-foreground))', fontSize: '10px' },
          '.cm-activeLineGutter': { background: 'transparent' },
          // Syntax token colours (using CSS vars so they adapt to light/dark)
          '.cm-tok-key':     { color: 'hsl(var(--primary))', fontWeight: '500' },
          '.cm-tok-string':  { color: 'hsl(var(--color-status-warn))' },
          '.cm-tok-number':  { color: 'hsl(38 75% 45%)' },
          '.cm-tok-bool':    { color: 'hsl(var(--color-status-ok))' },
          '.cm-tok-null':    { color: 'hsl(var(--muted-foreground))' },
          '.cm-tok-comment': { color: 'hsl(var(--muted-foreground))', fontStyle: 'italic' },
          '.cm-tok-punct':   { color: 'hsl(var(--muted-foreground) / 0.6)' },
        }),
        syntaxHighlighting(HighlightStyle.define([
          { tag: tags.propertyName,              class: 'cm-tok-key' },
          { tag: tags.string,                    class: 'cm-tok-string' },
          { tag: tags.number,                    class: 'cm-tok-number' },
          { tag: [tags.bool, tags.atom],         class: 'cm-tok-bool' },
          { tag: tags.null,                      class: 'cm-tok-null' },
          { tag: tags.comment,                   class: 'cm-tok-comment' },
          { tag: [tags.separator, tags.bracket], class: 'cm-tok-punct' },
        ])),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // init-only: value is synced via the second useEffect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync externally-driven value changes into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    externalUpdateRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    externalUpdateRef.current = false;
  }, [value]);

  return (
    <div
      ref={containerRef}
      className="rounded-lg border overflow-hidden [&_.cm-editor]:outline-none [&_.cm-editor.cm-focused]:outline-none"
    />
  );
}

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
  const [editHistory, setEditHistory] = useState<Array<{ steps: WorkflowStep[]; transitions: WorkflowDefinition['transitions'] }>>([]);
  const [redoHistory, setRedoHistory] = useState<Array<{ steps: WorkflowStep[]; transitions: WorkflowDefinition['transitions'] }>>([]);
  const [yamlDraft, setYamlDraft] = useState('');
  const [yamlError, setYamlError] = useState<string | null>(null);
  // Tracks the last value we pushed into yamlDraft from the diagram,
  // so we can distinguish "user edits" from "diagram-driven updates".
  const lastSyncedYamlRef = useRef('');

  const selectedStep = editedSteps.find((s) => s.id === selectedStepId) ?? null;

  // ── Move eligibility (all steps, used by diagram hover buttons) ─────────────
  const { canMoveUp: canMoveUpSet, canMoveDown: canMoveDownSet } = computeMoveEligibility(editedSteps, editedTransitions);

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
    setRedoHistory([]);
  }, []);

  const undoEdit = useCallback(() => {
    setEditHistory((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setRedoHistory((r) => [...r, { steps: editedStepsRef.current, transitions: editedTransitionsRef.current }]);
      setEditedSteps(snapshot.steps);
      setEditedTransitions(snapshot.transitions);
      return prev.slice(0, -1);
    });
  }, []);

  const redoEdit = useCallback(() => {
    setRedoHistory((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      setEditHistory((h) => [...h, { steps: editedStepsRef.current, transitions: editedTransitionsRef.current }]);
      setEditedSteps(snapshot.steps);
      setEditedTransitions(snapshot.transitions);
      return prev.slice(0, -1);
    });
  }, []);

  const discardChanges = useCallback(() => {
    setEditedSteps(structuredClone(initialSteps));
    setEditedTransitions(structuredClone(initialTransitions));
    setEditHistory([]);
    setRedoHistory([]);
    setSelectedStepId(null);
  }, [initialSteps, initialTransitions]);

  // ── Ctrl+Z / Ctrl+Shift+Z ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undoEdit();
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        redoEdit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undoEdit, redoEdit]);

  // ── Notify parent of changes ───────────────────────────────────────────────
  useEffect(() => {
    onChange?.(editedSteps, editedTransitions);
  }, [editedSteps, editedTransitions, onChange]);

  // ── Auto-select first errored step ─────────────────────────────────────────
  useEffect(() => {
    if (!stepErrors || Object.keys(stepErrors).length === 0) return;
    setSelectedStepId(Object.keys(stepErrors)[0]);
  }, [stepErrors]);

  // ── Ensure terminal step always exists + auto-connect orphaned steps ──────────
  useEffect(() => {
    const { steps: nextSteps, transitions: nextTransitions } = ensureTerminalConnected(editedSteps, editedTransitions);
    if (nextSteps !== editedSteps) setEditedSteps(nextSteps);
    if (nextTransitions !== editedTransitions) setEditedTransitions(nextTransitions);
  }, [editedSteps, editedTransitions]);

  // ── Sync yamlPreview → yamlDraft when diagram changes (not user edits) ───────
  const yamlPreviewForSync = yamlStringify(
    { ...(yamlFields ?? {}), steps: editedSteps, transitions: editedTransitions },
    { indent: 2 },
  );
  useEffect(() => {
    if (yamlDraft === lastSyncedYamlRef.current) {
      setYamlDraft(yamlPreviewForSync);
      lastSyncedYamlRef.current = yamlPreviewForSync;
    }
  // yamlDraft intentionally omitted — we only want to run this when the diagram changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yamlPreviewForSync]);


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

  const addStep = useCallback((type: WorkflowStep['type'], executor: WorkflowStep['executor'], insertAfterId: string | null = null) => {
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

    // When inserting via an edge button, insertAfterId is set explicitly.
    // Otherwise fall back to the currently selected step.
    const resolvedInsertAfterId = insertAfterId ?? selectedStepId;

    if (!terminalStep || type === 'terminal') {
      // No terminal yet (or we're adding the terminal itself): append at end
      const lastId = editedSteps[editedSteps.length - 1]?.id;
      setEditedSteps((prev) => [...prev, newStep]);
      setEditedTransitions((prev) => lastId ? [...prev, { from: lastId, to: newId }] : prev);
    } else if (resolvedInsertAfterId && resolvedInsertAfterId !== terminalStep.id) {
      // Insert after the target step
      const insertIdx = editedSteps.findIndex((s) => s.id === resolvedInsertAfterId);
      setEditedSteps((prev) => {
        const next = [...prev];
        next.splice(insertIdx + 1, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) => {
        // Edges from resolvedInsertAfterId → their targets now go through newStep
        const outgoing = prev.filter((t) => t.from === resolvedInsertAfterId);
        const others = prev.filter((t) => t.from !== resolvedInsertAfterId);
        const rewired = outgoing.map((t) => ({ from: newId, to: t.to }));
        return [...others, { from: resolvedInsertAfterId, to: newId }, ...rewired];
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
    if (insertAfterId === null) {
      setSelectedStepId(newId);
    }
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



  const savePanel = renderSavePanel?.(editedSteps, editedTransitions, discardChanges) ?? null;

  const applyYaml = () => {
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
      lastSyncedYamlRef.current = yamlDraft;
      setYamlError(null);
    } catch (err) {
      setYamlError(err instanceof Error ? err.message : 'Invalid YAML');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col min-h-0">

      {/* ── Unified sticky toolbar ── */}
      <div className="shrink-0 border-b px-4 py-2 flex items-center gap-1.5 flex-wrap bg-background">

        <button
            onClick={undoEdit}
            disabled={editHistory.length === 0}
            title="Undo last change (Ctrl+Z)"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors',
              editHistory.length > 0 ? 'hover:bg-muted text-foreground' : 'opacity-40 cursor-not-allowed text-muted-foreground',
            )}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>

          <button
            onClick={redoEdit}
            disabled={redoHistory.length === 0}
            title="Redo last change (Ctrl+Shift+Z)"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors',
              redoHistory.length > 0 ? 'hover:bg-muted text-foreground' : 'opacity-40 cursor-not-allowed text-muted-foreground',
            )}
          >
            <Redo2 className="h-3.5 w-3.5" />
            Redo
          </button>

          {/* Right section: YAML title + save (hidden when a step is selected) */}
          {!selectedStepId && (
            <div className="ml-auto flex items-center gap-2">
              <div className="w-px h-4 bg-border" />
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">Workflow source code</span>
                <span className="group relative inline-flex items-center">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
                  <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-96 rounded-md border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed space-y-1.5">
                    <p>Mediforce workflows are defined in <strong>YAML</strong> — a human-readable format that captures every step, transition, and configuration.</p>
                    <p>You can author workflows three ways:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                      <li>Use the <strong className="text-foreground">visual editor</strong> on the left</li>
                      <li>Generate with <strong className="text-foreground">AI</strong> via the Workflow Designer workflow</li>
                      <li>Write directly in the <strong className="text-foreground">code editor</strong> below</li>
                    </ul>
                  </span>
                </span>
              </div>
              {yamlError && (
                <p className="text-xs text-red-600 dark:text-red-400">{yamlError}</p>
              )}
              <button
                onClick={applyYaml}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border hover:bg-muted text-foreground transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Apply YAML to canvas
              </button>
            </div>
          )}
        </div>{/* end unified toolbar */}

        {/* ── Two-column content area ── */}
        <div className="flex flex-1 overflow-y-auto items-start">

          {/* Diagram column */}
          <div className="flex-1 p-6 pt-4">
            <WorkflowDiagram
              definition={diagramDefinition}
              className="border-0"
              onNodeClick={(stepId) => setSelectedStepId(stepId === selectedStepId ? null : stepId)}
              onNodeDelete={removeStep}
              onNodeMoveUp={(stepId) => moveStep(stepId, 'up')}
              onNodeMoveDown={(stepId) => moveStep(stepId, 'down')}
              onEdgeAdd={(fromStepId, type, executor) => addStep(type, executor, fromStepId)}
              onPaneClick={() => setSelectedStepId(null)}
              selectedStepId={selectedStepId}
              errorStepIds={stepErrors ? new Set(Object.keys(stepErrors)) : undefined}
              canMoveUp={canMoveUpSet}
              canMoveDown={canMoveDownSet}
            />
          </div>

          {/* Side panel */}
          <div className="w-1/2 shrink-0 border-l bg-background">
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
                  <YamlCodeEditor
                    value={yamlDraft}
                    onChange={(v) => { setYamlDraft(v); setYamlError(null); }}
                  />
                  {savePanel && (
                    <div className="border-t pt-4">
                      {savePanel}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>{/* end two-column */}
    </div>
  );
}

