'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  type AcceptanceCriteria,
  type AgentOutputSchema,
  type EvaluationSubject,
} from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { usePinnedDefaultModel } from '@/hooks/use-model-registry';
import { useStepEvaluationMutation, type useStepEvaluation } from '@/hooks/use-step-evaluation';
import { EvaluationAssistantPanel, type EvaluationAssistantStarter } from './evaluation-assistant-panel';
import { AssistantResizeHandle, assistantColumns, useAssistantHeight, useAssistantWidth } from './assistant-width';
import type { BriefQuery } from './evaluation-brief-field';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';
import { CasesSection, EvaluatorsSection, StartEvalRunControls, hasUnsavedCases, loadedAgentRuns } from './step-evaluation-sections';

type StepEvaluation = ReturnType<typeof useStepEvaluation>;

export const SETUP_STAGES = ['brief', 'cases', 'evaluators', 'review'] as const;
export type SetupStage = (typeof SETUP_STAGES)[number];

const STAGE_LABELS: Record<SetupStage, string> = {
  brief: 'Brief',
  cases: 'Eval Cases',
  evaluators: 'Evaluators',
  review: 'Review',
};

export const EXPECTED_OUTPUT_EVALUATOR = 'matches-expected-output';

const PROMPTS = {
  brief: 'Draft this step\'s Evaluation Brief: what it is for, who relies on its output and which failures matter most. Read its prompt, output schema and a few recent runs first.',
  reviewedRuns: 'Propose an Eval Case from each recent production run a person approved or rejected: an approved run is a positive case, a rejected one a negative case.',
  edgeCases: 'Suggest edge-case Eval Cases for inputs production has not sent yet, the riskiest by the Brief first.',
  checks: 'Propose an evaluation plan for this step: the checks it needs, cheapest first — the output schema, then Code, then an LLM judge.',
} as const;

/**
 * An empty subject's Evaluation: set it up in four guided stages, the
 * assistant drafting each, or by hand on the usual tabs.
 */
export function SetupChoice({ step, evaluation, onGuided, onManual }: {
  step: EvaluationSubject;
  evaluation: StepEvaluation;
  onGuided: () => void;
  onManual: () => void;
}) {
  const runs = loadedAgentRuns(evaluation).length;
  const choiceClass = 'flex flex-1 basis-80 flex-col gap-2 rounded-xl border bg-background p-5 text-left transition-colors hover:bg-muted/40';
  return (
    <section className="mx-auto max-w-3xl space-y-6 py-8" data-testid="evaluation-setup-choice">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold">{step.kind === 'agent' ? 'Evaluate this agent' : 'Evaluate this step'}</h2>
        <p className="text-sm text-muted-foreground">Re-run it on Eval Cases and grade each output with Evaluators.</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <button type="button" className={cn(choiceClass, 'border-2 border-primary')} data-testid="evaluation-setup-guided" onClick={onGuided}>
          <span className="flex items-center justify-between gap-2">
            <span className="text-lg font-semibold">Guided setup</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">Recommended</span>
          </span>
          <span className="text-sm text-muted-foreground">4 stages. The assistant drafts each one, you review.</span>
          <span className="text-sm font-semibold text-primary">Start →</span>
        </button>
        <button type="button" className={choiceClass} data-testid="evaluation-setup-manual" onClick={onManual}>
          <span className="text-lg font-semibold">Set up manually</span>
          <span className="text-sm text-muted-foreground">Add cases and Evaluators yourself.</span>
          <span className="text-sm font-semibold text-primary">Open →</span>
        </button>
      </div>
      {step.kind === 'step' && evaluation.agentRuns.data !== undefined && (
        <p className="text-xs text-muted-foreground" data-testid="evaluation-setup-detected">
          {runs === 0 ? 'No production runs yet.' : `${runs}${evaluation.agentRuns.hasNextPage ? '+' : ''} production run${runs === 1 ? '' : 's'} to start cases from.`}
        </p>
      )}
    </section>
  );
}

function StageHeading({ title, optional, purpose, why }: { title: string; optional?: boolean; purpose: string; why?: string }) {
  const [showWhy, setShowWhy] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-bold">
          {title}
          {optional === true && <span className="ml-2 text-sm font-medium text-muted-foreground">optional</span>}
        </h2>
        {why !== undefined && (
          <button type="button" className="text-xs text-primary underline underline-offset-2" aria-expanded={showWhy} onClick={() => setShowWhy(showWhy === false)}>
            {showWhy ? 'Hide' : 'Why?'}
          </button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{purpose}</p>
      {showWhy && <p className="max-w-3xl rounded-md bg-primary/5 px-3 py-2 text-xs leading-relaxed">{why}</p>}
    </div>
  );
}

/** What each stage hands the assistant: the job is the assistant's, so its buttons sit in the panel. */
function stageStarter(stage: SetupStage, step: EvaluationSubject): EvaluationAssistantStarter | undefined {
  if (stage === 'brief') {
    return { actions: [{ label: 'Draft the Brief', prompt: PROMPTS.brief, testId: 'guided-setup-draft-brief' }] };
  }
  if (stage === 'cases') {
    return {
      intro: 'Cover inputs production hasn\'t sent yet.',
      actions: [
        ...(step.kind === 'step' ? [{ label: 'Cases from reviewed runs', prompt: PROMPTS.reviewedRuns, testId: 'guided-setup-reviewed-runs' }] : []),
        { label: 'Suggest edge cases', prompt: PROMPTS.edgeCases, testId: 'guided-setup-edge-cases' },
      ],
    };
  }
  if (stage === 'evaluators') {
    return { intro: 'Picks checks from the step\'s shape and the Brief.', actions: [{ label: 'Propose checks', prompt: PROMPTS.checks, testId: 'guided-setup-propose-checks' }] };
  }
  return undefined;
}

/**
 * The Brief as the guided stage shows it: always open for writing, saved as a
 * new version when the person leaves the field, and following the saved Brief
 * — one the assistant drafted and the person accepted — until they type.
 */
function BriefCard({ step, brief, mayEdit }: { step: EvaluationSubject; brief: BriefQuery; mayEdit: boolean }) {
  const saved = brief.data?.brief?.text ?? '';
  const [edited, setEdited] = React.useState<string | null>(null);
  const save = useStepEvaluationMutation(step, (text: string) => mediforce.evaluation.setBrief({ ...step, text }));
  const commit = () => {
    if (edited === null || edited.trim() === '' || edited === saved || save.isPending) return;
    save.mutate(edited, { onSuccess: () => setEdited(null) });
  };
  return (
    <section className="flex flex-col gap-2.5 rounded-lg border p-5" data-testid="guided-setup-brief">
      <label htmlFor="guided-setup-brief-text" className="text-sm font-semibold">Evaluation Brief</label>
      <textarea
        id="guided-setup-brief-text"
        rows={10}
        className={cn(inputClass, 'w-full resize-y text-sm leading-relaxed')}
        placeholder="Write it, or let the assistant draft it →"
        disabled={mayEdit === false || brief.isLoading}
        value={edited ?? saved}
        onChange={(event) => setEdited(event.target.value)}
        onBlur={commit}
      />
      {brief.isError && <p role="alert" className="text-xs text-destructive">Could not load the Brief.</p>}
      {save.error !== null && <p role="alert" className="text-xs text-destructive">{save.error.message}</p>}
    </section>
  );
}

const EXPECTATION_CHOICES = [
  { id: 'yes', label: 'Yes', effect: 'Give each case the output you expect. A comparison check is added for you.' },
  { id: 'some', label: 'For some', effect: 'Cases that have one get compared. A comparison check is added for you.' },
  { id: 'no', label: 'No', effect: 'Rule checks only.' },
] as const;
type ExpectationChoice = (typeof EXPECTATION_CHOICES)[number]['id'];

/** Whether the person knows the correct outputs: knowing some adds the check that compares them, once. */
function ExpectedOutputsQuestion({ step, evaluation, mayEdit }: { step: EvaluationSubject; evaluation: StepEvaluation; mayEdit: boolean }) {
  const evaluators = evaluation.evaluators.data?.evaluators ?? [];
  const hasComparison = evaluators.some((evaluator) => evaluator.latest.check.kind === 'expected_output');
  const [choice, setChoice] = React.useState<ExpectationChoice | null>(null);
  const shown = choice ?? (hasComparison ? 'some' : null);
  const model = usePinnedDefaultModel();
  const addComparison = useStepEvaluationMutation(step, () => mediforce.evaluation.createEvaluator({
    ...step,
    name: EXPECTED_OUTPUT_EVALUATOR,
    rule: 'The output matches the case\'s expected output.',
    check: { kind: 'expected_output', model },
  }));
  const pick = (next: ExpectationChoice) => {
    setChoice(next);
    if (next !== 'no' && hasComparison === false && addComparison.isPending === false) addComparison.mutate(undefined);
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" data-testid="expected-outputs-question">
      <span id="expected-outputs-label" className="text-sm font-semibold">Do you know the correct outputs?</span>
      <div role="group" aria-labelledby="expected-outputs-label" className="flex overflow-hidden rounded-md border">
        {EXPECTATION_CHOICES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={shown === option.id}
            disabled={mayEdit === false}
            className={cn('px-3 py-1.5 text-xs font-medium disabled:opacity-50', shown === option.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
            onClick={() => pick(option.id)}
          >{option.label}</button>
        ))}
      </div>
      {shown !== null && <span className="text-xs text-muted-foreground">{EXPECTATION_CHOICES.find((option) => option.id === shown)?.effect}</span>}
      {addComparison.error !== null && <span className="text-xs text-destructive">{addComparison.error.message}</span>}
    </div>
  );
}

function percentText(rate: number | undefined): string {
  return rate === undefined ? '' : String(Math.round(rate * 1000) / 10);
}

function parsePercent(text: string): number | null {
  const value = Number(text);
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value / 100 : null;
}

function SummaryCard({ label, value, detail, warn, onEdit }: { label: string; value: string; detail: string; warn: boolean; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      data-testid={`review-${label.toLowerCase().replace(/ /g, '-')}`}
      className={cn('flex flex-col gap-1 rounded-lg border p-4 text-left hover:bg-muted/40', warn && 'border-amber-500/60 bg-amber-500/10')}
    >
      <span className={cn('text-xs font-semibold', warn ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground')}>{label}</span>
      <span className="text-xl font-bold">{value}</span>
      <span className={cn('text-xs', warn ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground')}>{detail}</span>
    </button>
  );
}

/**
 * What the setup comes to, the Acceptance Criteria every Eval Run is judged
 * against, and Save — the criteria if changed, the cases as a new Dataset
 * version if unsaved — or Save, then start an Eval Run once its budget is confirmed.
 */
function ReviewStage({ step, definitionVersion, evaluation, mayEdit, mayRun, onStage, onDone }: {
  step: EvaluationSubject;
  definitionVersion: number | null;
  evaluation: StepEvaluation;
  mayEdit: boolean;
  mayRun: boolean;
  onStage: (stage: SetupStage) => void;
  onDone: (section: 'runs' | null) => void;
}) {
  const brief = evaluation.brief.data?.brief ?? null;
  const cases = evaluation.cases.data?.cases ?? [];
  const evaluators = evaluation.evaluators.data?.evaluators ?? [];
  const [latestDataset] = evaluation.datasets.data?.datasets ?? [];
  const current = evaluation.criteria.data?.criteria?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA;
  const [passRateText, setPassRateText] = React.useState(() => percentText(current.minPassRate));
  const [passHatKText, setPassHatKText] = React.useState<string | null>(() => current.minPassHatK === undefined ? null : percentText(current.minPassHatK));
  const [starting, setStarting] = React.useState(false);

  const withExpected = cases.filter((evalCase) => evalCase.expectedOutput !== null).length;
  const negative = cases.filter((evalCase) => evalCase.expectedOutput !== null && evalCase.expectation === 'negative').length;
  const unapproved = evaluators.filter((evaluator) => evaluator.trust.trusted === false).length;
  const hasComparison = evaluators.some((evaluator) => evaluator.latest.check.kind === 'expected_output');
  const minPassRate = parsePercent(passRateText);
  const minPassHatK = passHatKText === null ? undefined : parsePercent(passHatKText);
  const criteria: AcceptanceCriteria | null = minPassRate === null || minPassHatK === null ? null : {
    minPassRate,
    ...(minPassHatK === undefined ? {} : { minPassHatK }),
  };
  const criteriaChanged = criteria !== null && JSON.stringify(criteria) !== JSON.stringify(current);
  const casesUnsaved = hasUnsavedCases(cases, latestDataset);

  const save = useStepEvaluationMutation(step, async () => {
    if (criteria !== null && criteriaChanged) await mediforce.evaluation.setAcceptanceCriteria({ ...step, criteria });
    if (casesUnsaved) await mediforce.evaluation.saveDataset(step);
  });
  const blocked = mayEdit === false || criteria === null || save.isPending || cases.length === 0 || evaluators.length === 0;

  const notes: { ok: boolean; text: string }[] = [
    { ok: brief !== null, text: brief === null ? 'No Brief: the assistant ranks its proposals without one.' : 'The Brief is written.' },
    { ok: negative > 0, text: negative === 0 ? 'No negative cases: nothing checks the step tells a wrong output apart.' : `${negative} negative case${negative === 1 ? '' : 's'} included.` },
    ...(withExpected > 0 && hasComparison === false ? [{ ok: false, text: `${withExpected} expected output${withExpected === 1 ? '' : 's'}, but no Expected output Evaluator compares them.` }] : []),
    ...(unapproved > 0 ? [{ ok: false, text: `${unapproved} Code Evaluator${unapproved === 1 ? '' : 's'} won't count until a person approves the source.` }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Brief" value={brief === null ? 'Not written' : '✓ Written'} detail="Edit" warn={false} onEdit={() => onStage('brief')} />
        <SummaryCard
          label="Eval Cases"
          value={String(cases.length)}
          detail={`${withExpected} with expected output${casesUnsaved ? ' · unsaved' : ''}`}
          warn={cases.length === 0}
          onEdit={() => onStage('cases')}
        />
        <SummaryCard
          label="Evaluators"
          value={`${evaluators.length} · ${evaluators.length - unapproved} count`}
          detail={unapproved > 0 ? `${unapproved} need source approval` : evaluators.length === 0 ? 'Add at least one' : 'All count'}
          warn={unapproved > 0 || evaluators.length === 0}
          onEdit={() => onStage('evaluators')}
        />
      </div>
      <section aria-labelledby="review-criteria-title" className="space-y-3 rounded-lg border p-4" data-testid="review-acceptance-criteria">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="review-criteria-title" className="text-sm font-semibold">Acceptance Criteria</h3>
          <span className="text-xs text-muted-foreground">Unset means 100%</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Every counted Evaluator passes at least</span>
          <input
            type="number"
            min={0}
            max={100}
            aria-label="Minimum pass rate (%)"
            className={cn(inputClass, 'w-20')}
            value={passRateText}
            onChange={(event) => setPassRateText(event.target.value)}
          />
          <span>% of its graded trials.</span>
        </div>
        {passHatKText === null ? (
          <button type="button" className="text-xs text-primary underline underline-offset-2" onClick={() => setPassHatKText('80')}>+ Also require consistency (pass^k)</button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>And passes every trial in at least</span>
            <input
              type="number"
              min={0}
              max={100}
              aria-label="Minimum pass^k (%)"
              className={cn(inputClass, 'w-20')}
              value={passHatKText}
              onChange={(event) => setPassHatKText(event.target.value)}
            />
            <span>% of cases <span className="text-muted-foreground">(pass^k)</span>.</span>
            <button type="button" className={buttonClass} onClick={() => setPassHatKText(null)}>Remove</button>
          </div>
        )}
        {criteria === null && <p className="text-xs text-destructive">Each rate is a percentage from 0 to 100.</p>}
      </section>
      <ul className="space-y-1 text-sm" data-testid="review-notes">
        {notes.map((note) => (
          <li key={note.text} className="flex gap-2">
            <span aria-hidden className={cn('font-bold', note.ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-300')}>{note.ok ? '✓' : '!'}</span>
            <span>{note.text}</span>
          </li>
        ))}
      </ul>
      {save.error !== null && <p className="text-xs text-destructive">{save.error.message}</p>}
      {starting && save.isSuccess ? (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4" data-testid="review-start-eval-run">
          <h3 className="text-sm font-semibold">Start an Eval Run</h3>
          <StartEvalRunControls
            step={step}
            definitionVersion={definitionVersion}
            datasets={evaluation.datasets}
            cases={cases}
            onStarted={() => onDone('runs')}
          />
          <button type="button" className={buttonClass} onClick={() => onDone(null)}>Not now</button>
        </div>
      ) : (
        <footer className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className={buttonClass} onClick={() => onStage('evaluators')}>← Evaluators</button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={blocked}
              data-testid="guided-setup-save"
              onClick={() => save.mutate(undefined, { onSuccess: () => onDone(null) })}
            >{save.isPending && starting === false ? 'Saving…' : 'Save'}</button>
            {mayRun && (
              <button
                type="button"
                className={primaryButtonClass}
                disabled={blocked}
                data-testid="guided-setup-save-and-start"
                onClick={() => {
                  setStarting(true);
                  save.mutate(undefined);
                }}
              >{save.isPending && starting ? 'Saving…' : 'Save and start Eval Run'}</button>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

function StageFooter({ back, next, skip }: { back: React.ReactNode; next: { label: string; onClick: () => void }; skip?: () => void }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3">
      {back}
      <div className="flex items-center gap-3">
        {skip !== undefined && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={skip}>Skip</button>}
        <button type="button" className={primaryButtonClass} data-testid="guided-setup-next" onClick={next.onClick}>{next.label}</button>
      </div>
    </footer>
  );
}

/**
 * Guided setup of a subject's Evaluation: Brief, Eval Cases, Evaluators and
 * Review, one stage at a time, beside the Evaluation Assistant, which offers
 * each stage's drafting job as a button and keeps its conversation from stage
 * to stage. Every stage writes as the tabs do; only Review saves the cases as a
 * Dataset version and sets the Acceptance Criteria.
 */
export function GuidedSetup({ step, definitionVersion, evaluation, outputSchema, mayEdit, editReason, mayRun, runReason, stage, onStage, onExit }: {
  step: EvaluationSubject;
  definitionVersion: number | null;
  evaluation: StepEvaluation;
  outputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
  editReason: string | undefined;
  mayRun: boolean;
  runReason: string | undefined;
  stage: SetupStage;
  onStage: (stage: SetupStage) => void;
  /** Leaves the setup for the tabs, on the named one. */
  onExit: (section: 'runs' | null) => void;
}) {
  const filled: Record<SetupStage, boolean> = {
    brief: (evaluation.brief.data?.brief ?? null) !== null,
    cases: (evaluation.cases.data?.cases.length ?? 0) > 0,
    evaluators: (evaluation.evaluators.data?.evaluators.length ?? 0) > 0,
    review: false,
  };
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const assistantWidth = useAssistantWidth(layoutRef);
  const assistantHeight = useAssistantHeight();
  const backLink = (to: SetupStage) => <button type="button" className={buttonClass} onClick={() => onStage(to)}>← {STAGE_LABELS[to]}</button>;

  return (
    <div className="space-y-4" data-testid="guided-setup" data-stage={stage}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-lg border px-4 py-2.5">
        <nav aria-label="Setup progress" className="col-start-2 flex flex-wrap items-center justify-center gap-1.5">
          {SETUP_STAGES.map((candidate, index) => (
            <button
              key={candidate}
              type="button"
              aria-current={candidate === stage ? 'step' : undefined}
              data-testid={`guided-setup-stage-${candidate}`}
              data-filled={filled[candidate]}
              onClick={() => onStage(candidate)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium',
                candidate === stage ? 'bg-primary text-primary-foreground' : filled[candidate] ? 'bg-green-500/10 text-green-800 dark:text-green-300' : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                candidate === stage ? 'bg-primary-foreground text-primary' : filled[candidate] ? 'bg-green-700 text-white' : 'border border-muted-foreground/50',
              )}>
                {filled[candidate] && candidate !== stage ? <Check className="h-3 w-3" aria-label="done" /> : index + 1}
              </span>
              {STAGE_LABELS[candidate]}
            </button>
          ))}
        </nav>
        <button type="button" className="justify-self-end text-xs text-primary hover:underline" data-testid="guided-setup-exit" onClick={() => onExit(null)}>Exit setup</button>
      </div>
      {stage === 'brief' && (
        <StageHeading
          title="Brief"
          optional
          purpose="What the step is for, and which failures matter most."
          why="The assistant ranks every proposal by it, and whoever signs the qualification reads it. The assistant drafts it from the step's prompt, output schema and a few recent runs."
        />
      )}
      {stage === 'cases' && (
        <StageHeading
          title="Eval Cases"
          purpose="Inputs the step is re-run on, optionally with the output you expect."
          why="Approved runs become positive cases (the output must match), rejected runs negative ones (it must not). Cases without an expected output are graded by the Evaluators' rules only."
        />
      )}
      {stage === 'evaluators' && (
        <StageHeading
          title="Evaluators"
          purpose="Rules every output must satisfy."
          why="Cheapest check first: the output schema, then Code, then an LLM judge. A Code check counts toward the result only after a person approves its source."
        />
      )}
      {stage === 'review' && <StageHeading title="Review" purpose="Save the setup, or save it and start an Eval Run." />}
      <div
        ref={layoutRef}
        className="grid gap-4 lg:grid-cols-(--guided-setup-columns) lg:items-start"
        style={{ '--guided-setup-columns': assistantColumns(assistantWidth.width) } as React.CSSProperties}
      >
        <div className="min-w-0 space-y-4">
          {stage === 'brief' && (
            <BriefCard step={step} brief={evaluation.brief} mayEdit={mayEdit} />
          )}
          {stage === 'cases' && (
            <>
              <ExpectedOutputsQuestion step={step} evaluation={evaluation} mayEdit={mayEdit} />
              <div className="rounded-lg border p-4">
                <CasesSection step={step} evaluation={evaluation} mayEdit={mayEdit} />
              </div>
            </>
          )}
          {stage === 'evaluators' && (
            <div className="rounded-lg border p-4">
              <EvaluatorsSection step={step} data={evaluation.evaluators} mayEdit={mayEdit} editReason={editReason} stepOutputSchema={outputSchema} />
            </div>
          )}
          {stage === 'review' && (
            <div className="rounded-lg border p-4">
              <ReviewStage step={step} definitionVersion={definitionVersion} evaluation={evaluation} mayEdit={mayEdit} mayRun={mayRun} onStage={onStage} onDone={onExit} />
            </div>
          )}
          {stage === 'brief' && <StageFooter back={<span />} skip={() => onStage('cases')} next={{ label: 'Next: Eval Cases →', onClick: () => onStage('cases') }} />}
          {stage === 'cases' && <StageFooter back={backLink('brief')} next={{ label: 'Next: Evaluators →', onClick: () => onStage('evaluators') }} />}
          {stage === 'evaluators' && <StageFooter back={backLink('cases')} next={{ label: 'Next: Review →', onClick: () => onStage('review') }} />}
        </div>
        <div ref={assistantHeight.ref} className="relative lg:sticky lg:top-6 lg:h-[var(--assistant-height,calc(100dvh-10rem))]" style={{ '--assistant-height': assistantHeight.height === undefined ? undefined : `${assistantHeight.height}px` } as React.CSSProperties}>
          <AssistantResizeHandle {...assistantWidth} />
          <EvaluationAssistantPanel
            step={step}
            definitionVersion={definitionVersion}
            brief={evaluation.brief}
            mayEdit={mayEdit}
            editReason={editReason}
            mayRun={mayRun}
            runReason={runReason}
            starter={mayEdit ? stageStarter(stage, step) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
