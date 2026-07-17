'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, HelpCircle, Save, KeyRound, Code2, Sparkles, ChevronRight, ChevronLeft, Plus, Send, Loader2, Bot, User, Settings, Check } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { json as jsonLang } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { cn } from '@/lib/utils';
import {
  WorkflowStepSchema,
  TransitionSchema,
  WORKFLOW_ASSISTANT_DEFAULT_MODEL,
  mergeVerdictTransitions,
  ensureEntryStepFirst,
  toSlug,
} from '@mediforce/platform-core';
import { validateWorkflowGraphAndReferences } from '@mediforce/workflow-engine';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import type { NewStepPayload } from '@/lib/control-mode';
import { BlockPicker } from './block-picker';
import { StepEditor } from './workflow-editor/step-editor';
import { ModelPicker } from './workflow-editor/model-picker';
import { selectBase } from './workflow-editor/step-editor-fields';
import { WorkflowSecretsEditor } from './workflow-secrets-editor';
import { computeMoveEligibility, ensureTerminalConnected } from './workflow-editor-utils';
import { useDockerImages, isImageAvailable } from '@/hooks/use-docker-images';
import { mediforce, ApiError } from '@/lib/mediforce';
import { validateSteps } from '@/lib/workflow-save-utils';
import { applyWorkflowAssistantToolCalls } from '@mediforce/platform-api/contract';
import type { WorkflowAssistantToolCall } from '@mediforce/platform-api/contract';

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  changes?: string;
}

function JsonCodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
        jsonLang(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

export interface WorkflowEditorCanvasProps {
  initialSteps: WorkflowStep[];
  initialTransitions: WorkflowDefinition['transitions'];
  wdJsonFields?: Record<string, unknown>;
  workflowName?: string;
  namespace?: string;
  renderSavePanel?: (
    steps: WorkflowStep[],
    transitions: WorkflowDefinition['transitions'],
    onDiscard: () => void,
  ) => React.ReactNode;
  onChange?: (steps: WorkflowStep[], transitions: WorkflowDefinition['transitions']) => void;
  stepErrors?: Record<string, Record<string, string>>;
}

export function WorkflowEditorCanvas({
  initialSteps,
  initialTransitions,
  wdJsonFields,
  workflowName,
  namespace,
  renderSavePanel,
  onChange,
  stepErrors,
}: WorkflowEditorCanvasProps) {
  const [editedSteps, setEditedSteps] = useState<WorkflowStep[]>(() => structuredClone(initialSteps));
  const [rightPanelView, setRightPanelView] = useState<'json' | 'secrets' | 'add-block' | null>(null);
  const [addBlockContext, setAddBlockContext] = useState<{ fromId: string; toId: string } | null>(null);
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
  const [editedTransitions, setEditedTransitions] = useState<WorkflowDefinition['transitions']>(() => structuredClone(initialTransitions));
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<Array<{ steps: WorkflowStep[]; transitions: WorkflowDefinition['transitions'] }>>([]);
  const [redoHistory, setRedoHistory] = useState<Array<{ steps: WorkflowStep[]; transitions: WorkflowDefinition['transitions'] }>>([]);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const lastSyncedJsonRef = useRef('');

  const selectedStep = editedSteps.find((s) => s.id === selectedStepId) ?? null;

  const { canMoveUp: canMoveUpSet, canMoveDown: canMoveDownSet } = computeMoveEligibility(editedSteps, editedTransitions);

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

  useEffect(() => {
    onChange?.(editedSteps, editedTransitions);
  }, [editedSteps, editedTransitions, onChange]);

  useEffect(() => {
    if (!stepErrors || Object.keys(stepErrors).length === 0) return;
    setSelectedStepId(Object.keys(stepErrors)[0]);
  }, [stepErrors]);

  useEffect(() => {
    const { steps: nextSteps, transitions: nextTransitions } = ensureTerminalConnected(editedSteps, editedTransitions);
    if (nextSteps !== editedSteps) setEditedSteps(nextSteps);
    if (nextTransitions !== editedTransitions) setEditedTransitions(nextTransitions);
  }, [editedSteps, editedTransitions]);

  const jsonPreviewForSync = JSON.stringify(
    { ...(wdJsonFields ?? {}), steps: editedSteps, transitions: editedTransitions },
    null,
    2,
  );
  useEffect(() => {
    if (jsonDraft === lastSyncedJsonRef.current) {
      setJsonDraft(jsonPreviewForSync);
      lastSyncedJsonRef.current = jsonPreviewForSync;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jsonPreviewForSync]);

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

  // Seeded from existing `new-step-N` ids, not hardcoded to 0 — otherwise
  // reopening a canvas with prior AI-generated steps collides on `new-step-1`.
  const stepCounterRef = useRef(
    initialSteps.reduce((max, s) => {
      const match = /^new-step-(\d+)$/.exec(s.id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0),
  );

  const addStep = useCallback((payload: NewStepPayload, insertAfterId: string | null = null, insertBeforeId: string | null = null) => {
    const terminalStep = editedSteps.find((s) => s.type === 'terminal');

    saveSnapshot();
    stepCounterRef.current += 1;
    const stepNum = stepCounterRef.current;
    const nameSlug = payload.name ? toSlug(payload.name) : '';
    let newId = nameSlug || `new-step-${stepNum}`;
    if (nameSlug) {
      let suffix = 2;
      while (editedSteps.some((s) => s.id === newId)) {
        newId = `${nameSlug}-${suffix}`;
        suffix += 1;
      }
    }
    const newStep: WorkflowStep = {
      ...payload,
      id: newId,
      name: payload.name || `New Step ${stepNum}`,
      ...(payload.executor === 'agent' ? { plugin: payload.plugin ?? 'opencode-agent', autonomyLevel: payload.autonomyLevel ?? 'L2' } : {}),
      ...(payload.executor === 'script' ? { plugin: payload.plugin ?? 'script-container' } : {}),
      ...(payload.executor === 'cowork' ? { cowork: payload.cowork ?? { agent: 'chat' as const } } : {}),
    };

    const resolvedInsertAfterId = insertAfterId ?? selectedStepId;

    if (!terminalStep) {
      const lastId = editedSteps[editedSteps.length - 1]?.id;
      setEditedSteps((prev) => [...prev, newStep]);
      setEditedTransitions((prev) => lastId ? [...prev, { from: lastId, to: newId }] : prev);
    } else if (resolvedInsertAfterId && resolvedInsertAfterId !== terminalStep.id) {
      const insertIdx = editedSteps.findIndex((s) => s.id === resolvedInsertAfterId);
      setEditedSteps((prev) => {
        const next = [...prev];
        next.splice(insertIdx + 1, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) => {
        if (insertBeforeId) {
          const others = prev.filter((t) => !(t.from === resolvedInsertAfterId && t.to === insertBeforeId));
          return [...others, { from: resolvedInsertAfterId, to: newId }, { from: newId, to: insertBeforeId }];
        }
        const outgoing = prev.filter((t) => t.from === resolvedInsertAfterId);
        const others = prev.filter((t) => t.from !== resolvedInsertAfterId);
        const rewired = outgoing.map((t) => ({ from: newId, to: t.to }));
        return [...others, { from: resolvedInsertAfterId, to: newId }, ...rewired];
      });
    } else {
      const terminalIdx = editedSteps.findIndex((s) => s.id === terminalStep.id);
      setEditedSteps((prev) => {
        const next = [...prev];
        next.splice(terminalIdx, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) => {
        const rewired = prev.map((t) =>
          t.to === terminalStep.id ? { ...t, to: newId } : t,
        );
        return [...rewired, { from: newId, to: terminalStep.id }];
      });
    }

    if (insertAfterId === null) {
      setSelectedStepId(newId);
    }
    return newId;
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

  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantModel, setAssistantModel] = useState<string | undefined>(undefined);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [assistantInput]);

  // Applies the whole batch through the server-validated reducer in one atomic
  // update, avoiding the stale-state bugs an imperative addStep/updateStep loop hit.
  const applyAssistantToolCalls = useCallback((toolCalls: WorkflowAssistantToolCall[]) => {
    const result = applyWorkflowAssistantToolCalls(editedStepsRef.current, editedTransitionsRef.current, toolCalls);
    saveSnapshot();
    setEditedSteps(result.steps);
    setEditedTransitions(result.transitions);
    const lastAdded = result.addedStepIds[result.addedStepIds.length - 1];
    if (lastAdded) setSelectedStepId(lastAdded);

    const errors = result.outcomes.flatMap((o) => (o.error ? [o.error] : []));
    if (errors.length > 0) return errors.join(' ');
    const counts = result.outcomes.reduce(
      (acc, o) => ({ ...acc, [o.tool]: (acc[o.tool] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    const parts: string[] = [];
    if (counts.add_step) parts.push(`added ${String(counts.add_step)} step${counts.add_step > 1 ? 's' : ''}`);
    if (counts.update_step) parts.push(`updated ${String(counts.update_step)} step${counts.update_step > 1 ? 's' : ''}`);
    if (counts.remove_step) parts.push(`removed ${String(counts.remove_step)} step${counts.remove_step > 1 ? 's' : ''}`);
    return parts.length > 0 ? `Updated the workflow — ${parts.join(', ')}.` : '';
  }, [saveSnapshot]);

  const sendAssistantMessage = useCallback(async () => {
    const content = assistantInput.trim();
    if (!content || assistantLoading || !namespace) return;

    const nextMessages: AssistantMessage[] = [...assistantMessages, { role: 'user', content }];
    setAssistantMessages(nextMessages);
    setAssistantInput('');
    setAssistantError(null);
    setAssistantLoading(true);

    try {
      const result = await mediforce.assistant.ask(
        {
          messages: nextMessages,
          model: assistantModel,
          workflowDefinition: { steps: editedSteps, transitions: editedTransitions },
        },
        { namespace },
      );
      const changes = result.toolCalls ? applyAssistantToolCalls(result.toolCalls) : '';
      const replyText = result.reply || (changes ? 'Done.' : '');
      setAssistantMessages((prev) => [...prev, { role: 'assistant', content: replyText, ...(changes ? { changes } : {}) }]);
      if (result.toolCalls) {
        // editedStepsRef only settles one macrotask after the state update commits.
        setTimeout(() => {
          const issue = validateSteps(editedStepsRef.current);
          if (issue) {
            setAssistantMessages((prev) => [...prev, { role: 'assistant', content: `Heads up — this won't save yet: ${issue}` }]);
          }
        }, 0);
      }
    } catch (err) {
      setAssistantError(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to reach the assistant');
    } finally {
      setAssistantLoading(false);
    }
  }, [assistantInput, assistantLoading, assistantMessages, assistantModel, namespace, editedSteps, editedTransitions, applyAssistantToolCalls]);

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

  const diagramDefinition = useMemo(() => ({
    steps: editedSteps,
    transitions: editedTransitions,
  }) as WorkflowDefinition, [editedSteps, editedTransitions]);

  const savePanel = renderSavePanel?.(editedSteps, editedTransitions, discardChanges) ?? null;

  const applyJson = () => {
    try {
      const doc = JSON.parse(jsonDraft) as Record<string, unknown>;
      const stepsResult = WorkflowStepSchema.array().safeParse(doc?.steps);
      if (!stepsResult.success) {
        setJsonError(`steps: ${stepsResult.error.issues[0]?.message ?? 'invalid'}`);
        return;
      }
      const transitionsResult = TransitionSchema.array().safeParse(
        Array.isArray(doc?.transitions) ? doc.transitions : [],
      );
      if (!transitionsResult.success) {
        setJsonError(`transitions: ${transitionsResult.error.issues[0]?.message ?? 'invalid'}`);
        return;
      }

      const mergedTransitions = mergeVerdictTransitions(stepsResult.data, transitionsResult.data);
      const orderedSteps = ensureEntryStepFirst(stepsResult.data, mergedTransitions);
      const { errors: validationErrors } = validateWorkflowGraphAndReferences({
        name: 'canvas-preview',
        version: 1,
        namespace: namespace ?? '',
        visibility: 'private',
        steps: orderedSteps,
        transitions: mergedTransitions,
        triggers: [{ type: 'manual', name: 'start' }],
      });
      if (validationErrors.length > 0) {
        setJsonError(validationErrors[0]);
        return;
      }

      // Apply the same ordered/merged graph that was validated, so the canvas
      // stores exactly what passed the gate (not the raw, pre-normalisation input).
      saveSnapshot();
      setEditedSteps(orderedSteps);
      setEditedTransitions(mergedTransitions);
      lastSyncedJsonRef.current = jsonDraft;
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
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

  return (
    <div className="flex flex-1 flex-col min-h-0">

      <div className="shrink-0 border-b px-4 py-1.5 flex items-center gap-1.5 flex-wrap bg-white dark:bg-background">

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
              onClick={() => setRightPanelView('json')}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors hover:bg-muted text-foreground"
            >
              <Code2 className="h-3.5 w-3.5" />
              Workflow source code
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/40 ml-0.5" />
            </button>
            <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-96 rounded-md border bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed space-y-1.5">
              <p>Mediforce workflows are defined as <strong>wd.json</strong> — the same JSON format used by every workflow package in the repo, capturing every step, transition, and configuration.</p>
              <p>You can author workflows three ways:</p>
              <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                <li>Use the <strong className="text-foreground">visual editor</strong> on the left</li>
                <li>Generate with the <strong className="text-foreground">AI Assistant</strong> pane on the right</li>
                <li>Write directly in the <strong className="text-foreground">code editor</strong> below</li>
              </ul>
            </span>
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">

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

        {aiPaneOpen ? (
          <div className="w-80 shrink-0 my-3 mr-3 rounded-xl border shadow-lg bg-white dark:bg-background flex flex-col min-h-0">
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-semibold shrink-0">AI Assistant</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setAssistantSettingsOpen((prev) => !prev)}
                  className={cn(
                    'rounded-md p-1 hover:bg-muted transition-colors',
                    assistantSettingsOpen ? 'text-foreground bg-muted' : 'text-muted-foreground hover:text-foreground',
                  )}
                  title="Assistant settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setAiPaneOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Collapse AI Assistant"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            {assistantSettingsOpen && (
              <div className="shrink-0 px-4 py-2 border-b space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Model</span>
                <ModelPicker
                  value={assistantModel}
                  onChange={setAssistantModel}
                  defaultModel={WORKFLOW_ASSISTANT_DEFAULT_MODEL}
                  requireToolSupport
                  className={selectBase}
                />
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {assistantMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Describe the workflow you want to build, or ask a question.
                </p>
              ) : (
                assistantMessages.map((message, index) => (
                  <div
                    key={index}
                    className={cn('flex gap-2 text-sm', message.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
                  >
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                        message.role === 'user' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {message.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    </div>
                    <div className="flex flex-col gap-1 max-w-[85%] min-w-0">
                      {message.content && (
                        <div
                          className={cn(
                            'rounded-lg px-3 py-2 whitespace-pre-wrap break-words',
                            message.role === 'user' ? 'bg-primary/10' : 'bg-muted',
                          )}
                        >
                          {message.content}
                        </div>
                      )}
                      {message.changes && (
                        <div className="inline-flex items-start gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5 text-xs text-green-700 dark:text-green-400">
                          <Check className="h-3.5 w-3.5 shrink-0 mt-px" />
                          <span>{message.changes}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {assistantLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking…
                </div>
              )}
              {assistantError && (
                <p className="text-sm text-destructive">{assistantError}</p>
              )}
            </div>
            <div className="shrink-0 border-t p-3">
              <div className="flex items-end gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                <textarea
                  ref={assistantInputRef}
                  value={assistantInput}
                  onChange={(e) => setAssistantInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendAssistantMessage();
                    }
                  }}
                  rows={1}
                  disabled={assistantLoading || !namespace}
                  placeholder={namespace ? 'Ask AI to build your workflow…' : 'Save the workflow first'}
                  className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed max-h-48 overflow-y-auto leading-relaxed"
                />
                <button
                  onClick={() => void sendAssistantMessage()}
                  disabled={assistantLoading || !namespace || assistantInput.trim().length === 0}
                  className="shrink-0 pb-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="h-4 w-4" />
                </button>
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

      </div>

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

      {rightPanelView === 'json' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRightPanelView(null)} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 space-y-4 max-h-[85vh] flex flex-col">
            <div className="shrink-0 flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Workflow source code (wd.json)</h2>
              </div>
              <button
                onClick={() => setRightPanelView(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4">
              <JsonCodeEditor
                value={jsonDraft}
                onChange={(v) => { setJsonDraft(v); setJsonError(null); }}
              />
              {savePanel && (
                <div className="border-t pt-4">
                  {savePanel}
                </div>
              )}
            </div>
            <div className="shrink-0 flex items-center justify-end gap-2 pt-1">
              {jsonError && (
                <p className="text-xs text-red-600 dark:text-red-400 mr-auto">{jsonError}</p>
              )}
              <button
                onClick={applyJson}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border hover:bg-muted text-foreground transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                Apply JSON to canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

