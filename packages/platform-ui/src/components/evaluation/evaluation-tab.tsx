'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AgentOutputSchema, EvaluationSubject } from '@mediforce/platform-core';
import { useStepEvaluation, useWorkflowValidation } from '@/hooks/use-step-evaluation';
import { useWorkflowRunGate } from '@/hooks/use-workflow-access';
import { useWorkflowVersion, useWorkflowVersions } from '@/hooks/use-workflow-versions';
import { VALIDATION_STATUS } from './validation-status';
import { buttonClass, tabTriggerClass } from './evaluation-styles';
import { EvaluationAssistantPanel } from './evaluation-assistant-panel';
import {
  EvaluationStatusStrip,
  CasesSection,
  EvalRunsSection,
  EvaluatorsSection,
  DriftAlert,
} from './step-evaluation-sections';

const ASSISTANT_WIDTH_KEY = 'mediforce.evaluation-assistant.width';
const ASSISTANT_OPEN_KEY = 'mediforce.evaluation-assistant.open';
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

const SECTIONS = ['runs', 'cases', 'evaluators'] as const;
type SectionTab = (typeof SECTIONS)[number];

function isSectionTab(value: string | null): value is SectionTab {
  return SECTIONS.some((section) => section === value);
}

/**
 * Which tab of the Evaluation is open, kept in `?section=` so a link or a
 * reload lands on it. Unnamed, a subject with Eval Runs opens on them and one
 * without opens on its cases; until its runs load, no tab is picked, so the
 * page does not open on cases and then jump to runs.
 */
function useSectionTab(hasRuns: boolean | undefined) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('section');
  const section: SectionTab | null = isSectionTab(requested) ? requested : hasRuns === undefined ? null : hasRuns ? 'runs' : 'cases';
  const select = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', next);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  return { section, select };
}

/** Whether the assistant column is shown, remembered per browser; shown until hidden. */
function useAssistantOpen() {
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    try {
      if (localStorage.getItem(ASSISTANT_OPEN_KEY) === 'false') setOpen(false);
    } catch {
      // Storage unavailable: keep it shown.
    }
  }, []);
  const toggle = () => {
    const next = open === false;
    setOpen(next);
    try {
      localStorage.setItem(ASSISTANT_OPEN_KEY, String(next));
    } catch {
      // Not remembered; the choice still applies for this visit.
    }
  };
  return { open, toggle };
}

/**
 * One subject's Evaluation: a status strip over its Eval Runs, Eval Cases and
 * Evaluators, one tab at a time, beside the assistant, which can be hidden.
 * The subject is an agent Step in one workflow version, or an Agent on its own
 * (ADR-0029), with no version to pick. Every tab stays mounted, so a half-filled
 * form or the unsaved-cases guard survives switching tabs.
 */
export function StepEvaluation({ step, definitionVersion, outputSchema, mayEdit, editReason, mayRun, runReason }: {
  step: EvaluationSubject;
  definitionVersion: number | null;
  outputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const evaluation = useStepEvaluation(step, definitionVersion);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const assistantWidth = useAssistantWidth(layoutRef);
  const assistant = useAssistantOpen();
  const { section, select } = useSectionTab(evaluation.runs.isLoading ? undefined : (evaluation.runs.data?.evalRuns.length ?? 0) > 0);
  const evaluators = evaluation.evaluators.data?.evaluators ?? [];
  const caseCount = evaluation.cases.data?.cases.length;
  const unapproved = evaluators.filter((evaluator) => evaluator.trust.trusted === false).length;
  // min() keeps a remembered width from squeezing the sections on a narrower window.
  const columns = assistant.open
    ? `minmax(0,1fr) min(${assistantWidth.width}px, calc(100% - ${MIN_SECTIONS_WIDTH + COLUMN_GAP}px))`
    : 'minmax(0,1fr)';
  const tabs: { value: SectionTab; label: string; count: number | undefined; tour: string }[] = [
    { value: 'runs', label: 'Eval Runs', count: undefined, tour: 'eval-runs' },
    { value: 'cases', label: 'Eval Cases', count: caseCount, tour: 'eval-cases' },
    { value: 'evaluators', label: 'Evaluators', count: evaluation.evaluators.data === undefined ? undefined : evaluators.length, tour: 'eval-evaluators' },
  ];
  return (
    <div className="space-y-4">
      <DriftAlert data={evaluation.drift} />
      <EvaluationStatusStrip
        step={step}
        criteria={evaluation.criteria}
        qualification={evaluation.qualification}
        datasets={evaluation.datasets}
        mayEdit={mayEdit}
        action={(
          <button type="button" className={buttonClass} aria-pressed={assistant.open} data-testid="evaluation-assistant-toggle" onClick={assistant.toggle}>
            {assistant.open ? 'Hide assistant' : 'Assistant'}
          </button>
        )}
      />
      {unapproved > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" data-testid="unapproved-evaluators">
          <span>{unapproved === 1 ? '1 Code Evaluator does not count until a person approves its source.' : `${unapproved} Code Evaluators do not count until a person approves their source.`}</span>
          {section !== 'evaluators' && (
            <button type="button" className="font-medium underline underline-offset-2" data-testid="review-unapproved-evaluators" onClick={() => select('evaluators')}>Review</button>
          )}
        </div>
      )}
      <div
        ref={layoutRef}
        className="grid min-h-0 gap-4 lg:grid-cols-(--evaluation-columns) lg:items-start"
        style={{ '--evaluation-columns': columns } as React.CSSProperties}
      >
        <Tabs.Root value={section ?? ''} onValueChange={select} className="min-w-0 rounded-lg border">
          <Tabs.List className="flex flex-wrap gap-0 border-b px-2" aria-label="Evaluation">
            {tabs.map((tab) => (
              <Tabs.Trigger key={tab.value} value={tab.value} className={tabTriggerClass} data-testid={`evaluation-tab-${tab.value}`} data-tour={tab.tour}>
                {tab.label}
                {tab.count !== undefined && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground"><span className="sr-only">: </span>{tab.count}</span>}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="runs" forceMount className="p-4 data-[state=inactive]:hidden">
            <EvalRunsSection step={step} definitionVersion={definitionVersion} data={evaluation.runs} datasets={evaluation.datasets} cases={evaluation.cases.data?.cases ?? []} mayRun={mayRun} runReason={runReason} />
          </Tabs.Content>
          <Tabs.Content value="cases" forceMount className="p-4 data-[state=inactive]:hidden">
            <CasesSection step={step} evaluation={evaluation} mayEdit={mayEdit} />
          </Tabs.Content>
          <Tabs.Content value="evaluators" forceMount className="p-4 data-[state=inactive]:hidden">
            <EvaluatorsSection
              step={step}
              data={evaluation.evaluators}
              mayEdit={mayEdit}
              editReason={editReason}
              stepOutputSchema={outputSchema}
            />
          </Tabs.Content>
        </Tabs.Root>
        {assistant.open && (
          <div className="relative lg:sticky lg:top-6 lg:h-[calc(100dvh-10rem)] lg:min-h-[480px]">
            <AssistantResizeHandle {...assistantWidth} />
            <EvaluationAssistantPanel step={step} definitionVersion={definitionVersion} brief={evaluation.brief} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
          </div>
        )}
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
 * that version. The step's status strip sits over its Eval Runs, Eval Cases and
 * Evaluators tabs, beside the Evaluation Assistant, which holds the Step's Brief. Everything
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
      <div className="flex flex-wrap items-center gap-4" data-tour="eval-selectors">
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
          step={{ kind: 'step', namespace: handle, workflowName, stepId: selected.id }}
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
