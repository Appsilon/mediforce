'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { X, HelpCircle, Save, KeyRound, Code2, FileCode, Sparkles, ChevronRight, ChevronLeft, Send, Loader2, Bot, User, Settings, SlidersHorizontal, Bell, Check, AlertTriangle, Square } from 'lucide-react';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { cn } from '@/lib/utils';
import {
  WorkflowStepSchema,
  TransitionSchema,
  InputForNextRunEntrySchema,
  WORKFLOW_ASSISTANT_DEFAULT_MODEL,
  mergeVerdictTransitions,
  ensureEntryStepFirst,
  uniqueSlug,
  validateWorkflowGraphAndReferences,
} from '@mediforce/platform-core';
import type { WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import type { NewStepPayload } from '@/lib/control-mode';
import { BlockPicker } from './block-picker';
import { AuthoringPathsPopover } from './authoring-paths-popover';
import { StepEditor } from './workflow-editor/step-editor';
import { ModelPicker } from './workflow-editor/model-picker';
import { selectBase } from './workflow-editor/step-editor-fields';
import { WorkflowSecretsEditor } from './workflow-secrets-editor';
import { useWorkspaceRoles } from '@/hooks/use-workspace-roles';
import { WorkflowSettingsPanel } from './workflow-settings-panel';
import { WorkflowNotificationsPanel } from './workflow-notifications-panel';
import { pruneWorkflowSettings } from './workflow-settings-utils';
import type { WorkflowSettingsDraft } from './workflow-settings-utils';
import { unheldStepRoles } from './workflow-editor-utils';
import { computeMoveEligibility, ensureTerminalConnected, retargetVerdictTargets, bridgeTargetForDeletion, splitPastedDefinition, spliceStepIntoTransitions, retargetCarryOver, pruneCarryOver } from './workflow-editor-utils';
import { useDockerImages, isImageAvailable } from '@/hooks/use-docker-images';
import { mediforce, ApiError } from '@/lib/mediforce';
import { validateSteps } from '@/lib/workflow-save-utils';
import { useToast } from '@/components/command-palette';
import { applyWorkflowAssistantToolCalls, type WorkflowAssistantToolCall } from '@mediforce/platform-core';
import { CodeEditor } from './workflow-editor/code-editor';
import { WorkflowFilesPanel } from './workflow-files-panel';
import { AssistantPlan, answersMessage } from './assistant-plan';
import type { PlanWorkflowBuildOutput } from '@mediforce/platform-api/contract';
import { messagesForModel, type AssistantMessage } from '@/lib/assistant-conversation';
import { formatDuration } from '@/lib/format';


// Rotating status shown while the assistant works — the request is a single
// non-streaming call, so these are indicative phases, not live server progress.
const ASSISTANT_PHASES = ['Thinking…', 'Planning the workflow…', 'Building steps…', 'Wiring transitions…', 'Validating…'] as const;

export interface WorkflowEditorCanvasProps {
  initialSteps: WorkflowStep[];
  initialTransitions: WorkflowDefinition['transitions'];
  initialInputForNextRun?: WorkflowDefinition['inputForNextRun'];
  wdJsonFields?: Record<string, unknown>;
  /** Applied when a pasted document carries fields outside the graph, so the
   *  source panel can round-trip a whole definition instead of refusing it. */
  onNonGraphFieldsChange?: (fields: Record<string, unknown>) => void;
  /** The workflow-level fields the settings panel edits. Owned by the page,
   *  which is what registers them. */
  settingsDraft?: WorkflowSettingsDraft;
  onSettingsChange?: (draft: WorkflowSettingsDraft) => void;
  workflowExternalSkillsRepo?: WorkflowDefinition['externalSkillsRepo'];
  workflowName?: string;
  namespace?: string;
  renderSavePanel?: (
    steps: WorkflowStep[],
    transitions: WorkflowDefinition['transitions'],
    onDiscard: () => void,
  ) => React.ReactNode;
  onChange?: (
    steps: WorkflowStep[],
    transitions: WorkflowDefinition['transitions'],
    inputForNextRun: WorkflowDefinition['inputForNextRun'],
  ) => void;
  onDirtyChange?: (dirty: boolean) => void;
  stepErrors?: Record<string, Record<string, string>>;
}

/**
 * The graph the canvas edits. `inputForNextRun` belongs here rather than to the
 * page's non-graph fields: its entries name step ids, so a rename or a deletion
 * has to move them the same way it moves transitions and verdict targets.
 */
interface CanvasGraph {
  steps: WorkflowStep[];
  transitions: WorkflowDefinition['transitions'];
  inputForNextRun: WorkflowDefinition['inputForNextRun'];
}

function serializeGraph(graph: CanvasGraph): string {
  return JSON.stringify(graph);
}

export function WorkflowEditorCanvas({
  initialSteps,
  initialTransitions,
  initialInputForNextRun,
  wdJsonFields,
  onNonGraphFieldsChange,
  settingsDraft,
  onSettingsChange,
  workflowExternalSkillsRepo,
  workflowName,
  namespace,
  renderSavePanel,
  onChange,
  onDirtyChange,
  stepErrors,
}: WorkflowEditorCanvasProps) {
  const [editedSteps, setEditedSteps] = useState<WorkflowStep[]>(() => structuredClone(initialSteps));
  const [rightPanelView, setRightPanelView] = useState<'json' | 'secrets' | 'settings' | 'notifications' | 'files' | 'add-block' | null>(null);
  const [addBlockContext, setAddBlockContext] = useState<{ fromId: string; toId: string } | null>(null);
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
  const [editedTransitions, setEditedTransitions] = useState<WorkflowDefinition['transitions']>(() => structuredClone(initialTransitions));
  const [editedInputForNextRun, setEditedInputForNextRun] = useState<WorkflowDefinition['inputForNextRun']>(() => structuredClone(initialInputForNextRun));
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<CanvasGraph[]>([]);
  const [redoHistory, setRedoHistory] = useState<CanvasGraph[]>([]);
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const lastSyncedJsonRef = useRef('');

  const selectedStep = editedSteps.find((s) => s.id === selectedStepId) ?? null;

  const { canMoveUp: canMoveUpSet, canMoveDown: canMoveDownSet } = computeMoveEligibility(editedSteps, editedTransitions);

  const { toast } = useToast();
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
  const editedInputForNextRunRef = useRef(editedInputForNextRun);
  useEffect(() => { editedStepsRef.current = editedSteps; }, [editedSteps]);
  useEffect(() => { editedTransitionsRef.current = editedTransitions; }, [editedTransitions]);
  useEffect(() => { editedInputForNextRunRef.current = editedInputForNextRun; }, [editedInputForNextRun]);

  const currentGraph = useCallback((): CanvasGraph => ({
    steps: editedStepsRef.current,
    transitions: editedTransitionsRef.current,
    inputForNextRun: editedInputForNextRunRef.current,
  }), []);

  const restoreGraph = useCallback((graph: CanvasGraph) => {
    setEditedSteps(graph.steps);
    setEditedTransitions(graph.transitions);
    setEditedInputForNextRun(graph.inputForNextRun);
  }, []);

  const saveSnapshot = useCallback(() => {
    setEditHistory((prev) => [...prev, currentGraph()]);
    setRedoHistory([]);
  }, [currentGraph]);

  const undoEdit = useCallback(() => {
    setEditHistory((prev) => {
      if (prev.length === 0) return prev;
      setRedoHistory((r) => [...r, currentGraph()]);
      restoreGraph(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
  }, [currentGraph, restoreGraph]);

  const redoEdit = useCallback(() => {
    setRedoHistory((prev) => {
      if (prev.length === 0) return prev;
      setEditHistory((h) => [...h, currentGraph()]);
      restoreGraph(prev[prev.length - 1]);
      return prev.slice(0, -1);
    });
  }, [currentGraph, restoreGraph]);

  const discardChanges = useCallback(() => {
    restoreGraph({
      steps: structuredClone(initialSteps),
      transitions: structuredClone(initialTransitions),
      inputForNextRun: structuredClone(initialInputForNextRun),
    });
    setEditHistory([]);
    setRedoHistory([]);
    setSelectedStepId(null);
  }, [initialSteps, initialTransitions, initialInputForNextRun, restoreGraph]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes the Advanced, Notifications and Files panels, including
      // from inside their own fields, which is where a person editing them is.
      // The JSON panel is left out on purpose: closing it asks about unapplied
      // changes first, so it cannot be dismissed by a keystroke.
      if (
        e.key === 'Escape' &&
        (rightPanelView === 'settings' || rightPanelView === 'notifications' || rightPanelView === 'files')
      ) {
        setRightPanelView(null);
        return;
      }
      // Don't hijack native undo/redo while the user is typing in a form field
      // or the JSON/code editor — this shortcut is only for the diagram's own
      // edit history.
      const target = e.target as HTMLElement | null;
      if (
        target !== null &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.closest('.cm-editor') !== null)
      ) {
        return;
      }
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
  }, [undoEdit, redoEdit, rightPanelView]);

  useEffect(() => {
    onChange?.(editedSteps, editedTransitions, editedInputForNextRun);
  }, [editedSteps, editedTransitions, editedInputForNextRun, onChange]);

  // Compare against the *normalised* baseline: mounting runs the incoming graph
  // through `ensureTerminalConnected` below, so an un-normalised definition
  // would otherwise read as edited before the user touches anything.
  const baselineGraph = useMemo(() => {
    const normalized = ensureTerminalConnected(initialSteps, initialTransitions);
    return serializeGraph({ ...normalized, inputForNextRun: initialInputForNextRun });
  }, [initialSteps, initialTransitions, initialInputForNextRun]);
  const isDirty = serializeGraph({
    steps: editedSteps,
    transitions: editedTransitions,
    inputForNextRun: editedInputForNextRun,
  }) !== baselineGraph;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!stepErrors || Object.keys(stepErrors).length === 0) return;
    setSelectedStepId(Object.keys(stepErrors)[0]);
  }, [stepErrors]);

  useEffect(() => {
    const { steps: nextSteps, transitions: nextTransitions } = ensureTerminalConnected(editedSteps, editedTransitions);
    if (nextSteps !== editedSteps) setEditedSteps(nextSteps);
    if (nextTransitions !== editedTransitions) setEditedTransitions(nextTransitions);
  }, [editedSteps, editedTransitions]);

  // A step leaves the canvas by three routes — the diagram's delete, the
  // assistant's remove_step, an applied JSON document — and all three land
  // here, so the carry-over entries that named it are dropped once. Keeping a
  // dangling entry is not an option: the server's cross-field check refuses the
  // save. Renames never reach this point; `updateStep` retargets them instead.
  useEffect(() => {
    const pruned = pruneCarryOver(editedInputForNextRun, editedSteps);
    if (pruned === editedInputForNextRun) return;
    const dropped = (editedInputForNextRun ?? []).filter((entry) => !pruned?.includes(entry));
    setEditedInputForNextRun(pruned);
    toast({
      variant: 'warning',
      title: 'Carry-over to the next run removed',
      description: `${dropped.map((entry) => `"${entry.as}"`).join(', ')} came from a step that is no longer in this workflow, so the next run will not receive it.`,
    });
  }, [editedSteps, editedInputForNextRun, toast]);

  const jsonPreviewForSync = JSON.stringify(
    {
      ...(wdJsonFields ?? {}),
      steps: editedSteps,
      transitions: editedTransitions,
      ...(editedInputForNextRun ? { inputForNextRun: editedInputForNextRun } : {}),
    },
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
    const requestedId = patch.id;
    const newId = requestedId && requestedId !== stepId
      ? uniqueSlug(requestedId, editedStepsRef.current.map((step) => step.id), stepId)
      : requestedId;
    const normalizedPatch = requestedId && newId !== requestedId
      ? { ...patch, id: newId }
      : patch;
    setEditedSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, ...normalizedPatch } : s)),
    );
    if (newId && newId !== stepId) {
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
      setEditedInputForNextRun((prev) => retargetCarryOver(prev, stepId, newId));
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
    const existingIds = editedSteps.map((step) => step.id);
    const newId = uniqueSlug(payload.name ?? '', existingIds)
      || uniqueSlug(`new-step-${String(stepNum)}`, existingIds);
    const newStep: WorkflowStep = {
      ...payload,
      id: newId,
      name: payload.name || `New Step ${stepNum}`,
      ...(payload.executor === 'agent' ? { plugin: payload.plugin ?? 'opencode-agent', autonomyLevel: payload.autonomyLevel ?? 'L3' } : {}),
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
        // Verdicts route independently of transitions: repoint the split edge's
        // verdict target (or all of this step's verdicts when taking over its
        // whole outgoing) at the inserted step so review/decision routing goes
        // through it instead of skipping it.
        const retargeted = retargetVerdictTargets(
          prev,
          resolvedInsertAfterId,
          insertBeforeId ?? null,
          newId,
        );
        const next = [...retargeted];
        next.splice(insertIdx + 1, 0, newStep);
        return next;
      });
      setEditedTransitions((prev) =>
        spliceStepIntoTransitions(prev, resolvedInsertAfterId, insertBeforeId ?? null, newId),
      );
    } else {
      const terminalIdx = editedSteps.findIndex((s) => s.id === terminalStep.id);
      setEditedSteps((prev) => {
        // Any verdict pointing at the terminal now routes through the inserted
        // step, mirroring the transition rewiring below.
        const retargeted = retargetVerdictTargets(prev, null, terminalStep.id, newId);
        const next = [...retargeted];
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
    // A verdict pointing at the deleted step would dangle (review/decision steps
    // route by verdict target, independently of transitions). Bridge it to the
    // step's successor — its first outgoing target, falling back to the terminal
    // step — mirroring how the transition rewiring below bridges incoming edges
    // to outgoing ones.
    const successorId = bridgeTargetForDeletion(editedSteps, editedTransitions, stepId);
    setEditedSteps((prev) => {
      const filtered = prev.filter((s) => s.id !== stepId);
      return successorId !== undefined
        ? retargetVerdictTargets(filtered, null, stepId, successorId)
        : filtered;
    });
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
  }, [selectedStepId, saveSnapshot, editedTransitions, editedSteps]);

  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantModel, setAssistantModel] = useState<string | undefined>(undefined);
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantPlanning, setAssistantPlanning] = useState(false);
  const [assistantPhase, setAssistantPhase] = useState(0);
  /** What this turn said it would do, and what it asked first. Written by the
   *  planning call, cleared when the build starts. */
  const [assistantPlan, setAssistantPlan] = useState<PlanWorkflowBuildOutput | null>(null);
  const [assistantAnswers, setAssistantAnswers] = useState<Record<string, string>>({});
  /** Phases for the build now running, written for this workflow rather than
   *  the generic list they replace. Empty falls back to that list. */
  const [assistantPhases, setAssistantPhases] = useState<readonly string[]>(ASSISTANT_PHASES);
  const [assistantElapsed, setAssistantElapsed] = useState(0);
  /** Something arrived while the pane was collapsed. Cleared on opening it. */
  const [assistantUnread, setAssistantUnread] = useState(false);
  /** The turn in flight, so the halt button can stop it. */
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantScrollRef = useRef<HTMLDivElement>(null);
  const assistantInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = assistantInputRef.current;
    if (!el) return;
  const heldRolesRef = useRef<string[] | null>(null);
    el.style.height = 'auto';
    el.style.height = `${String(el.scrollHeight)}px`;
  }, [assistantInput]);

  // Advance the status label while loading; hold on the last phase (a big build
  // can run for a while). Reset to the first phase each time a request starts.
  useEffect(() => {
    if (!assistantLoading) return;
    setAssistantPhase(0);
    setAssistantElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => {
      setAssistantElapsed(Math.round((Date.now() - started) / 1000));
      setAssistantPhase((p) => Math.min(p + 1, assistantPhases.length - 1));
    }, 2500);
    return () => clearInterval(timer);
  }, [assistantLoading, assistantPhases]);

  // A reply is only useful if it is seen. The thread scrolls to the newest
  // message, and when the pane is collapsed the toggle carries a mark instead —
  // an answer nobody notices is the same as no answer.
  useEffect(() => {
    if (assistantMessages.length === 0 && assistantPlan === null) return;
    if (!aiPaneOpen) {
      setAssistantUnread(true);
      return;
    }
    const el = assistantScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [assistantMessages, assistantPlan, aiPaneOpen]);

  // Seeds the notifications role pick-list. Fetched here rather than threaded
  // through the pages: the canvas already knows the handle, and that panel is
  // the only consumer.
  const { roles: workspaceRoles, heldRoles } = useWorkspaceRoles(namespace ?? '', {
    // Also while the assistant pane is open: a step it writes can name a role
    // nobody holds, and the person reading the reply never opens the panel
    // where that warning already lives.
    enabled: rightPanelView === 'notifications' || aiPaneOpen,
    workflowName,
  });

  // Applies the whole batch through the shared reducer in one atomic state
  // update. Returns a success summary and any tool-call errors separately so the
  // UI never presents a failure as a confirmed change.

  const settingsDraftRef = useRef(settingsDraft);
  settingsDraftRef.current = settingsDraft;

  const applyAssistantToolCalls = useCallback((toolCalls: WorkflowAssistantToolCall[]): { summary: string; error: string | null; steps: WorkflowStep[] } => {
    const result = applyWorkflowAssistantToolCalls(
      editedStepsRef.current,
      editedTransitionsRef.current,
      toolCalls,
      settingsDraftRef.current,
      editedInputForNextRunRef.current,
    );
    saveSnapshot();
    setEditedSteps(result.steps);
    setEditedTransitions(result.transitions);
    // Carry-over names steps, so it lands with them rather than through the
    // page's settings draft.
    setEditedInputForNextRun(result.inputForNextRun);
    // The page owns the workflow-level fields, so the reducer's settings go
    // back the same way the settings panel's edits do.
  heldRolesRef.current = heldRoles;
    onSettingsChange?.(result.settings);
    const lastAdded = result.addedStepIds[result.addedStepIds.length - 1];
    if (lastAdded) setSelectedStepId(lastAdded);

    const errors = result.outcomes.flatMap((o) => (o.error ? [o.error] : []));
    const counts = result.outcomes.reduce(
      (acc, o) => ({ ...acc, [o.tool]: (acc[o.tool] ?? 0) + 1 }),
      {} as Record<string, number>,
    );
    const parts: string[] = [];
    if (counts.add_step) parts.push(`added ${String(counts.add_step)} step${counts.add_step > 1 ? 's' : ''}`);
    if (counts.update_step) parts.push(`updated ${String(counts.update_step)} step${counts.update_step > 1 ? 's' : ''}`);
    if (counts.remove_step) parts.push(`removed ${String(counts.remove_step)} step${counts.remove_step > 1 ? 's' : ''}`);
    if (counts.update_workflow) {
      const fields = result.outcomes.filter((o) => o.tool === 'update_workflow').map((o) => o.stepId).join(', ');
      parts.push(`set ${fields}`);
    }
    if (counts.set_transition_condition) {
      parts.push(`set ${String(counts.set_transition_condition)} routing condition${counts.set_transition_condition > 1 ? 's' : ''}`);
    }
    // Named rather than counted: a file the assistant wrote is something to go
    // and read, and the Files panel is where it landed.
    if (counts.write_workflow_file) {
      const paths = result.outcomes.filter((o) => o.tool === 'write_workflow_file').map((o) => o.stepId).join(', ');
      parts.push(`wrote ${paths}`);
    }
    if (counts.remove_workflow_file) {
      const paths = result.outcomes.filter((o) => o.tool === 'remove_workflow_file').map((o) => o.stepId).join(', ');
      parts.push(`removed ${paths}`);
    }
    return {
      // The graph the reducer produced, so a caller checking whether it can be
      // saved reads what just landed rather than waiting for the state to
      // commit and the mirror refs to catch up a macrotask later.
      steps: result.steps,
      summary: parts.length > 0 ? `Updated the workflow: ${parts.join(', ')}.` : '',
      error: errors.length > 0 ? errors.join(' ') : null,
    };
  }, [saveSnapshot, onSettingsChange]);

  /** The canvas as the assistant sees it, for both calls. */
  const assistantWorkflowDefinition = useCallback(() => ({
    steps: editedStepsRef.current,
    transitions: editedTransitionsRef.current,
    // Carry-over goes with the workflow level so the assistant can read
    // what is set before patching it, the same as every other field.
    settings: {
      ...pruneWorkflowSettings(settingsDraftRef.current ?? {}),
      ...(editedInputForNextRunRef.current === undefined
        ? {}
        : { inputForNextRun: editedInputForNextRunRef.current }),
    },
  }), []);

  /** Stop the turn in flight. The request is aborted rather than ignored, so a
   *  turn nobody is waiting for stops costing tokens. */
  const haltAssistant = useCallback(() => {
    assistantAbortRef.current?.abort();
  }, []);

  /**
   * The build itself. Split from sending a message so the plan can sit between
   * them: answers to the plan's questions are appended as one message, which is
   * how the build hears them without a second round of asking.
   */
  const runAssistantBuild = useCallback(async (extra?: string, base?: AssistantMessage[]) => {
    if (assistantLoading || !namespace) return;
    // `base` is the thread as the caller knows it. Sending a message plans
    // first and then builds within the same call, so the message it just added
    // has not been committed yet — reading it back from state (or from a ref
    // mirroring state) is a race, and it is the race that made the plan reach
    // the model only sometimes.
    const thread = base ?? assistantMessages;
    const answered = extra === undefined || extra === ''
      ? thread
      : [...thread, { role: 'user' as const, content: extra }];
    if (extra !== undefined && extra !== '') setAssistantMessages(answered);
    setAssistantPlan(null);
    setAssistantAnswers({});
    setAssistantLoading(true);
    const controller = new AbortController();
    assistantAbortRef.current = controller;

    try {
      const result = await mediforce.assistant.ask(
        {
          messages: messagesForModel(answered),
          model: assistantModel,
          workflowDefinition: assistantWorkflowDefinition(),
        },
        { namespace, signal: controller.signal },
      );
      const applied = result.toolCalls
        ? applyAssistantToolCalls(result.toolCalls)
        : { summary: '', error: null, steps: null };
      const replyText = result.reply || (applied.summary ? 'Done.' : '');
      setAssistantMessages((prev) => [...prev, {
        role: 'assistant',
        content: replyText,
        ...(applied.summary ? { changes: applied.summary } : {}),
      }]);
      // A build that could not finish comes back asking. Rendered as the same
      // card the plan uses, because answering is the way out of it — a toast
      // would say the turn is over and leave nothing to act on.
      if (result.questions !== undefined && result.questions.length > 0) {
        setAssistantPlan({ plan: [], questions: result.questions, phases: [] });
      }
      if (applied.error) {
        setAssistantMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Not everything landed: ${applied.error}`,
          narration: true,
          // A trigger attaches to a saved workflow, so the assistant needs to
          // know whether this canvas is a version of one.
          ...(workflowName === undefined ? {} : { workflowName }),
        }]);
      }
      if (applied.steps !== null) {
        const issue = validateSteps(applied.steps);
        if (issue) {
          setAssistantMessages((prev) => [...prev, { role: 'assistant', content: `This will not save yet: ${issue}`, narration: true }]);
        }
      }
    } catch (err) {
      // Halted on purpose: said in the thread rather than as an error, because
      // it is the outcome the person asked for. Nothing was applied.
      if (controller.signal.aborted) {
        setAssistantMessages((prev) => [...prev, {
          role: 'assistant',
          content: 'Stopped. Nothing was changed on the canvas.',
          narration: true,
        }]);
      } else {
        const description = err instanceof ApiError || err instanceof Error ? err.message : 'Failed to reach the assistant';
        toast({ variant: 'error', title: 'Assistant error', description });
      }
    } finally {
      assistantAbortRef.current = null;
      setAssistantLoading(false);
        // A role nobody holds is a task nobody can claim. Said here rather than
        // left to the prompt: the model may not check, and the step panel that
        // already warns about it is not where this person is looking.
        const unheld = unheldStepRoles(applied.steps, heldRolesRef.current);
        if (unheld.length > 0) {
          setAssistantMessages((prev) => [...prev, {
            role: 'assistant',
            content: `Heads up: nobody holds ${unheld.map((role) => `"${role}"`).join(', ')} in this workspace, so ${unheld.length === 1 ? 'that step' : 'those steps'} will wait until someone is granted ${unheld.length === 1 ? 'it' : 'them'} in Settings → Members.`,
            narration: true,
          }]);
        }
    }
  }, [assistantMessages, assistantLoading, assistantModel, namespace, assistantWorkflowDefinition, applyAssistantToolCalls, toast]);

  /**
   * Sending a message plans first, then builds. The plan is one short call: it
   * says what it is about to do and asks only what it cannot infer, so a wrong
   * assumption costs a sentence rather than a minute of building. When it has
   * nothing to ask, the build starts straight away and the plan is just the
   * status the pane shows while it runs.
   */
  const sendAssistantMessage = useCallback(async () => {
    const content = assistantInput.trim();
    if (!content || assistantLoading || assistantPlanning || !namespace) return;

    const nextMessages: AssistantMessage[] = [...assistantMessages, { role: 'user', content }];
    setAssistantMessages(nextMessages);
    setAssistantInput('');
    setAssistantPlanning(true);
    const controller = new AbortController();
    assistantAbortRef.current = controller;

    let planned: PlanWorkflowBuildOutput | null = null;
    try {
      planned = await mediforce.assistant.plan(
        { messages: messagesForModel(nextMessages), model: assistantModel, workflowDefinition: assistantWorkflowDefinition() },
        { namespace, signal: controller.signal },
      );
    } catch {
      // The plan is an aid, not the work: a planning call that fails must not
      // cost the user their turn, so the build runs as it always did.
      planned = null;
    } finally {
      assistantAbortRef.current = null;
      setAssistantPlanning(false);
    }

    if (controller.signal.aborted) {
      setAssistantMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'Stopped. Nothing was changed on the canvas.',
        narration: true,
      }]);
      return;
    }

    setAssistantPhases(planned !== null && planned.phases.length > 0 ? planned.phases : ASSISTANT_PHASES);
    if (planned !== null && planned.questions.length > 0) {
      setAssistantPlan(planned);
      return;
    }
    if (planned !== null && planned.plan.length > 0) {
      setAssistantMessages((prev) => [...prev, { role: 'assistant', content: planned.plan.join('\n'), narration: true }]);
    }
    await runAssistantBuild(undefined, nextMessages);
  }, [assistantMessages, assistantInput, assistantLoading, assistantPlanning, assistantModel, namespace, assistantWorkflowDefinition, runAssistantBuild]);

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

  const jsonDirty = jsonDraft !== lastSyncedJsonRef.current;

  useEffect(() => {
    if (!jsonDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [jsonDirty]);

  const closeJsonPanel = () => {
    if (jsonDirty) {
      const discard = window.confirm(
        'You have unapplied changes in the workflow source code editor. Discard them and close?',
      );
      if (!discard) return;
      setJsonDraft(lastSyncedJsonRef.current);
      setJsonError(null);
    }
    setRightPanelView(null);
  };

  const applyJson = () => {
    try {
      const doc: unknown = JSON.parse(jsonDraft);
      // The graph is applied here; the fields around it are handed to the page,
      // which owns them. Refusing them instead — as this panel used to — meant
      // a definition copied out of a registered version could never be pasted
      // back, since a copy carries `title`, `triggerInput` and the rest.
      const split = splitPastedDefinition(doc);
      if (split.error !== null) {
        setJsonError(split.error);
        return;
      }
      const stepsResult = WorkflowStepSchema.array().safeParse(split.graph.steps);
      if (!stepsResult.success) {
        setJsonError(`steps: ${stepsResult.error.issues[0]?.message ?? 'invalid'}`);
        return;
      }
      const transitionsResult = TransitionSchema.array().safeParse(
        Array.isArray(split.graph.transitions) ? split.graph.transitions : [],
      );
      if (!transitionsResult.success) {
        setJsonError(`transitions: ${transitionsResult.error.issues[0]?.message ?? 'invalid'}`);
        return;
      }
      const carryOverResult = InputForNextRunEntrySchema.array().optional().safeParse(split.graph.inputForNextRun);
      if (!carryOverResult.success) {
        setJsonError(`inputForNextRun: ${carryOverResult.error.issues[0]?.message ?? 'invalid'}`);
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
      });
      if (validationErrors.length > 0) {
        setJsonError(validationErrors[0]);
        return;
      }
      // The same rule the server applies — reported here rather than silently
      // pruned, because in this panel the entries are what the user just typed.
      const stepIds = new Set(orderedSteps.map((s) => s.id));
      const dangling = (carryOverResult.data ?? []).filter((entry) => !stepIds.has(entry.stepId));
      if (dangling.length > 0) {
        setJsonError(`inputForNextRun: no step named ${dangling.map((entry) => `'${entry.stepId}'`).join(', ')}`);
        return;
      }

      // Apply the same ordered/merged graph that was validated, so the canvas
      // stores exactly what passed the gate (not the raw, pre-normalisation input).
      saveSnapshot();
      setEditedSteps(orderedSteps);
      setEditedTransitions(mergedTransitions);
      setEditedInputForNextRun(carryOverResult.data);
      onNonGraphFieldsChange?.(split.nonGraph);
      lastSyncedJsonRef.current = jsonDraft;
      setJsonError(null);
      // Applying is the end of the edit, so the panel gets out of the way: it
      // is a modal over the toolbar, and leaving it up hides the canvas it just
      // changed and the Save that keeps the change. A refusal above returns
      // early and leaves it open, which is where the error belongs.
      setRightPanelView(null);
      if (split.ignored.length > 0) {
        toast({
          variant: 'warning',
          title: 'Some fields are not the file\u2019s to set',
          description: `${split.ignored.join(', ')} ${split.ignored.length === 1 ? 'is' : 'are'} decided here rather than in the pasted definition, so ${split.ignored.length === 1 ? 'that value' : 'those values'} ${split.ignored.length === 1 ? 'was' : 'were'} not used. Everything else was applied.`,
        });
      }
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
          <AuthoringPathsPopover />

          <button
            onClick={() => setRightPanelView('notifications')}
            aria-label="Notifications"
            title="Who is told when a task is assigned or an agent escalates"
            className="inline-flex items-center rounded-md border p-1.5 text-foreground transition-colors hover:bg-muted"
          >
            <Bell className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setRightPanelView('settings')}
            aria-label="Advanced"
            title="Advanced: the preamble every agent step in this workflow gets"
            className="inline-flex items-center rounded-md border p-1.5 text-foreground transition-colors hover:bg-muted"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setRightPanelView('files')}
            aria-label="Files"
            title="Files: the scripts, Dockerfile and skills this workflow carries"
            className="inline-flex items-center rounded-md border p-1.5 text-foreground transition-colors hover:bg-muted"
          >
            <FileCode className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setRightPanelView('secrets')}
            aria-label="Secrets"
            title="Secrets: the values this workflow reads at run time"
            className="inline-flex items-center rounded-md border p-1.5 text-foreground transition-colors hover:bg-muted"
          >
            <KeyRound className="h-3.5 w-3.5" />
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
              <p>Edits here, on the canvas, and from the AI Assistant all write the same definition.</p>
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

        {selectedStep && (
          <div className="w-80 shrink-0 my-3 mr-3 px-1 min-h-0 flex flex-col">
            <StepEditor
              step={selectedStep}
              allSteps={editedSteps}
              workflowName={workflowName}
              onChange={(patch) => updateStep(selectedStep.id, patch)}
              onClose={() => setSelectedStepId(null)}
              errors={stepErrors?.[selectedStep.id]}
              imageWarning={warningStepIds?.get(selectedStep.id)}
              dockerImages={dockerImages}
              workflowArtifacts={settingsDraft?.artifacts}
              workflowExternalSkillsRepo={workflowExternalSkillsRepo}
            />
          </div>
        )}

        {rightPanelView === 'add-block' && (
          <div className="w-80 shrink-0 my-3 mr-3 px-1 min-h-0 flex flex-col">
            <BlockPicker
              onAdd={handleBlockAdd}
              onClose={closeAddBlock}
              insertingOnEdge={addBlockContext !== null}
            />
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
                  aria-label="Assistant settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={() => { setAiPaneOpen(false); setAssistantUnread(false); }}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Collapse AI Assistant"
                  aria-label="Collapse AI Assistant"
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
                  minContextTokens={32000}
                  className={selectBase}
                />
              </div>
            )}
            <div ref={assistantScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
              {assistantMessages.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6 space-y-3">
                  <p>Describe the workflow you want to build, or ask a question.</p>
                  <p className="text-xs">
                    It writes the steps, the routing, and the files the workflow needs —
                    a script, a Dockerfile, a skill.
                  </p>
                </div>
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
              {(assistantPlanning || assistantLoading) && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {/* The phrase rotates and the counter grows a digit, so both
                      are kept off the button: it stays put at the end of the
                      row instead of sliding about while the turn runs. */}
                  <span className="min-w-0 flex-1 truncate">
                    {assistantPlanning
                      ? 'Reading what you asked for…'
                      : assistantPhases[assistantPhase] ?? assistantPhases[0]}
                  </span>
                  {assistantLoading && assistantElapsed > 0 && (
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground/70">
                      {formatDuration(assistantElapsed * 1000)}
                    </span>
                  )}
                  <button
                    onClick={haltAssistant}
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border hover:bg-muted hover:text-foreground transition-colors"
                    title="Stop the assistant"
                    aria-label="Stop the assistant"
                  >
                    <Square className="h-2 w-2 fill-current" />
                  </button>
                </div>
              )}

              {assistantPlan !== null && !assistantLoading && (
                <AssistantPlan
                  plan={assistantPlan}
                  answers={assistantAnswers}
                  onAnswer={(id: string, value: string) => setAssistantAnswers((prev) => ({ ...prev, [id]: value }))}
                  onBuild={() => void runAssistantBuild(answersMessage(assistantPlan, assistantAnswers))}
                  onCancel={() => { setAssistantPlan(null); setAssistantAnswers({}); }}
                />
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
                  disabled={assistantLoading || assistantPlanning || !namespace}
                  placeholder={namespace ? 'Ask AI to build your workflow…' : 'Save the workflow first'}
                  className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed max-h-48 overflow-y-auto leading-relaxed"
                />
                <button
                  onClick={() => void sendAssistantMessage()}
                  disabled={assistantLoading || assistantPlanning || !namespace || assistantInput.trim().length === 0}
                  className="shrink-0 pb-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="Send message to the assistant"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setAiPaneOpen(true); setAssistantUnread(false); }}
            className={cn(
              'w-10 shrink-0 my-3 mr-3 rounded-xl border shadow-lg bg-white dark:bg-background flex flex-col items-center justify-between py-4 transition-colors',
              assistantUnread
                ? 'border-primary/40 text-primary hover:bg-primary/5'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title={assistantUnread ? 'The AI Assistant has something for you' : 'Expand AI Assistant'}
            aria-label={assistantUnread ? 'Expand AI Assistant — it has something for you' : 'Expand AI Assistant'}
          >
            <span className="relative inline-flex shrink-0">
              <Sparkles className="h-4 w-4" />
              {assistantUnread && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-white dark:ring-background" />
              )}
            </span>
            <span className="text-[11px] font-semibold tracking-wide [writing-mode:vertical-rl] rotate-180 select-none">
              AI Assistant
            </span>
            {assistantLoading || assistantPlanning ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <ChevronLeft className="h-4 w-4 shrink-0" />
            )}
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

      {rightPanelView === 'settings' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRightPanelView(null)} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Advanced</h2>
              </div>
              <button
                onClick={() => setRightPanelView(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              This applies to the whole workflow, not a single step, and saves with the next version.
            </p>
            <WorkflowSettingsPanel
              draft={settingsDraft ?? {}}
              onChange={(patch) => onSettingsChange?.({ ...settingsDraft, ...patch })}
            />
          </div>
        </div>
      )}

      {rightPanelView === 'notifications' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRightPanelView(null)} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-lg mx-4 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Notifications</h2>
              </div>
              <button
                onClick={() => setRightPanelView(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <WorkflowNotificationsPanel
              draft={settingsDraft ?? {}}
              onChange={(patch) => onSettingsChange?.({ ...settingsDraft, ...patch })}
              workspaceRoles={workspaceRoles}
            />
          </div>
        </div>
      )}

      {rightPanelView === 'files' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRightPanelView(null)} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-4xl mx-4 space-y-4 h-[85vh] flex flex-col">
            <div className="shrink-0 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <FileCode className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Files</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Scripts, a Dockerfile, skills — whatever this workflow needs to run.
                  They save with the next version, and a run reads them from{' '}
                  <code className="font-mono">/artifacts</code>. No repository required.
                </p>
              </div>
              <button
                onClick={() => setRightPanelView(null)}
                aria-label="Close files"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <WorkflowFilesPanel
              artifacts={settingsDraft?.artifacts ?? []}
              onChange={(artifacts) => onSettingsChange?.({ ...settingsDraft, artifacts })}
            />
          </div>
        </div>
      )}

      {rightPanelView === 'json' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={closeJsonPanel} />
          <div className="relative bg-background border rounded-xl shadow-xl p-6 w-full max-w-2xl mx-4 space-y-4 max-h-[85vh] flex flex-col">
            <div className="shrink-0 flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <Code2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Workflow source code (wd.json)</h2>
              </div>
              <button
                onClick={closeJsonPanel}
                aria-label="Close"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4">
              <CodeEditor
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
              {jsonError ? (
                <p className="text-xs text-red-600 dark:text-red-400 mr-auto">{jsonError}</p>
              ) : jsonDirty ? (
                <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mr-auto">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Unapplied changes — click &ldquo;Apply JSON to canvas&rdquo; to keep them.
                </p>
              ) : null}
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
