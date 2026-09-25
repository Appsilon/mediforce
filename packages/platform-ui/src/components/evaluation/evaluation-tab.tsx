'use client';

import * as React from 'react';
import type { EvaluatedStep, WorkflowStep } from '@mediforce/platform-core';
import { useStepEvaluation } from '@/hooks/use-step-evaluation';
import { useWorkflowRunGate } from '@/hooks/use-workflow-access';
import { EvaluationAssistantPanel } from './evaluation-assistant-panel';
import {
  AcceptanceCriteriaSection,
  BriefSection,
  CasesSection,
  EvalRunsSection,
  EvaluatorsSection,
  McpPolicySection,
  QualificationSection,
} from './step-evaluation-sections';

const ASSISTANT_WIDTH_KEY = 'mediforce.evaluation-assistant.width';
const DEFAULT_ASSISTANT_WIDTH = 380;
const MIN_ASSISTANT_WIDTH = 320;
// The evaluation sections keep at least this much room, plus the 1rem column gap.
const MIN_SECTIONS_WIDTH = 360;
const COLUMN_GAP = 16;
const KEYBOARD_RESIZE_STEP = 32;

/** The assistant column's width: dragged or arrow-keyed from its left edge, remembered per browser. */
function useAssistantWidth(layoutRef: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState(DEFAULT_ASSISTANT_WIDTH);

  React.useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(ASSISTANT_WIDTH_KEY));
      if (Number.isFinite(stored) && stored >= MIN_ASSISTANT_WIDTH) setWidth(stored);
    } catch {
      // Storage unavailable (private window, blocked site data): keep the default.
    }
  }, []);

  const clamp = (next: number) => {
    const available = (layoutRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) - MIN_SECTIONS_WIDTH - COLUMN_GAP;
    return Math.round(Math.max(MIN_ASSISTANT_WIDTH, Math.min(next, available)));
  };
  const resize = (next: number) => setWidth(clamp(next));
  const persist = (next: number) => {
    try {
      localStorage.setItem(ASSISTANT_WIDTH_KEY, String(next));
    } catch {
      // Not remembered; the width still applies for this visit.
    }
  };
  const commit = (next: number) => {
    const clamped = clamp(next);
    setWidth(clamped);
    persist(clamped);
  };
  return { width, resize, persist, commit };
}

function AssistantResizeHandle({ width, resize, persist, commit }: ReturnType<typeof useAssistantWidth>) {
  const drag = React.useRef<{ startX: number; startWidth: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Evaluation Assistant"
      aria-valuenow={width}
      aria-valuemin={MIN_ASSISTANT_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      data-testid="evaluation-assistant-resize"
      className="group absolute -left-4 top-0 z-10 hidden h-full w-4 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none lg:flex"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        resize(drag.current.startWidth + drag.current.startX - event.clientX);
      }}
      onPointerUp={() => {
        if (drag.current === null) return;
        drag.current = null;
        persist(width);
      }}
      onDoubleClick={() => commit(DEFAULT_ASSISTANT_WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') commit(width + KEYBOARD_RESIZE_STEP);
        else if (event.key === 'ArrowRight') commit(width - KEYBOARD_RESIZE_STEP);
        else return;
        event.preventDefault();
      }}
    >
      <div className="h-12 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary" />
    </div>
  );
}

function StepEvaluation({ step, mayEdit, editReason, mayRun, runReason }: {
  step: EvaluatedStep;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const evaluation = useStepEvaluation(step);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const assistantWidth = useAssistantWidth(layoutRef);
  // min() keeps a remembered width from squeezing the sections on a narrower window.
  const columns = `minmax(0,1fr) min(${assistantWidth.width}px, calc(100% - ${MIN_SECTIONS_WIDTH + COLUMN_GAP}px))`;
  return (
    <div
      ref={layoutRef}
      className="grid min-h-0 gap-4 lg:grid-cols-(--evaluation-columns) lg:items-start"
      style={{ '--evaluation-columns': columns } as React.CSSProperties}
    >
      <div className="space-y-4">
        <QualificationSection data={evaluation.qualification} />
        <BriefSection step={step} data={evaluation.brief} mayEdit={mayEdit} />
        <AcceptanceCriteriaSection step={step} data={evaluation.criteria} mayEdit={mayEdit} />
        <EvaluatorsSection step={step} data={evaluation.evaluators} mayEdit={mayEdit} />
        <CasesSection step={step} evaluation={evaluation} mayEdit={mayEdit} />
        <McpPolicySection step={step} data={evaluation.mcpPolicy} mayEdit={mayEdit} />
        <EvalRunsSection step={step} data={evaluation.runs} mayRun={mayRun} runReason={runReason} mayEdit={mayEdit} editReason={editReason} />
      </div>
      <div className="relative lg:sticky lg:top-6 lg:h-[calc(100dvh-10rem)] lg:min-h-[480px]">
        <AssistantResizeHandle {...assistantWidth} />
        <EvaluationAssistantPanel step={step} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
      </div>
    </div>
  );
}

/**
 * The workflow's **Evaluation** tab (ADR-0023 D14): one agent step at a time,
 * its Step Qualification, Brief, Acceptance Criteria, Evaluators, Eval Cases,
 * MCP eval policy and Eval Runs beside the Evaluation Assistant. Everything here lives outside the definition, so no
 * change on this tab mints a version.
 */
export function EvaluationTab({ handle, workflowName, steps, mayEdit, editReason }: {
  handle: string;
  workflowName: string;
  steps: readonly WorkflowStep[];
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const agentSteps = steps.filter((step) => step.executor === 'agent');
  const { mayRun, reason: runReason } = useWorkflowRunGate(handle, workflowName);
  const [stepId, setStepId] = React.useState<string | null>(null);
  const selected = agentSteps.find((step) => step.id === stepId) ?? agentSteps[0];

  if (selected === undefined) {
    return <p className="text-sm text-muted-foreground">This workflow has no agent steps to evaluate.</p>;
  }
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Step</span>
        <select
          data-testid="evaluation-step-select"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={selected.id}
          onChange={(event) => setStepId(event.target.value)}
        >
          {agentSteps.map((step) => <option key={step.id} value={step.id}>{step.name}</option>)}
        </select>
      </label>
      <StepEvaluation key={selected.id} step={{ namespace: handle, workflowName, stepId: selected.id }} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
    </div>
  );
}
