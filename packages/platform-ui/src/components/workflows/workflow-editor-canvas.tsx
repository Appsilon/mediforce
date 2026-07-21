'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, HelpCircle, Save, KeyRound, Code2, Sparkles, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
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
import type { NewStepPayload } from '@/lib/control-mode';
import { BlockPicker } from './block-picker';
import { StepEditor } from './workflow-editor/step-editor';
import { WorkflowSecretsEditor } from './workflow-secrets-editor';
import { computeMoveEligibility, ensureTerminalConnected } from './workflow-editor-utils';
import { useDockerImages, isImageAvailable } from '@/hooks/use-docker-images';

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
  /** Namespace handle — required for the in-editor secrets panel. */
  namespace?: string;
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
  namespace,
  renderSavePanel,
  onChange,
  stepErrors,
}: WorkflowEditorCanvasProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [editedSteps, setEditedSteps] = useState<WorkflowStep[]>(() => structuredClone(initialSteps));
  const [rightPanelView, setRightPanelView] = useState<'yaml' | 'secrets' | 'add-block' | null>(null);
  const [addBlockContext, setAddBlockContext] = useState<{ fromId: string; toId: string } | null>(null);
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
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

  // ── Docker image warnings ─────────────────────────────────────────────────
  const { images: dockerImages, isAvailable: dockerAvailable } = useDockerImages();
  const warningStepIds = useMemo(() => {
    if (!dockerAvailable) return undefined;
    const map = new Map<string, string>();
    for (const step of editedSteps) {
      const image = step.agent?.image ?? step.script?.image;
      if (typeof image === 'string' && image.length > 0 && !isImageAvailable(dockerImages, image)) {
        map.set(step.id, `Image '${image}' not available on platform`);
      }
    }
    return map.size > 0 ? map : undefined;
  }, [dockerAvailable, dockerImages, editedSteps]);

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

  const stepCounterRef = useRef(0);

  const addStep = useCallback((payload: NewStepPayload, insertAfterId: string | null = null, insertBeforeId: string | null = null) => {
    const terminalStep = editedSteps.find((s) => s.type === 'terminal');

    saveSnapshot();
    stepCounterRef.current += 1;
    const stepNum = stepCounterRef.current;
    const newId = `new-step-${stepNum}`;
    const newStep: WorkflowStep = {
      id: newId,
      name: `New Step ${stepNum}`,
      type: payload.type,
      executor: payload.executor as WorkflowStep['executor'],
      ...(payload.autonomyLevel ? { autonomyLevel: payload.autonomyLevel as WorkflowStep['autonomyLevel'] } : {}),
      ...(payload.agentId ? { agentId: payload.agentId } : {}),
      ...(payload.executor === 'agent' && !payload.autonomyLevel ? { plugin: 'opencode-agent', autonomyLevel: 'L2' } : {}),
      ...(payload.executor === 'agent' && payload.autonomyLevel ? { plugin: 'opencode-agent' } : {}),
      ...(payload.executor === 'script' ? { plugin: 'script-container' } : {}),
      ...(payload.executor === 'cowork' ? { cowork: payload.cowork ?? { agent: 'chat' as const } } : {}),
    };

    // When inserting via an edge button, insertAfterId is set explicitly.
    // Otherwise fall back to the currently selected step.
    const resolvedInsertAfterId = insertAfterId ?? selectedStepId;

    if (!terminalStep) {
      // No terminal yet: append at end
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
        if (insertBeforeId) {
          // Edge-button path: only splice into the one clicked edge A→B.
          // Other outgoing transitions from A (e.g. back-edges) stay on A.
          const others = prev.filter((t) => !(t.from === resolvedInsertAfterId && t.to === insertBeforeId));
          return [...others, { from: resolvedInsertAfterId, to: newId }, { from: newId, to: insertBeforeId }];
        }
        // Selected-step fallback: rewire all outgoing transitions through newStep.
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
  const diagramDefinition = useMemo(() => ({
    steps: editedSteps,
    transitions: editedTransitions,
  }) as WorkflowDefinition, [editedSteps, editedTransitions]);



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

  const handleRequestAddStep = useCallback((fromId: string, toId: string) => {
    setSelectedStepId(null);
    setAddBlockContext({ fromId, toId });
    setRightPanelView('add-block');
  }, []);

  const handleBlockAdd = useCallback((payload: NewStepPayload) => {
    if (addBlockContext) {
      addStep(payload, addBlockContext.fromId, addBlockContext.toId);
    } else {
      addStep(payload);
    }
    setAddBlockContext(null);
    setRightPanelView(null);
  }, [addBlockContext, addStep]);

  const closeAddBlock = useCallback(() => {
    setAddBlockContext(null);
    setRightPanelView(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 flex-col min-h-0">

      {/* ── Unified sticky toolbar ── */}
      <div className="shrink-0 border-b px-4 py-1.5 flex items-center gap-1.5 flex-wrap bg-white dark:bg-background">

        {/* Right-aligned: Secrets + Workflow source code */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setRightPanelView('secrets')}
            title="Workflow secrets"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors hover:bg-muted text-foreground"
          >
            <KeyRound className="h-3.5 w-3.5" />
            Secrets
          </button>

          <span className="group relative inline-flex">
            <button
              onClick={() => setRightPanelView('yaml')}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors hover:bg-muted text-foreground"
            >
              <Code2 className="h-3.5 w-3.5" />
              Workflow source code
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40 ml-0.5" />
            </button>
            <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-96 rounded-md border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed space-y-1.5">
              <p>Mediforce workflows are defined in <strong>YAML</strong> — a human-readable format that captures every step, transition, and configuration.</p>
              <p>You can author workflows three ways:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li>Use the <strong className="text-foreground">visual editor</strong> on the left</li>
                <li>Generate with the <strong className="text-foreground">AI Assistant</strong> pane on the right</li>
                <li>Write directly in the <strong className="text-foreground">code editor</strong> below</li>
              </ul>
            </span>
          </span>
        </div>
      </div>{/* end unified toolbar */}

      {/* ── Canvas + settings pane + AI pane ── */}
      <div className="flex flex-1 min-h-0">

        {/* Canvas — takes all remaining width, XYFlow owns the height */}
        <div className="flex-1 min-h-0">
          <WorkflowDiagram
            definition={diagramDefinition}
            className="border-0 h-full"
            style={{ height: '100%' }}
            onNodeClick={(stepId) => {
              setSelectedStepId(stepId === selectedStepId ? null : stepId);
              if (rightPanelView === 'add-block') closeAddBlock();
            }}
            onNodeDelete={removeStep}
            onNodeMoveUp={(stepId) => moveStep(stepId, 'up')}
            onNodeMoveDown={(stepId) => moveStep(stepId, 'down')}
            onRequestAddStep={handleRequestAddStep}
            onPaneClick={() => setSelectedStepId(null)}
            selectedStepId={selectedStepId}
            errorStepIds={stepErrors ? new Set(Object.keys(stepErrors)) : undefined}
            warningStepIds={warningStepIds}
            canMoveUp={canMoveUpSet}
            canMoveDown={canMoveDownSet}
            onUndo={undoEdit}
            onRedo={redoEdit}
            canUndo={editHistory.length > 0}
            canRedo={redoHistory.length > 0}
            onAddBlock={() => { setSelectedStepId(null); setAddBlockContext(null); setRightPanelView('add-block'); }}
            addBlockActive={rightPanelView === 'add-block'}
          />
        </div>

        {/* Settings pane — step editor or add-block. Floats above the canvas; closeable; hidden by default. */}
        {(selectedStep || rightPanelView === 'add-block') && (
          <div className="w-80 shrink-0 my-3 mr-3 rounded-xl border shadow-lg bg-white dark:bg-background flex flex-col min-h-0">
            {selectedStep ? (
              <>
                <div className="shrink-0 flex justify-end px-2 pt-2">
                  <button
                    onClick={() => setSelectedStepId(null)}
                    className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
                  <StepEditor
                    step={selectedStep}
                    allSteps={editedSteps}
                    workflowName={workflowName}
                    onChange={(patch) => updateStep(selectedStep.id, patch)}
                    errors={stepErrors?.[selectedStep.id]}
                    imageWarning={warningStepIds?.get(selectedStep.id)}
                    dockerImages={dockerImages}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
                  <div className="flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    <span className="text-sm font-semibold">
                      {addBlockContext ? 'Insert step' : 'Add block'}
                    </span>
                    {addBlockContext && (
                      <span className="text-[10px] text-muted-foreground font-normal">on edge</span>
                    )}
                  </div>
                  <button
                    onClick={closeAddBlock}
                    className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <BlockPicker onAdd={handleBlockAdd} />
                </div>
              </>
            )}
          </div>
        )}

        {/* AI pane — floats above the canvas, independent of settings pane; collapses to a thin strip */}
        {aiPaneOpen ? (
          <div className="w-80 shrink-0 my-3 mr-3 rounded-xl border shadow-lg bg-white dark:bg-background flex flex-col min-h-0">
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">AI Assistant</span>
              </div>
              <button
                onClick={() => setAiPaneOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Collapse AI Assistant"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-sm text-muted-foreground text-center">To be implemented</p>
            </div>
            <div className="shrink-0 border-t p-3">
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 opacity-50 cursor-not-allowed">
                <input
                  disabled
                  placeholder="Ask AI to build your workflow…"
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAiPaneOpen(true)}
            className="w-10 shrink-0 my-3 mr-3 rounded-xl border shadow-lg bg-white dark:bg-background flex flex-col items-center justify-between py-4 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Expand AI Assistant"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180 select-none">
              AI Assistant
            </span>
            <ChevronLeft className="h-4 w-4 shrink-0" />
          </button>
        )}

      </div>{/* end canvas + settings pane + AI pane */}

      {/* ── Secrets modal ── */}
      {rightPanelView === 'secrets' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRightPanelView(null)} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Secrets</h2>
              </div>
              <button
                onClick={() => setRightPanelView(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {namespace && workflowName ? (
              <WorkflowSecretsEditor
                namespace={namespace}
                workflowName={workflowName}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Save the workflow first to manage secrets.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Workflow source code modal ── */}
      {rightPanelView === 'yaml' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRightPanelView(null)} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 space-y-4 max-h-[85vh] flex flex-col">
            <div className="shrink-0 flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Workflow source code</h2>
              </div>
              <button
                onClick={() => setRightPanelView(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4">
              <YamlCodeEditor
                value={yamlDraft}
                onChange={(v) => { setYamlDraft(v); setYamlError(null); }}
              />
              {savePanel && (
                <div className="border-t pt-4">
                  {savePanel}
                </div>
              )}
            </div>
            <div className="shrink-0 flex items-center justify-end gap-2 pt-1">
              {yamlError && (
                <p className="text-xs text-red-600 dark:text-red-400 mr-auto">{yamlError}</p>
              )}
              <button
                onClick={applyYaml}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border hover:bg-muted text-foreground transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Apply YAML to canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

