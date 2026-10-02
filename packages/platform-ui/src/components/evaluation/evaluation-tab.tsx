'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AgentOutputSchema, EvaluatedStep } from '@mediforce/platform-core';
import { useStepEvaluation, useWorkflowValidation } from '@/hooks/use-step-evaluation';
import { useWorkflowRunGate } from '@/hooks/use-workflow-access';
import { useWorkflowVersion, useWorkflowVersions } from '@/hooks/use-workflow-versions';
import { VALIDATION_STATUS } from './validation-status';
import { EvaluationAssistantPanel } from './evaluation-assistant-panel';
import {
  AcceptanceCriteriaSection,
  CasesSection,
  EvalRunsSection,
  EvaluatorsSection,
  DriftAlert,
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

function StepEvaluation({ step, definitionVersion, outputSchema, mayEdit, editReason, mayRun, runReason }: {
  step: EvaluatedStep;
  definitionVersion: number;
  outputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const evaluation = useStepEvaluation(step, definitionVersion);
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
        <DriftAlert data={evaluation.drift} />
        <AcceptanceCriteriaSection step={step} criteria={evaluation.criteria} qualification={evaluation.qualification} mayEdit={mayEdit} />
        <EvaluatorsSection
          step={step}
          data={evaluation.evaluators}
          mayEdit={mayEdit}
          stepOutputSchema={outputSchema}
        />
        <CasesSection step={step} evaluation={evaluation} mayEdit={mayEdit} />
        <EvalRunsSection step={step} definitionVersion={definitionVersion} data={evaluation.runs} datasets={evaluation.datasets} mayRun={mayRun} runReason={runReason} mayEdit={mayEdit} editReason={editReason} />
      </div>
      <div className="relative lg:sticky lg:top-6 lg:h-[calc(100dvh-10rem)] lg:min-h-[480px]">
        <AssistantResizeHandle {...assistantWidth} />
        <EvaluationAssistantPanel step={step} definitionVersion={definitionVersion} brief={evaluation.brief} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
      </div>
    </div>
  );
}

const selectClass = 'rounded-md border bg-background px-2 py-1 text-sm';

/**
 * The workflow's **Evaluation** tab (ADR-0023 D14): one agent step of one
 * workflow version at a time — the runnable version unless `?version=` names
 * another live one (archived versions are not evaluated), the step `?step=`
 * names or the first. Each version reads Verified,
 * Failed or Not verified across its agent steps, each step its validation in
 * that version. Its Acceptance Criteria, Evaluators, Eval Cases and Eval Runs
 * sit beside the Evaluation Assistant, which holds the Step's Brief. Everything
 * here lives outside the definition, so no change on this tab mints a version;
 * an Eval Run runs the step as the selected version has it.
 */
export function EvaluationTab({ handle, workflowName, runnableVersion, mayEdit, editReason }: {
  handle: string;
  workflowName: string;
  /** The version a run of the workflow uses; null when none is runnable. */
  runnableVersion: number | null;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { mayRun, reason: runReason } = useWorkflowRunGate(handle, workflowName);
  const { versions, defaultVersion, loading: versionsLoading } = useWorkflowVersions(workflowName, handle);
  const validation = useWorkflowValidation(handle, workflowName);

  const liveVersions = versions.filter((version) => version.archived !== true);
  const requestedVersion = Number(searchParams.get('version'));
  const selectedVersion = liveVersions.some((version) => version.version === requestedVersion) ? requestedVersion : runnableVersion;
  const { definition, loading: definitionLoading, error: definitionError } = useWorkflowVersion(workflowName, handle, selectedVersion);

  const select = (next: { version?: number; step?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'evaluation');
    if (next.version !== undefined) {
      params.set('version', String(next.version));
      params.delete('step');
    }
    if (next.step !== undefined) params.set('step', next.step);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  if (definitionError !== null) {
    return <p className="text-sm text-destructive">Version {selectedVersion} could not be loaded: {definitionError.message}</p>;
  }
  if (versionsLoading || definitionLoading || (selectedVersion !== null && definition === null)) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (selectedVersion === null || definition === null) {
    return <p className="text-sm text-muted-foreground">This workflow has no version to evaluate.</p>;
  }
  const versionStatus = new Map((validation.data?.versions ?? []).map((version) => [version.definitionVersion, version]));
  const stepStatus = new Map((versionStatus.get(selectedVersion)?.steps ?? []).map((step) => [step.stepId, step.validation.status]));
  const agentSteps = definition.steps.filter((step) => step.executor === 'agent');
  const selected = agentSteps.find((step) => step.id === searchParams.get('step')) ?? agentSteps[0];

  const versionOption = (version: number) => {
    const status = versionStatus.get(version);
    const display = status === undefined || status.steps.length === 0 ? '' : ` — ${VALIDATION_STATUS[status.status].symbol} ${VALIDATION_STATUS[status.status].versionLabel}`;
    return `v${version}${version === defaultVersion ? ' (default)' : ''}${display}`;
  };
  const stepOption = (stepId: string, name: string) => {
    const status = stepStatus.get(stepId);
    return status === undefined ? name : `${name} — ${VALIDATION_STATUS[status].symbol} ${VALIDATION_STATUS[status].label.toLowerCase()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Version</span>
          <select
            data-testid="evaluation-version-select"
            className={selectClass}
            value={selectedVersion}
            onChange={(event) => select({ version: Number(event.target.value) })}
          >
            {liveVersions.map((version) => <option key={version.version} value={version.version}>{versionOption(version.version)}</option>)}
          </select>
        </label>
        {selected !== undefined && (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Step</span>
            <select
              data-testid="evaluation-step-select"
              className={selectClass}
              value={selected.id}
              onChange={(event) => select({ step: event.target.value })}
            >
              {agentSteps.map((step) => <option key={step.id} value={step.id}>{stepOption(step.id, step.name)}</option>)}
            </select>
          </label>
        )}
      </div>
      {selected === undefined ? (
        <p className="text-sm text-muted-foreground">Version {selectedVersion} has no agent steps to evaluate.</p>
      ) : (
        <StepEvaluation
          key={`${selectedVersion}:${selected.id}`}
          step={{ namespace: handle, workflowName, stepId: selected.id }}
          definitionVersion={selectedVersion}
          outputSchema={selected.agent?.outputSchema}
          mayEdit={mayEdit}
          editReason={editReason}
          mayRun={mayRun}
          runReason={runReason}
        />
      )}
    </div>
  );
}
