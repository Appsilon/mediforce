'use client';

import * as React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { Sparkles } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AgentOutputSchema, EvaluationSubject } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { useStepEvaluation, useWorkflowValidation } from '@/hooks/use-step-evaluation';
import { useWorkflowRunGate } from '@/hooks/use-workflow-access';
import { useWorkflowVersion, useWorkflowVersions } from '@/hooks/use-workflow-versions';
import { VALIDATION_STATUS } from './validation-status';
import { primaryButtonClass, tabTriggerClass } from './evaluation-styles';
import { EvaluationAssistantPanel } from './evaluation-assistant-panel';
import { AssistantResizeHandle, assistantColumns, useAssistantHeight, useAssistantWidth } from './assistant-width';
import { GuidedSetup, SETUP_STAGES, SetupChoice, type SetupStage } from './guided-setup';
import {
  EvaluationStatusStrip,
  CasesSection,
  EvalRunsSection,
  EvaluatorsSection,
  DriftAlert,
} from './step-evaluation-sections';

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

function isSetupStage(value: string | null): value is SetupStage {
  return SETUP_STAGES.some((stage) => stage === value);
}

/** The query parameters only the Evaluation tab reads; a page drops them on leaving it. */
export const EVALUATION_QUERY_PARAMS = ['version', 'step', 'section', 'guided'] as const;

/**
 * How the Evaluation is being set up: the guided stage `?guided=` names, else
 * by hand on the tabs once the person chose them, else not chosen yet. The
 * choice of the tabs is not kept in the URL, so it lasts only while the
 * Evaluation stays open and an empty subject offers the choice again.
 */
function useSetupMode() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [manualChosen, setManualChosen] = React.useState(false);
  const requestedStage = searchParams.get('guided');
  const stage: SetupStage | null = isSetupStage(requestedStage) ? requestedStage : null;
  const setup = stage !== null ? 'guided' : manualChosen ? 'manual' : null;
  const replace = (change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    change(params);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  const go = (next: SetupStage) => replace((params) => params.set('guided', next));
  const manual = (section: string | null) => {
    setManualChosen(true);
    replace((params) => {
      params.delete('guided');
      if (section === null) params.delete('section');
      else params.set('section', section);
    });
  };
  return { setup, stage: stage ?? 'brief', go, manual };
}

/** Whether the subject has nothing to evaluate with yet — no Brief, cases, Evaluators or Eval Runs; undefined while any is loading. */
function isEmptySubject(evaluation: ReturnType<typeof useStepEvaluation>): boolean | undefined {
  const { brief, cases, evaluators, runs } = evaluation;
  if (brief.data === undefined || cases.data === undefined || evaluators.data === undefined || runs.data === undefined) return undefined;
  return brief.data.brief === null && cases.data.cases.length === 0 && evaluators.data.evaluators.length === 0 && runs.data.evalRuns.length === 0;
}

/**
 * One subject's Evaluation: a status strip over its Eval Runs, Eval Cases and
 * Evaluators, one tab at a time, beside the assistant.
 * The subject is an agent Step in one workflow version, or an Agent on its own
 * (ADR-0029), with no version to pick. Every tab stays mounted, so a
 * half-filled form or the unsaved-cases guard survives switching tabs. A subject
 * with nothing set up first offers the guided setup or the tabs; on the tabs,
 * Guided setup sits after the page's `header`, which stays over every mode.
 */
export function StepEvaluation({ header, step, definitionVersion, outputSchema, mayEdit, editReason, mayRun, runReason }: {
  header: React.ReactNode;
  step: EvaluationSubject;
  definitionVersion: number | null;
  outputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const evaluation = useStepEvaluation(step, definitionVersion);
  const setupMode = useSetupMode();
  const empty = isEmptySubject(evaluation);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const assistantWidth = useAssistantWidth(layoutRef);
  const assistantHeight = useAssistantHeight();
  const { section, select } = useSectionTab(evaluation.runs.isLoading ? undefined : (evaluation.runs.data?.evalRuns.length ?? 0) > 0);
  const evaluators = evaluation.evaluators.data?.evaluators ?? [];
  const caseCount = evaluation.cases.data?.cases.length;
  const unapproved = evaluators.filter((evaluator) => evaluator.trust.trusted === false).length;
  const columns = assistantColumns(assistantWidth.width);
  const tabs: { value: SectionTab; label: string; count: number | undefined; tour: string }[] = [
    { value: 'runs', label: 'Eval Runs', count: undefined, tour: 'eval-runs' },
    { value: 'cases', label: 'Eval Cases', count: caseCount, tour: 'eval-cases' },
    { value: 'evaluators', label: 'Evaluators', count: evaluation.evaluators.data === undefined ? undefined : evaluators.length, tour: 'eval-evaluators' },
  ];
  const frame = (content: React.ReactNode, guidedButton: boolean) => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        {header}
        {guidedButton && mayEdit && (
          <button type="button" className={cn(primaryButtonClass, 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm')} data-testid="evaluation-open-guided-setup" onClick={() => setupMode.go('brief')}>
            <Sparkles className="h-4 w-4" aria-hidden />
            Guided setup
          </button>
        )}
      </div>
      {content}
    </div>
  );
  if (setupMode.setup === 'guided') {
    return frame(
      <GuidedSetup
        step={step}
        definitionVersion={definitionVersion}
        evaluation={evaluation}
        outputSchema={outputSchema}
        mayEdit={mayEdit}
        editReason={editReason}
        mayRun={mayRun}
        runReason={runReason}
        stage={setupMode.stage}
        onStage={setupMode.go}
        onExit={setupMode.manual}
      />,
      false,
    );
  }
  if (setupMode.setup === null && mayEdit) {
    if (empty === undefined) return frame(<p className="text-sm text-muted-foreground">Loading…</p>, false);
    if (empty) return frame(<SetupChoice step={step} evaluation={evaluation} onGuided={() => setupMode.go('brief')} onManual={() => setupMode.manual(null)} />, false);
  }
  return frame(
    <div className="space-y-4">
      <DriftAlert data={evaluation.drift} />
      <EvaluationStatusStrip
        step={step}
        criteria={evaluation.criteria}
        qualification={evaluation.qualification}
        datasets={evaluation.datasets}
        mayEdit={mayEdit}
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
        <div ref={assistantHeight.ref} className="relative lg:sticky lg:top-6 lg:h-[var(--assistant-height,calc(100dvh-10rem))]" style={{ '--assistant-height': assistantHeight.height === undefined ? undefined : `${assistantHeight.height}px` } as React.CSSProperties}>
          <AssistantResizeHandle {...assistantWidth} />
          <EvaluationAssistantPanel step={step} definitionVersion={definitionVersion} outputSchema={outputSchema} brief={evaluation.brief} mayEdit={mayEdit} editReason={editReason} mayRun={mayRun} runReason={runReason} />
        </div>
      </div>
    </div>,
    true,
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
    // How one step is set up says nothing about the next.
    params.delete('guided');
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

  const selectors = (
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
  );

  if (selected === undefined) {
    return (
      <div className="space-y-4">
        {selectors}
        <p className="text-sm text-muted-foreground">Version {selectedVersion} has no agent steps to evaluate.</p>
      </div>
    );
  }
  return (
    <StepEvaluation
      key={`${selectedVersion}:${selected.id}`}
      header={selectors}
      step={{ kind: 'step', namespace: handle, workflowName, stepId: selected.id }}
      definitionVersion={selectedVersion}
      outputSchema={selected.agent?.outputSchema}
      mayEdit={mayEdit}
      editReason={editReason}
      mayRun={mayRun}
      runReason={runReason}
    />
  );
}
