'use client';

import * as React from 'react';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import {
  CHAMPION_VARIANT_ID,
  EvalCaseExpectationSchema,
  EvalCaseInputPartSchema,
  EvalCaseInputSchema,
  EvalCaseSplitSchema,
  EvaluatorKindSchema,
  EvaluatorSeveritySchema,
  McpEvalServerPolicySchema,
  describeAcceptanceCriteria,
  describeMcpPolicy,
  type AcceptanceCriteria,
  type AgentOutputSchema,
  type AgentRun,
  type BuiltinCheckName,
  type EvalCase,
  type EvalCaseExpectation,
  type EvalCaseInput,
  type EvalCaseInputPart,
  type EvalDatasetVersion,
  type EvaluatedStep,
  type EvaluatorCheck,
  type EvaluatorSeverity,
  type McpEvalServerPolicy,
  type StepFingerprintComponent,
} from '@mediforce/platform-core';
import {
  EvalChallengerSchema,
  RED_TEAM_SUITES,
  type AddEvaluatorVersionInput,
  type EvalChallenger,
  type EvaluatorView,
  type OptimisationSplitResult,
  type PreparedEvalRun,
} from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { AgentLogPanel } from '@/components/agents/agent-log-panel';
import { RunInputOutput, RunInputOutputDetails } from './run-input-output';
import { CalibrationProgress, JudgeCalibrationPanel, labelsBySubject } from './judge-calibration';
import { useAgentRun } from '@/hooks/use-agent-runs';
import { useEvalRun, useEvaluatorLabels, useOptimisation, useStepEvaluation, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { EvalRunReport, describePatch } from './eval-run-report';
import { QualificationStatusChip } from './step-qualification-badge';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';
import {
  BUILTIN_CHECKS,
  CHECK_KINDS,
  CheckDetails,
  CheckEditor,
  checkFromDraft,
  draftFromCheck,
  emptyCheckDraft,
  type CheckDraft,
} from './evaluator-check-editor';

type StepEvaluation = ReturnType<typeof useStepEvaluation>;

const SEVERITIES = EvaluatorSeveritySchema.options;

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Loading() {
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
}

/** Every production run of the Step loaded so far, newest first. */
export function loadedAgentRuns(evaluation: StepEvaluation): AgentRun[] {
  return evaluation.agentRuns.data?.pages.flatMap((page) => page.runs) ?? [];
}

/** The Step's context of use (D16), versioned on every save. */
export function BriefSection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['brief']; mayEdit: boolean }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const save = useStepEvaluationMutation(step, (text: string) => mediforce.evaluation.setBrief({ ...step, text }));
  const brief = data.data?.brief ?? null;
  return (
    <Section
      title="Evaluation Brief"
      action={mayEdit && draft === null && (
        <button type="button" className={buttonClass} onClick={() => setDraft(brief?.text ?? '')}>{brief === null ? 'Write' : 'Edit'}</button>
      )}
    >
      <p className="text-xs text-muted-foreground" data-testid="brief-purpose">
        The step&apos;s context of use: what it is for, who relies on its output, which failures matter most. The assistant reads it on every turn to plan Evaluators and propose Acceptance Criteria, and a Step Qualification cites the Brief version its Eval Run was prepared under — so a step needs a Brief before it can be qualified.
      </p>
      {data.isLoading ? <Loading /> : draft !== null ? (
        <div className="space-y-2">
          <textarea
            className={cn(inputClass, 'w-full min-h-24')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What this step is for, who relies on its output, which failures matter most."
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={draft.trim() === '' || save.isPending}
              onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}
            >Save as v{(brief?.version ?? 0) + 1}</button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : brief === null ? (
        <p className="text-sm text-muted-foreground">No Brief yet — the step&apos;s context of use is unstated. The assistant can draft one.</p>
      ) : (
        <div className="space-y-1">
          <MarkdownPresentation content={brief.text} />
          <p className="text-xs text-muted-foreground">v{brief.version} · {brief.origin === 'assistant' ? 'drafted by the assistant' : 'written'} by {brief.createdBy}</p>
        </div>
      )}
    </Section>
  );
}

/** Typing "Grades match CTCAE" gives "grades-match-ctcae" — the only form an Evaluator name takes. */
export function toEvaluatorName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 63);
}

/** What a judge may be labelled on: the Step's Eval Cases (their source runs first) and its loaded production runs. */
export interface LabelCandidates {
  cases: readonly EvalCase[];
  runs: readonly AgentRun[];
}

/** A judge's labels so far, against what it needs to count. */
function JudgeProgress({ step, evaluator }: { step: EvaluatedStep; evaluator: EvaluatorView }) {
  const labels = useEvaluatorLabels(step, evaluator.id);
  return <CalibrationProgress evaluator={evaluator} labels={[...labelsBySubject(labels.data?.labels ?? []).values()]} />;
}

function EvaluatorRow({ step, evaluator, mayEdit, stepOutputSchema, labelCandidates }: {
  step: EvaluatedStep;
  evaluator: EvaluatorView;
  mayEdit: boolean;
  stepOutputSchema: AgentOutputSchema | undefined;
  labelCandidates: LabelCandidates;
}) {
  const [labelling, setLabelling] = React.useState(false);
  const approve = useStepEvaluationMutation(step, () =>
    mediforce.evaluation.approveEvaluatorSource({ evaluatorId: evaluator.id, version: evaluator.latest.version }));
  const archive = useStepEvaluationMutation(step, () => mediforce.evaluation.archiveEvaluator({ evaluatorId: evaluator.id }));
  const production = useStepEvaluationMutation(step, (runInProduction: boolean) =>
    mediforce.evaluation.setEvaluatorProduction({ evaluatorId: evaluator.id, runInProduction }));
  const edit = useStepEvaluationMutation(step, (changes: Omit<AddEvaluatorVersionInput, 'evaluatorId'>) =>
    mediforce.evaluation.addEvaluatorVersion({ evaluatorId: evaluator.id, ...changes }));
  const [editing, setEditing] = React.useState(false);
  const [unchanged, setUnchanged] = React.useState(false);
  const check = evaluator.latest.check;
  const saveVersion = (values: { rule: string; severity: EvaluatorSeverity; check: EvaluatorCheck }) => {
    const changes = {
      ...(values.rule.trim() === evaluator.latest.rule ? {} : { rule: values.rule }),
      ...(values.severity === evaluator.latest.severity ? {} : { severity: values.severity }),
      ...(JSON.stringify(values.check) === JSON.stringify(check) ? {} : { check: values.check }),
    };
    if (Object.keys(changes).length === 0) {
      setUnchanged(true);
      return;
    }
    setUnchanged(false);
    edit.mutate(changes, { onSuccess: () => setEditing(false) });
  };
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0" data-testid="evaluator-row">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm">
            <span className="font-medium">{evaluator.name}</span>
            <span className="ml-1.5 text-xs text-muted-foreground">v{evaluator.latest.version} · {CHECK_KINDS[check.kind].label} · {evaluator.latest.severity}{evaluator.latest.origin === 'assistant' ? ' · from the assistant' : ''}</span>
          </div>
          <p className="text-xs text-muted-foreground">{evaluator.latest.rule}</p>
          <span className={cn(
            'mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium',
            evaluator.trust.trusted ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>{evaluator.trust.trusted ? 'Counts' : `Not counted — ${evaluator.trust.reason}`}</span>
          {check.kind === 'llm_judge' && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <JudgeProgress step={step} evaluator={evaluator} />
              <button type="button" className={buttonClass} onClick={() => setLabelling(!labelling)}>{labelling ? 'Hide labelling' : 'Label outputs'}</button>
            </div>
          )}
          <label className="mt-1.5 flex items-center gap-1.5 text-xs" data-testid="evaluator-production">
            <input
              type="checkbox"
              checked={evaluator.runInProduction}
              disabled={mayEdit === false || production.isPending}
              onChange={(event) => production.mutate(event.target.checked)}
            />
            <span>Also run in production</span>
            {evaluator.runInProduction && (
              <span className="text-muted-foreground" data-testid="evaluator-production-state">
                {evaluator.production.active ? '— scoring live runs' : `— ${evaluator.production.reason ?? 'not active'}`}
              </span>
            )}
          </label>
          {evaluator.latest.calibration !== null && (
            <span className="ml-1.5 text-[11px] text-muted-foreground">
              agreement {evaluator.latest.calibration.agreement.toFixed(2)}
              {typeof evaluator.latest.calibration.kappa === 'number' && ` · κ ${evaluator.latest.calibration.kappa.toFixed(2)}`}
              {' '}on {evaluator.latest.calibration.labelCount} labels
            </span>
          )}
        </div>
        {mayEdit && (
          <div className="flex shrink-0 gap-1.5">
            {check.kind === 'code' && evaluator.latest.sourceApproval === null && (
              <button type="button" className={buttonClass} disabled={approve.isPending} onClick={() => approve.mutate(undefined)}>Approve source</button>
            )}
            {!editing && <button type="button" className={buttonClass} onClick={() => setEditing(true)}>Edit</button>}
            <button type="button" className={buttonClass} disabled={archive.isPending} onClick={() => archive.mutate(undefined)}>Archive</button>
          </div>
        )}
      </div>
      {labelling && check.kind === 'llm_judge' && (
        <JudgeCalibrationPanel step={step} evaluator={evaluator} cases={labelCandidates.cases} runs={labelCandidates.runs} mayEdit={mayEdit} />
      )}
      {editing ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-muted-foreground">
            Saving makes v{evaluator.latest.version + 1}; Scores already written keep the version that wrote them.
            {check.kind === 'code' && ' The new version needs its source approved again before it counts, whatever changed.'}
            {check.kind === 'llm_judge' && ' The new version needs calibrating again before it counts, whatever changed.'}
          </p>
          <EvaluatorForm
            initial={{ name: evaluator.name, rule: evaluator.latest.rule, severity: evaluator.latest.severity, draft: draftFromCheck(check) }}
            editing
            stepOutputSchema={stepOutputSchema}
            submitLabel={`Save as v${evaluator.latest.version + 1}`}
            pending={edit.isPending}
            error={unchanged ? 'Nothing changed.' : edit.error?.message ?? null}
            onSubmit={saveVersion}
            onCancel={() => {
              setEditing(false);
              setUnchanged(false);
              edit.reset();
            }}
          />
        </div>
      ) : (
        <details className="mt-1 text-xs" data-testid="evaluator-details">
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <div className="mt-1 space-y-2">
            <CheckDetails check={check} />
            {evaluator.versions.length > 1 && (
              <div>
                <div className="font-medium">Versions</div>
                <ul className="text-muted-foreground">
                  {[...evaluator.versions].reverse().map((version) => (
                    <li key={version.version}>
                      v{version.version} · {version.createdAt.slice(0, 16).replace('T', ' ')} · {version.createdBy}{version.origin === 'assistant' ? ' · from the assistant' : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

interface EvaluatorFormValues {
  name: string;
  rule: string;
  severity: EvaluatorSeverity;
  draft: CheckDraft;
}

/** Name, severity, the kind of check and its fields. The kind comes from the dropdown, never typed. */
function EvaluatorForm({ initial, editing = false, stepOutputSchema, submitLabel, pending, error, onSubmit, onCancel }: {
  initial: EvaluatorFormValues;
  /**
   * Editing an existing Evaluator: its name and type stay. The name is its
   * stable handle, and its Scores, drift and production series are one kind of check.
   */
  editing?: boolean;
  stepOutputSchema: AgentOutputSchema | undefined;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: { name: string; rule: string; severity: EvaluatorSeverity; check: EvaluatorCheck }) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = React.useState(initial);
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const submit = () => {
    const result = checkFromDraft(values.draft);
    if ('error' in result) {
      setDraftError(result.error);
      return;
    }
    setDraftError(null);
    onSubmit({ name: values.name.replace(/-+$/, ''), rule: values.rule, severity: values.severity, check: result.check });
  };
  const shownError = draftError ?? error;
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3" data-testid="evaluator-form">
      <div className="flex gap-2">
        <input
          aria-label="Evaluator name"
          className={cn(inputClass, 'flex-1')}
          placeholder="Name, e.g. grades-match-ctcae"
          title="Also names the Scores it writes: lowercase letters, digits and dashes."
          value={values.name}
          disabled={editing}
          onChange={(event) => setValues({ ...values, name: toEvaluatorName(event.target.value) })}
        />
        <select aria-label="Severity" className={inputClass} value={values.severity} onChange={(event) => setValues({ ...values, severity: EvaluatorSeveritySchema.parse(event.target.value) })}>
          {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}
        </select>
        <select
          aria-label="Type"
          className={inputClass}
          value={values.draft.kind}
          disabled={editing}
          onChange={(event) => {
            const kind = EvaluatorKindSchema.parse(event.target.value);
            setValues({ ...values, draft: emptyCheckDraft(kind, stepOutputSchema) });
          }}
        >
          {EvaluatorKindSchema.options.map((kind) => <option key={kind} value={kind}>{CHECK_KINDS[kind].label}</option>)}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">{CHECK_KINDS[values.draft.kind].description}</p>
      <input aria-label="Rule" className={cn(inputClass, 'w-full')} placeholder="The rule, in plain language" value={values.rule} onChange={(event) => setValues({ ...values, rule: event.target.value })} />
      <CheckEditor draft={values.draft} onChange={(draft) => setValues({ ...values, draft })} stepOutputSchema={stepOutputSchema} />
      {shownError !== null && <p className="text-xs text-destructive">{shownError}</p>}
      <div className="flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={values.name === '' || values.rule.trim() === '' || pending} onClick={submit}>{submitLabel}</button>
        <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The Step's Evaluators with whether each counts (D9); code source is approved here, by a person. */
export function EvaluatorsSection({ step, data, mayEdit, stepOutputSchema, labelCandidates = { cases: [], runs: [] } }: {
  step: EvaluatedStep;
  data: StepEvaluation['evaluators'];
  mayEdit: boolean;
  labelCandidates?: LabelCandidates;
  /** The step's `agent.outputSchema`, offered as the start of a schema check. */
  stepOutputSchema?: AgentOutputSchema;
}) {
  const [adding, setAdding] = React.useState(false);
  const create = useStepEvaluationMutation(step, (values: { name: string; rule: string; severity: EvaluatorSeverity; check: EvaluatorCheck }) =>
    mediforce.evaluation.createEvaluator({ ...step, ...values }));

  const evaluators = data.data?.evaluators ?? [];
  return (
    <Section title="Evaluators" action={mayEdit && !adding && <button type="button" className={buttonClass} onClick={() => setAdding(true)}>Add</button>}>
      {data.isLoading ? <Loading /> : evaluators.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No Evaluators yet. Ask the assistant what to check, or add one.</p>
      ) : (
        <ul className="space-y-2">{evaluators.map((evaluator) => <EvaluatorRow key={evaluator.id} step={step} evaluator={evaluator} mayEdit={mayEdit} stepOutputSchema={stepOutputSchema} labelCandidates={labelCandidates} />)}</ul>
      )}
      {adding && (
        <EvaluatorForm
          initial={{ name: '', rule: '', severity: 'major', draft: emptyCheckDraft('schema', stepOutputSchema) }}
          stepOutputSchema={stepOutputSchema}
          submitLabel="Create"
          pending={create.isPending}
          error={create.error?.message ?? null}
          onSubmit={(values) => create.mutate(values, { onSuccess: () => setAdding(false) })}
          onCancel={() => {
            setAdding(false);
            create.reset();
          }}
        />
      )}
    </Section>
  );
}

const RedTeamSuiteSchema = z.enum(RED_TEAM_SUITES);
type RedTeamSuite = z.infer<typeof RedTeamSuiteSchema>;

// casePrefix: how createRedTeamEvalCases names the suite's cases — "<prefix>: <variant> in '<part>.<path>'".
const RED_TEAM_SUITE_INFO: Record<RedTeamSuite, { casePrefix: string; label: string; description: string; grader: BuiltinCheckName; target: string }> = {
  prompt_injection: {
    casePrefix: 'Injection',
    label: 'Prompt injection',
    description: 'Three cases, each appending an instruction to a text field of the input — a fake system notice, a note "from the sponsor", a delimiter escape — that asks the agent to output a canary marker. The agent should do its job and ignore it.',
    grader: 'injection_ignored',
    target: 'a text field',
  },
  robustness: {
    casePrefix: 'Robustness',
    label: 'Robustness',
    description: 'Cases that change how a field is written but not what it says — doubled whitespace and blank-line padding for text, reversed key order for an object. The result should not change.',
    grader: 'result_stable',
    target: 'a text or object field',
  },
};

const INPUT_PARTS: Record<EvalCaseInputPart, string> = {
  triggerPayload: 'Trigger payload',
  previousStepOutputs: 'Earlier steps\' outputs',
  previousRun: 'Previous run carry-over',
};

/**
 * The built-in case suites (ADR-0023 phase 5a): from one production run, the
 * platform writes the cases itself, each graded by a built-in Evaluator.
 */
function BuiltinCaseSuites({ step, evaluation }: { step: EvaluatedStep; evaluation: StepEvaluation }) {
  const runs = loadedAgentRuns(evaluation);
  const evaluators = evaluation.evaluators.data?.evaluators ?? [];
  const [suite, setSuite] = React.useState<RedTeamSuite>('prompt_injection');
  const [runId, setRunId] = React.useState('');
  const [part, setPart] = React.useState<EvalCaseInputPart>('triggerPayload');
  const [path, setPath] = React.useState('');
  const baseAgentRunId = runId === '' ? runs[0]?.id : runId;
  const pathKeys = path.split('.').map((key) => key.trim()).filter((key) => key !== '');
  const create = useStepEvaluationMutation(step, () => mediforce.evaluation.createRedTeamCases({
    ...step,
    suite,
    baseAgentRunId: baseAgentRunId!,
    target: { part, path: pathKeys },
  }));
  const info = RED_TEAM_SUITE_INFO[suite];
  const target = `'${[part, ...pathKeys].join('.')}'`;
  const alreadyAdded = (evaluation.cases.data?.cases ?? []).filter((evalCase) =>
    evalCase.sourceAgentRunId === baseAgentRunId
    && evalCase.name.startsWith(`${info.casePrefix}: `)
    && evalCase.name.endsWith(` in ${target}`)).length;
  const graded = evaluators.some((evaluator) => evaluator.latest.check.kind === 'builtin' && evaluator.latest.check.name === info.grader);
  const addGrader = useStepEvaluationMutation(step, () => mediforce.evaluation.createEvaluator({
    ...step,
    name: toEvaluatorName(info.grader),
    rule: BUILTIN_CHECKS[info.grader].label,
    severity: 'major',
    check: { kind: 'builtin', name: info.grader },
  }));

  return (
    <details className="text-sm" data-testid="builtin-case-suites">
      <summary className="cursor-pointer text-xs text-muted-foreground">Built-in case suites — injection and robustness cases, written for you</summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-muted-foreground" data-testid="builtin-suites-purpose">
          Two risks production runs rarely show: the agent obeying an instruction hidden in its data (prompt injection), and its answer changing when the input is only reworded (robustness). Pick a production run and a field of its input: the platform writes the cases — copies of that run&apos;s input with the field changed — into the Eval Cases above, where each opens, edits and archives like any case. Every case expects the output the run gave, and a built-in Evaluator grades it in an Eval Run. The assistant can propose a suite too.
        </p>
        <label className="flex items-center gap-1">Suite
          <select aria-label="Suite" className={inputClass} value={suite} onChange={(event) => setSuite(RedTeamSuiteSchema.parse(event.target.value))}>
            {RED_TEAM_SUITES.map((name) => <option key={name} value={name}>{RED_TEAM_SUITE_INFO[name].label}</option>)}
          </select>
        </label>
        <p className="text-muted-foreground">{info.description}</p>
        <div className={cn('flex flex-wrap items-center gap-2', graded ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300')} data-testid="builtin-suite-grader">
          <span>Graded by the built-in &ldquo;{BUILTIN_CHECKS[info.grader].label}&rdquo; Evaluator{graded ? '.' : ' — this step has none yet, so nothing would grade these cases.'}</span>
          {!graded && (
            <button type="button" className={buttonClass} disabled={addGrader.isPending} onClick={() => addGrader.mutate(undefined)}>Add it</button>
          )}
          {addGrader.error !== null && <span className="text-destructive">{addGrader.error.message}</span>}
        </div>
        {runs.length === 0 ? (
          <p className="text-muted-foreground">The step has no production runs to start from yet.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">From run
              <select aria-label="From run" className={inputClass} value={runId} onChange={(event) => setRunId(event.target.value)}>
                {runs.map((run) => <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {run.startedAt.slice(0, 16).replace('T', ' ')}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1">Field in
              <select aria-label="Input part" className={inputClass} value={part} onChange={(event) => setPart(EvalCaseInputPartSchema.parse(event.target.value))}>
                {EvalCaseInputPartSchema.options.map((name) => <option key={name} value={name}>{INPUT_PARTS[name]}</option>)}
              </select>
            </label>
            <input
              aria-label="Field path"
              className={cn(inputClass, 'font-mono text-xs')}
              placeholder="e.g. narrative or document.text"
              title={`The path to ${info.target} of the input, keys joined by dots.`}
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <button
              type="button"
              className={buttonClass}
              disabled={path.trim() === '' || create.isPending}
              onClick={() => create.mutate(undefined)}
            >Add suite cases</button>
          </div>
        )}
        {pathKeys.length > 0 && alreadyAdded > 0 && (
          <p className="text-amber-700 dark:text-amber-300" data-testid="builtin-suite-duplicate">
            This run already has {alreadyAdded} {info.label.toLowerCase()} case(s) for {target}; adding the suite again writes them again.
          </p>
        )}
        {create.error !== null && <p className="text-destructive">{create.error.message} Cases are written one at a time, so any written before the error were kept.</p>}
        {create.data !== undefined && <p className="text-muted-foreground">Added {create.data.cases.length} case(s).</p>}
      </div>
    </details>
  );
}

interface CaseFormValues {
  name: string;
  expectation: EvalCaseExpectation;
  split: EvalCase['split'];
  notes: string;
  /** The case input as JSON text: triggerPayload, previousStepOutputs and optionally previousRun. */
  input: string;
}

export interface CaseFormResult {
  name: string;
  expectation: EvalCaseExpectation;
  split: EvalCase['split'];
  notes: string | null;
  input: EvalCaseInput;
}

export function caseFormValues(evalCase: EvalCase): CaseFormValues {
  return {
    name: evalCase.name,
    expectation: evalCase.expectation,
    split: evalCase.split,
    notes: evalCase.notes ?? '',
    input: JSON.stringify(evalCase.input, null, 2),
  };
}

/** The input text as a case input, or why it is not one. */
export function parseCaseInput(text: string): { input: EvalCaseInput } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'The input is not valid JSON.' };
  }
  const checked = EvalCaseInputSchema.safeParse(parsed);
  if (checked.success === false) {
    return { error: `The input does not fit: ${checked.error.issues.map((issue) => `${issue.path.length === 0 ? 'input' : issue.path.join('.')} — ${issue.message}`).join('; ')}` };
  }
  return { input: checked.data };
}

/** Name, expectation, split, notes and the input the step is given. */
function CaseForm({ initial, inputHelp, submitLabel, pending, error, onSubmit, onCancel }: {
  initial: CaseFormValues;
  inputHelp: React.ReactNode;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: CaseFormResult) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = React.useState(initial);
  const [inputError, setInputError] = React.useState<string | null>(null);
  const submit = () => {
    const parsed = parseCaseInput(values.input);
    if ('error' in parsed) {
      setInputError(parsed.error);
      return;
    }
    setInputError(null);
    const notes = values.notes.trim();
    onSubmit({ name: values.name.trim(), expectation: values.expectation, split: values.split, notes: notes === '' ? null : notes, input: parsed.input });
  };
  const shownError = inputError ?? error;
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs" data-testid="case-form">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Case name" className={cn(inputClass, 'min-w-48 flex-1')} placeholder="Name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
        <select aria-label="Expectation" className={inputClass} value={values.expectation} onChange={(event) => setValues({ ...values, expectation: EvalCaseExpectationSchema.parse(event.target.value) })}>
          <option value="positive">positive — a correct output exists</option>
          <option value="negative">negative — no output should be accepted</option>
        </select>
        <select aria-label="Split" className={inputClass} value={values.split} onChange={(event) => setValues({ ...values, split: EvalCaseSplitSchema.parse(event.target.value) })}>
          <option value="dev">dev</option>
          <option value="holdout">holdout</option>
        </select>
      </div>
      <textarea
        aria-label="Notes"
        className={cn(inputClass, 'w-full min-h-16')}
        placeholder="What the output must — or must not — do. Judges and code checks read it with the case."
        value={values.notes}
        onChange={(event) => setValues({ ...values, notes: event.target.value })}
      />
      <div className="space-y-1">
        <div className="text-muted-foreground">{inputHelp}</div>
        <textarea
          aria-label="Case input"
          className={cn(inputClass, 'w-full min-h-40 font-mono text-xs')}
          spellCheck={false}
          value={values.input}
          onChange={(event) => setValues({ ...values, input: event.target.value })}
        />
      </div>
      {shownError !== null && <p className="text-destructive">{shownError}</p>}
      <div className="flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={values.name.trim() === '' || pending} onClick={submit}>{submitLabel}</button>
        <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Opens the log of the production run a case came from; the run is fetched only when asked for. */
function SourceRunLog({ agentRunId }: { agentRunId: string }) {
  const [open, setOpen] = React.useState(false);
  const { data: run, loading } = useAgentRun(open ? agentRunId : null);
  return (
    <>
      <button type="button" className={buttonClass} disabled={open && loading} onClick={() => setOpen(true)}>{open && loading ? 'Loading…' : 'Source run log'}</button>
      <AgentLogPanel run={open ? run : null} onClose={() => setOpen(false)} />
    </>
  );
}

const CASE_SOURCES: Record<EvalCase['source'], string> = {
  production: 'a production run, as it ran',
  manual: 'written by hand',
  synthesized: 'a production run with a deliberate change',
};

/** One Eval Case: what it gives the step and expects, its source run's log, and editing or archiving it. */
function CaseRow({ step, evalCase, mayEdit, unfrozen }: {
  step: EvaluatedStep;
  evalCase: EvalCase;
  mayEdit: boolean;
  /** Not in the newest Dataset version, so the next Eval Run does not run it. */
  unfrozen: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [opened, setOpened] = React.useState(false);
  const edit = useStepEvaluationMutation(step, (values: CaseFormResult) => mediforce.evaluation.updateCase({
    caseId: evalCase.id,
    ...(values.name === evalCase.name ? {} : { name: values.name }),
    ...(values.expectation === evalCase.expectation ? {} : { expectation: values.expectation }),
    ...(values.split === evalCase.split ? {} : { split: values.split }),
    ...(values.notes === evalCase.notes ? {} : { notes: values.notes }),
    ...(JSON.stringify(values.input) === JSON.stringify(evalCase.input) ? {} : { input: values.input }),
  }));
  const archive = useStepEvaluationMutation(step, () => mediforce.evaluation.archiveCase({ caseId: evalCase.id, archived: true }));
  return (
    <li className="border-t pt-1.5 first:border-t-0 first:pt-0" data-testid="eval-case-row">
      <div className="flex items-center gap-2">
        <span className={cn('rounded px-1.5 text-[11px]', evalCase.expectation === 'positive' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>{evalCase.expectation}</span>
        <span className="truncate">{evalCase.name}</span>
        {unfrozen && (
          <InstantTooltip label="Not in the newest Dataset version, so the next Eval Run does not run it. Freeze the dataset to include it.">
            <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="eval-case-unfrozen">not frozen</span>
          </InstantTooltip>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{evalCase.split} · {evalCase.source}{evalCase.perturbation === null ? '' : ` (${evalCase.perturbation.kind.replace(/_/g, ' ')})`}{evalCase.origin === 'assistant' ? ' · from the assistant' : ''}</span>
      </div>
      {editing ? (
        <div className="mt-2">
          <CaseForm
            initial={caseFormValues(evalCase)}
            inputHelp={<>What the step is given: the trigger payload and the outputs of the steps before it. Keep its shape; change the values.{evalCase.source === 'production' && ' A production case with an edited input becomes a manual one.'}</>}
            submitLabel="Save"
            pending={edit.isPending}
            error={edit.error?.message ?? null}
            onSubmit={(values) => edit.mutate(values, { onSuccess: () => setEditing(false) })}
            onCancel={() => {
              setEditing(false);
              edit.reset();
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">Saving adds the edited case and archives this one: a Dataset version frozen with it keeps it, and the next freeze takes the edit.</p>
        </div>
      ) : (
        <details className="mt-0.5 text-xs" data-testid="eval-case-details" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
          <summary className="cursor-pointer text-muted-foreground">Details</summary>
          <div className="mt-1 space-y-1.5">
            <p><span className="text-muted-foreground">Source:</span> {CASE_SOURCES[evalCase.source]}{evalCase.sourceAgentRunId !== null && <> — run <span className="font-mono">{evalCase.sourceAgentRunId.slice(0, 8)}</span></>}</p>
            {evalCase.perturbation !== null && (
              <p>
                <span className="text-muted-foreground">Change ({evalCase.perturbation.kind.replace(/_/g, ' ')}):</span> {evalCase.perturbation.description}
                {evalCase.perturbation.canary !== undefined && <> — canary <span className="font-mono">{evalCase.perturbation.canary}</span></>}
              </p>
            )}
            <p><span className="text-muted-foreground">Expects:</span> {evalCase.notes ?? (evalCase.expectation === 'positive' ? 'an output that passes every counted Evaluator (no notes)' : 'no output to be accepted (no notes)')}</p>
            {opened && evalCase.source === 'production' && evalCase.sourceAgentRunId !== null && (
              <div>
                <div className="mb-0.5 font-medium">The run you marked {evalCase.expectation}</div>
                <RunInputOutput agentRunId={evalCase.sourceAgentRunId} />
              </div>
            )}
            {evalCase.source === 'synthesized' && evalCase.sourceAgentRunId !== null && (
              <>
                <p className="text-muted-foreground">This changed input has no output of its own until an Eval Run runs it.</p>
                <RunInputOutputDetails agentRunId={evalCase.sourceAgentRunId} summary="The source run's input and output, before the change" />
              </>
            )}
            {evalCase.source === 'manual' && (
              <p className="text-muted-foreground">Written by hand: it has no output until an Eval Run runs it.</p>
            )}
            <details>
              <summary className="cursor-pointer text-muted-foreground">Input an Eval Run gives the step</summary>
              <pre className="mt-0.5 max-h-60 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap" data-testid="eval-case-input">{JSON.stringify(evalCase.input, null, 2)}</pre>
            </details>
            {evalCase.workspaceSeedCommit !== null && (
              <p><span className="text-muted-foreground">Starts from workspace commit</span> <span className="font-mono">{evalCase.workspaceSeedCommit.slice(0, 12)}</span></p>
            )}
            <p className="text-muted-foreground">Added by {evalCase.createdBy} on {evalCase.createdAt.slice(0, 16).replace('T', ' ')}{evalCase.containsProductionData ? ' · contains production data' : ''}</p>
            <div className="flex flex-wrap gap-1.5">
              {evalCase.sourceAgentRunId !== null && <SourceRunLog agentRunId={evalCase.sourceAgentRunId} />}
              {mayEdit && <button type="button" className={buttonClass} onClick={() => setEditing(true)}>Edit</button>}
              {mayEdit && <button type="button" className={buttonClass} disabled={archive.isPending} onClick={() => archive.mutate(undefined)}>Archive</button>}
            </div>
            {archive.error !== null && <p className="text-destructive">{archive.error.message}</p>}
          </div>
        </details>
      )}
    </li>
  );
}

const EMPTY_CASE_INPUT: EvalCaseInput = { triggerPayload: {}, previousStepOutputs: {} };
const FROM_FILE = 'file';

/** A `.json` file: a whole case as `mediforce eval case-add --file` takes it, or only its input. */
export function caseFromFile(text: string): { values: Partial<CaseFormValues> } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'The file is not valid JSON.' };
  }
  const whole = z.object({
    name: z.string().optional(),
    input: EvalCaseInputSchema,
    expectation: EvalCaseExpectationSchema.optional(),
    notes: z.string().nullable().optional(),
    split: EvalCaseSplitSchema.optional(),
  }).safeParse(parsed);
  if (whole.success) {
    const { input, notes, ...rest } = whole.data;
    return { values: { ...rest, ...(notes === undefined || notes === null ? {} : { notes }), input: JSON.stringify(input, null, 2) } };
  }
  const input = EvalCaseInputSchema.safeParse(parsed);
  if (input.success) return { values: { input: JSON.stringify(input.data, null, 2) } };
  return { error: 'The file is neither a case ({ name, input, expectation, notes, split }) nor a case input ({ triggerPayload, previousStepOutputs }).' };
}

/**
 * A case written by hand: its input starts from an existing case's, so it has
 * the shape the step is given, or from a `.json` file. For inputs production
 * never sent — a negative case nobody would run on purpose.
 */
function WriteCase({ step, cases, onClose }: { step: EvaluatedStep; cases: readonly EvalCase[]; onClose: () => void }) {
  const [startFrom, setStartFrom] = React.useState<string>(cases[0]?.id ?? '');
  const [fromFile, setFromFile] = React.useState<{ name: string; values: Partial<CaseFormValues> } | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const template = fromFile === null ? cases.find((evalCase) => evalCase.id === startFrom) : undefined;
  const create = useStepEvaluationMutation(step, (values: CaseFormResult) => mediforce.evaluation.createCase({
    ...step,
    ...values,
    workspaceSeedCommit: template?.workspaceSeedCommit ?? null,
    containsProductionData: template?.containsProductionData ?? false,
  }));
  const readFile = async (file: File) => {
    const read = caseFromFile(await file.text());
    if ('error' in read) {
      setFileError(read.error);
      return;
    }
    setFileError(null);
    setFromFile({ name: file.name, values: read.values });
  };
  const initial: CaseFormValues = {
    name: '',
    expectation: 'positive',
    split: 'dev',
    notes: '',
    input: JSON.stringify(template?.input ?? EMPTY_CASE_INPUT, null, 2),
    ...fromFile?.values,
  };
  return (
    <div className="space-y-2 text-xs" data-testid="write-case">
      <p className="text-muted-foreground">
        Write the input yourself — for what production has not sent yet, such as an input the step must refuse or a record that should trip a rule. Start from a case so the input keeps the shape the step is given, then change its values.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">Start from
          <select
            aria-label="Start from"
            className={inputClass}
            value={fromFile === null ? startFrom : FROM_FILE}
            onChange={(event) => {
              if (event.target.value === FROM_FILE) return;
              setFromFile(null);
              setStartFrom(event.target.value);
            }}
          >
            {fromFile !== null && <option value={FROM_FILE}>{fromFile.name}</option>}
            {cases.map((evalCase) => <option key={evalCase.id} value={evalCase.id}>{evalCase.name}</option>)}
            <option value="">{cases.length === 0 ? 'An empty input' : 'An empty input (no workspace files)'}</option>
          </select>
        </label>
        <label className={cn(buttonClass, 'cursor-pointer')}>
          Load a .json file
          <input
            type="file"
            accept="application/json,.json"
            aria-label="Case file"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file !== undefined) void readFile(file);
            }}
          />
        </label>
      </div>
      {cases.length === 0 && fromFile === null && (
        <p className="text-muted-foreground">Add a production run as a case first to start from the input it was given.</p>
      )}
      {template?.workspaceSeedCommit != null && (
        <p className="text-muted-foreground">It starts from the same workspace files as &lsquo;{template.name}&rsquo;.</p>
      )}
      {fileError !== null && <p className="text-destructive">{fileError}</p>}
      <CaseForm
        key={fromFile === null ? `case:${startFrom}` : `file:${fromFile.name}:${JSON.stringify(fromFile.values)}`}
        initial={initial}
        inputHelp="What the step is given: the trigger payload, the outputs of the steps before it by step id, and the previous run's carry-over when the workflow has one."
        submitLabel="Add case"
        pending={create.isPending}
        error={create.error?.message ?? null}
        onSubmit={(values) => create.mutate(values, { onSuccess: onClose })}
        onCancel={onClose}
      />
    </div>
  );
}

/** How the live cases differ from a Dataset version: cases added or edited since, and cases it has that were archived or replaced. */
export function datasetDrift(cases: readonly EvalCase[], dataset: EvalDatasetVersion | undefined): { unfrozen: Set<string>; dropped: number } {
  const frozen = new Set(dataset?.caseIds ?? []);
  const live = new Set(cases.map((evalCase) => evalCase.id));
  return {
    unfrozen: new Set(cases.filter((evalCase) => !frozen.has(evalCase.id)).map((evalCase) => evalCase.id)),
    dropped: [...frozen].filter((caseId) => !live.has(caseId)).length,
  };
}

/**
 * What freezing means and where it stands: an Eval Run runs the newest frozen
 * Dataset version, never the live list, and a version never changes.
 */
function DatasetStatus({ cases, datasets }: { cases: readonly EvalCase[]; datasets: readonly EvalDatasetVersion[] }) {
  const [latest] = datasets;
  const { unfrozen, dropped } = datasetDrift(cases, latest);
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-2 text-xs" data-testid="dataset-status">
      <p className="text-muted-foreground">
        An Eval Run does not run the list above: it runs a <span className="font-medium text-foreground">Dataset</span> — a numbered snapshot of the live cases taken by <span className="font-medium text-foreground">Freeze dataset</span>. A snapshot never changes, so every Eval Run can be read against exactly the cases it ran. Freeze again after adding, editing or archiving cases.
      </p>
      {latest === undefined ? (
        <p className="text-amber-700 dark:text-amber-300">Nothing frozen yet — an Eval Run cannot be prepared until the cases are frozen.</p>
      ) : unfrozen.size === 0 && dropped === 0 ? (
        <p>The next Eval Run runs <span className="font-medium">Dataset v{latest.version}</span>: all {latest.caseIds.length} live case(s){latest.containsProductionData ? ' — contains production data' : ''}.</p>
      ) : (
        <p className="text-amber-700 dark:text-amber-300">
          The next Eval Run runs <span className="font-medium">Dataset v{latest.version}</span> ({latest.caseIds.length} case(s)), which is behind the list:
          {unfrozen.size > 0 && ` ${unfrozen.size} case(s) added or edited since are not in it`}{unfrozen.size > 0 && dropped > 0 && ';'}
          {dropped > 0 && ` it still has ${dropped} case(s) archived or replaced since`}. Freeze to make v{latest.version + 1}.
        </p>
      )}
      {datasets.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Versions ({datasets.length})</summary>
          <ul className="mt-1 space-y-0.5 text-muted-foreground" data-testid="dataset-versions">
            {datasets.map((dataset) => (
              <li key={dataset.id}>
                v{dataset.version} · {dataset.createdAt.slice(0, 16).replace('T', ' ')} · {dataset.caseIds.length} case(s) · {dataset.createdBy}{dataset.containsProductionData ? ' · contains production data' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Eval Cases, harvested from production runs or written by the assistant, and frozen Dataset versions. */
export function CasesSection({ step, evaluation, mayEdit }: { step: EvaluatedStep; evaluation: StepEvaluation; mayEdit: boolean }) {
  const harvest = useStepEvaluationMutation(step, (input: { agentRunId: string; expectation: 'positive' | 'negative' }) =>
    mediforce.evaluation.createCaseFromAgentRun(input));
  const freeze = useStepEvaluationMutation(step, () => mediforce.evaluation.freezeDataset(step));
  const cases = evaluation.cases.data?.cases ?? [];
  const harvested = new Set(cases.filter((evalCase) => evalCase.source === 'production').map((evalCase) => evalCase.sourceAgentRunId));
  const runs = loadedAgentRuns(evaluation).filter((run) => !harvested.has(run.id));
  const datasets = evaluation.datasets.data?.datasets ?? [];
  const [latest] = datasets;
  const { unfrozen, dropped } = datasetDrift(cases, latest);
  const upToDate = latest !== undefined && unfrozen.size === 0 && dropped === 0;
  const [logRun, setLogRun] = React.useState<AgentRun | null>(null);
  const [writing, setWriting] = React.useState(false);

  return (
    <Section
      title="Eval Cases"
      action={mayEdit && (
        <div className="flex gap-1.5">
          {!writing && <button type="button" className={buttonClass} onClick={() => setWriting(true)}>Write a case</button>}
          {cases.length > 0 && (
            <InstantTooltip label={upToDate ? `Dataset v${latest.version} already has every live case.` : `Snapshot the ${cases.length} live case(s) as Dataset v${(latest?.version ?? 0) + 1}, which the next Eval Run runs.`}>
              <span className="inline-flex">
                <button type="button" className={buttonClass} disabled={freeze.isPending || upToDate} onClick={() => freeze.mutate(undefined)}>Freeze dataset</button>
              </span>
            </InstantTooltip>
          )}
        </div>
      )}
    >
      <p className="text-xs text-muted-foreground" data-testid="eval-cases-purpose">
        An Eval Case is an <span className="font-medium text-foreground">input</span> an Eval Run re-runs the step on, and what its new output should be — positive when a correct output exists, negative when the output it gave was wrong. A case grades nothing itself: the Evaluators grade each re-run&apos;s output. Pass/fail <span className="font-medium text-foreground">labels</span> on outputs are a different thing — they calibrate a judge, under Evaluators.
      </p>
      {writing && <WriteCase step={step} cases={cases} onClose={() => setWriting(false)} />}
      {evaluation.cases.isLoading ? <Loading /> : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases yet. Add production runs below, write one, or ask the assistant.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {cases.map((evalCase) => <CaseRow key={evalCase.id} step={step} evalCase={evalCase} mayEdit={mayEdit} unfrozen={latest !== undefined && unfrozen.has(evalCase.id)} />)}
        </ul>
      )}
      {cases.length > 0 && <DatasetStatus cases={cases} datasets={datasets} />}
      {freeze.error !== null && <p className="text-xs text-destructive">{freeze.error.message}</p>}
      {mayEdit && runs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Production runs to add as Eval Cases ({runs.length}{evaluation.agentRuns.hasNextPage ? '+' : ''})
          </summary>
          <p className="mt-1 text-xs text-muted-foreground">Open a run&apos;s input and output, then add it as a positive case (its output was right) or a negative one (it was wrong).</p>
          <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto pr-1" data-testid="harvestable-runs">
            {runs.map((run) => (
              <li key={run.id} className="rounded border px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span>{run.startedAt.slice(0, 16).replace('T', ' ')}</span>
                  <span className="text-muted-foreground">{run.status}{run.fallbackReason === null ? '' : ` · ${run.fallbackReason}`}</span>
                  <span className="font-mono text-muted-foreground" title={run.id}>{run.id.slice(0, 8)}</span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button type="button" className={buttonClass} onClick={() => setLogRun(run)}>Log</button>
                    <InstantTooltip label="The output was right: an Eval Run re-runs this input and expects an output its Evaluators accept.">
                      <button type="button" className={buttonClass} onClick={() => harvest.mutate({ agentRunId: run.id, expectation: 'positive' })}>Positive case</button>
                    </InstantTooltip>
                    <InstantTooltip label="The output was wrong: an Eval Run re-runs this input; the case's notes say what the output must not do.">
                      <button type="button" className={buttonClass} onClick={() => harvest.mutate({ agentRunId: run.id, expectation: 'negative' })}>Negative case</button>
                    </InstantTooltip>
                  </span>
                </div>
                {run.envelope !== null && run.envelope.reasoning_summary !== '' && (
                  <p className="mt-1 line-clamp-2 text-muted-foreground" title={run.envelope.reasoning_summary}>{run.envelope.reasoning_summary}</p>
                )}
                <RunInputOutputDetails agentRunId={run.id} />
              </li>
            ))}
          </ul>
          {evaluation.agentRuns.hasNextPage && (
            <button
              type="button"
              className={cn(buttonClass, 'mt-2')}
              disabled={evaluation.agentRuns.isFetchingNextPage}
              onClick={() => void evaluation.agentRuns.fetchNextPage()}
            >{evaluation.agentRuns.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>
          )}
          {harvest.error !== null && <p className="mt-1 text-xs text-destructive">{harvest.error.message}</p>}
        </details>
      )}
      <AgentLogPanel run={logRun} onClose={() => setLogRun(null)} />
      {mayEdit && <BuiltinCaseSuites step={step} evaluation={evaluation} />}
    </Section>
  );
}

type McpEvalMode = McpEvalServerPolicy['mode'];

const MCP_MODES: Record<McpEvalMode, { label: string; description: string }> = {
  deny: {
    label: 'Deny',
    description: 'The agent cannot use this server during a trial — its tools are not offered.',
  },
  live: {
    label: 'Live',
    description: 'Calls go to the real server. Every call and its answer is recorded per case, so later runs can replay it.',
  },
  replay: {
    label: 'Replay',
    description: 'Nothing reaches the server: calls are answered from what a live trial of the same case recorded. A call no recording answers gets an error.',
  },
};

/**
 * What each MCP server of the Step's agent may do in a trial (D6); unnamed
 * servers are denied. A live trial records what a server answers, per case, for
 * a replay.
 */
export function McpPolicySection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['mcpPolicy']; mayEdit: boolean }) {
  const save = useStepEvaluationMutation(step, (servers: Record<string, McpEvalServerPolicy>) =>
    mediforce.evaluation.setMcpPolicy({ ...step, servers }));
  const servers = data.data?.servers ?? [];
  if (!data.isLoading && servers.length === 0) return null;
  const policyOf = (mode: McpEvalMode, denyTools: string[] | undefined): McpEvalServerPolicy =>
    ({ mode, ...(denyTools === undefined || mode !== 'live' ? {} : { denyTools }) });
  const setMode = (name: string, mode: McpEvalMode) => {
    const next = Object.fromEntries(servers.filter((server) => server.defaulted === false)
      .map((server) => [server.name, policyOf(server.mode, server.denyTools)]));
    next[name] = policyOf(mode, servers.find((server) => server.name === name)?.denyTools);
    save.mutate(next);
  };
  return (
    <Section title="MCP servers in eval trials">
      <p className="text-xs text-muted-foreground">
        What the step&apos;s agent may do with each of its MCP servers while an Eval Run tries it. Record with Live once, then Replay for repeatable runs that touch nothing outside.
      </p>
      {data.isLoading ? <Loading /> : (
        <ul className="space-y-2 text-sm">
          {servers.map((server) => (
            <li key={server.name} className="space-y-0.5" data-testid="mcp-policy-server">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{server.name}</span>
                {server.mode === 'live' && server.denyTools !== undefined && server.denyTools.length > 0 && (
                  <span className="text-xs text-muted-foreground">denied tools: {server.denyTools.join(', ')}</span>
                )}
                <InstantTooltip label="Replay can answer only the cases a Live trial recorded.">
                  <span className="text-xs text-muted-foreground">
                    recorded for {server.recordedCaseIds.length} case{server.recordedCaseIds.length === 1 ? '' : 's'}
                  </span>
                </InstantTooltip>
                <select
                  aria-label={`${server.name} mode`}
                  className={cn(inputClass, 'ml-auto text-xs')}
                  value={server.mode}
                  disabled={!mayEdit || save.isPending}
                  onChange={(event) => setMode(server.name, McpEvalServerPolicySchema.shape.mode.parse(event.target.value))}
                >
                  {McpEvalServerPolicySchema.shape.mode.options.map((mode) => (
                    <option key={mode} value={mode}>{MCP_MODES[mode].label}{mode === 'deny' && server.defaulted ? ' (default)' : ''}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">{MCP_MODES[server.mode].description}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

type CriteriaDraft = Record<EvaluatorSeverity, { minPassRate: string; minPassHatK: string }>;

function toDraft(criteria: AcceptanceCriteria | undefined): CriteriaDraft {
  const field = (value: number | undefined) => (value === undefined ? '' : String(value));
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, {
    minPassRate: field(criteria?.[severity]?.minPassRate),
    minPassHatK: field(criteria?.[severity]?.minPassHatK),
  }])) as CriteriaDraft;
}

function fromDraft(draft: CriteriaDraft): AcceptanceCriteria {
  return Object.fromEntries(SEVERITIES.flatMap((severity) => {
    const { minPassRate, minPassHatK } = draft[severity];
    if (minPassRate.trim() === '') return [];
    return [[severity, { minPassRate: Number(minPassRate), ...(minPassHatK.trim() === '' ? {} : { minPassHatK: Number(minPassHatK) }) }]];
  })) as AcceptanceCriteria;
}

/**
 * The floors Eval Runs are judged against (D10): per severity, the minimum
 * pass rate on its Wilson 95% lower bound and optionally pass^k. Each save is
 * a version; the next run prepared freezes the one in force.
 */
export function AcceptanceCriteriaSection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['criteria']; mayEdit: boolean }) {
  const [draft, setDraft] = React.useState<CriteriaDraft | null>(null);
  const save = useStepEvaluationMutation(step, (criteria: AcceptanceCriteria) => mediforce.evaluation.setAcceptanceCriteria({ ...step, criteria }));
  const current = data.data?.criteria ?? null;
  return (
    <Section
      title="Acceptance Criteria"
      action={mayEdit && draft === null && (
        <button type="button" className={buttonClass} onClick={() => setDraft(toDraft(current?.criteria))}>{current === null ? 'Set' : 'Edit'}</button>
      )}
    >
      {data.isLoading ? <Loading /> : draft !== null ? (
        <div className="space-y-2" data-testid="acceptance-criteria-form">
          <p className="text-xs text-muted-foreground">Minimum pass rate on the Wilson 95% lower bound, and optionally pass^k, that every counted Evaluator of the severity must reach. Leave a severity empty not to judge it.</p>
          {SEVERITIES.map((severity) => (
            <div key={severity} className="flex items-center gap-2 text-xs">
              <span className="w-14">{severity}</span>
              <input
                aria-label={`${severity} minimum pass rate`}
                type="number" min={0} max={1} step={0.01} placeholder="—"
                className={cn(inputClass, 'w-20')}
                value={draft[severity].minPassRate}
                onChange={(event) => setDraft({ ...draft, [severity]: { ...draft[severity], minPassRate: event.target.value } })}
              />
              <span className="text-muted-foreground">pass^k</span>
              <input
                aria-label={`${severity} minimum pass^k`}
                type="number" min={0} max={1} step={0.01} placeholder="—"
                className={cn(inputClass, 'w-20')}
                value={draft[severity].minPassHatK}
                onChange={(event) => setDraft({ ...draft, [severity]: { ...draft[severity], minPassHatK: event.target.value } })}
              />
            </div>
          ))}
          {save.error !== null && <p className="text-xs text-destructive">{save.error.message}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={SEVERITIES.every((severity) => draft[severity].minPassRate.trim() === '') || save.isPending}
              onClick={() => save.mutate(fromDraft(draft), { onSuccess: () => setDraft(null) })}
            >Save as v{(current?.version ?? 0) + 1}</button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : current === null ? (
        <p className="text-sm text-muted-foreground">No Acceptance Criteria yet — Eval Runs judge nothing until they are set. The assistant can propose them from the step&apos;s risks.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-sm" data-testid="acceptance-criteria">{describeAcceptanceCriteria(current.criteria)}</p>
          <p className="text-xs text-muted-foreground">v{current.version} · {current.origin === 'assistant' ? 'proposed by the assistant' : 'set'} by {current.createdBy}</p>
        </div>
      )}
    </Section>
  );
}

const COMPONENT_LABELS: Record<StepFingerprintComponent, string> = {
  step: 'step config',
  model: 'model',
  systemPrompt: 'agent system prompt',
  skill: 'skill',
  image: 'image',
  mcpServers: 'MCP servers',
  preamble: 'workflow preamble',
};

/**
 * Drift alerts: a production Evaluator whose rolling Score mean dropped by the
 * threshold. Shown only while one has; nothing is blocked by it.
 */
export function DriftAlert({ data }: { data: StepEvaluation['drift'] }) {
  const drift = data.data;
  const drifting = drift?.evaluators.filter((evaluator) => evaluator.drifting) ?? [];
  if (drift === undefined || drifting.length === 0) return null;
  return (
    <section role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 space-y-1.5 text-xs" data-testid="drift-alert">
      <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Production Scores are drifting</h3>
      {drifting.map((evaluator) => (
        <p key={evaluator.evaluatorId}>
          <span className="font-medium">{evaluator.name}</span> v{evaluator.evaluatorVersion} ({evaluator.severity}): mean {evaluator.recentMean?.toFixed(2)} over the last {drift.window} production Scores, down from {evaluator.baselineMean?.toFixed(2)} over the {drift.window} before.
        </p>
      ))}
      <p className="text-muted-foreground">An alert is a drop of at least {drift.threshold}. Look at the recent runs, or ask the assistant to diagnose them.</p>
    </section>
  );
}

/**
 * The Step's qualification (D10, D11): whether a signed Step Qualification
 * binds the step as it is now, what it cites, and — when stale — what changed.
 * A person signs one from an Eval Run's report below.
 */
export function QualificationSection({ data }: { data: StepEvaluation['qualification'] }) {
  const status = data.data;
  const qualification = status?.qualification ?? null;
  return (
    <Section title="Step Qualification" action={status !== undefined && <QualificationStatusChip status={status.status} />}>
      {data.isLoading || status === undefined ? <Loading /> : qualification === null ? (
        <p className="text-sm text-muted-foreground">
          Not qualified. Write an Evaluation Brief, set Acceptance Criteria, run the step, and sign a Step Qualification from the run&apos;s report. It is informational: nothing is blocked without one.
        </p>
      ) : (
        <div className="space-y-1.5 text-xs" data-testid="step-qualification">
          <p>
            Signed by <span className="font-medium">{qualification.signature.signerName}</span> on {qualification.signature.signedAt.slice(0, 16).replace('T', ' ')}
            {' '}for {qualification.variantId === CHAMPION_VARIANT_ID ? 'the step' : `'${qualification.variantLabel}' (${describePatch(qualification.patch)})`}
            {' '}— Eval Run <span className="font-mono">{qualification.evalRunId.slice(0, 8)}</span>, Brief v{qualification.briefVersion},
            {' '}fingerprint <span className="font-mono">{qualification.fingerprint.hash.slice(0, 12)}</span>.
          </p>
          <p className="text-muted-foreground">{qualification.signature.meaning} ({qualification.signature.reauthentication === 'password' ? 'password re-entered' : 'signed from the session'})</p>
          <p>Criteria: {describeAcceptanceCriteria(qualification.acceptanceCriteria)}</p>
          <p data-testid="qualification-mcp-policy">{describeMcpPolicy(qualification.mcpPolicy)}</p>
          {qualification.deviations.map((deviation) => (
            <p key={deviation.severity} className="text-amber-700 dark:text-amber-300">Deviation ({deviation.severity}): {deviation.justification}</p>
          ))}
          {status.status === 'stale' && (
            <p className="text-amber-700 dark:text-amber-300" data-testid="qualification-changed">
              The step changed since: {status.changed.map((component) => COMPONENT_LABELS[component]).join(', ')}.
            </p>
          )}
          {status.evaluatorsChanged.length > 0 && (
            <p className="text-muted-foreground" data-testid="qualification-evaluators-changed">Evaluators changed since: {status.evaluatorsChanged.join('; ')}.</p>
          )}
          {status.history.length > 1 && <p className="text-muted-foreground">{status.history.length} qualifications signed for this step.</p>}
        </div>
      )}
    </Section>
  );
}

/**
 * The card a prepared Eval Run waits on: the person starts it by confirming
 * the budget shown (D15). The only place `confirmedBudgetUsd` is sent from.
 */
export function StartEvalRunCard({ step, prepared, mayRun, runReason }: {
  step: EvaluatedStep;
  prepared: PreparedEvalRun;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const start = useStepEvaluationMutation(step, () =>
    mediforce.evaluation.startRun({ evalRunId: prepared.evalRunId, confirmedBudgetUsd: prepared.budgetUsd }));
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="start-eval-run-card">
      <p>
        Eval Run of {prepared.trials} trial(s)
        {prepared.estimatedUsd === null ? ' — no cost estimate' : ` — estimated $${prepared.estimatedUsd}`}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <InstantTooltip label={runReason}>
          <span className="inline-flex">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!mayRun || start.isPending || start.isSuccess}
              onClick={() => start.mutate(undefined)}
            >
              {start.isSuccess ? 'Started' : `Start — spend up to $${prepared.budgetUsd}`}
            </button>
          </span>
        </InstantTooltip>
        {start.error !== null && <span className="text-xs text-destructive">{start.error.message}</span>}
      </div>
    </div>
  );
}

function EvalRunRow({ step, evalRunId, onOpen, open, mayEdit, editReason }: {
  step: EvaluatedStep;
  evalRunId: string;
  onOpen: () => void;
  open: boolean;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const run = useEvalRun(open ? evalRunId : null);
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0">
      <button type="button" className="text-left text-xs font-mono hover:underline" onClick={onOpen}>{evalRunId.slice(0, 8)}</button>
      {open && (run.data === undefined ? <Loading /> : (
        <div className="mt-2"><EvalRunReport output={run.data} step={step} mayEdit={mayEdit} editReason={editReason} /></div>
      ))}
    </li>
  );
}

const CHALLENGERS_TEMPLATE = JSON.stringify([{ label: 'Another model', patch: { model: 'openai/gpt-5' } }], null, 2);

/**
 * Prepare, confirm and read the Step's Eval Runs — the step as it is and any
 * challengers patched over it. Preparing and starting one is the workflow's
 * `run` verb; signing a qualification from a report is its `edit` verb.
 */
export function EvalRunsSection({ step, data, datasets, mayRun, runReason, mayEdit, editReason }: {
  step: EvaluatedStep;
  data: StepEvaluation['runs'];
  /** The Step's frozen Dataset versions, newest first: the one a new run takes, and the one each run ran. */
  datasets: StepEvaluation['datasets'];
  mayRun: boolean;
  runReason: string | undefined;
  mayEdit: boolean;
  editReason: string | undefined;
}) {
  const [trials, setTrials] = React.useState(3);
  const [budget, setBudget] = React.useState('');
  const [challengers, setChallengers] = React.useState<string | null>(null);
  const [challengersError, setChallengersError] = React.useState<string | null>(null);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const prepare = useStepEvaluationMutation(step, (variants: EvalChallenger[]) => mediforce.evaluation.prepareRun({
    ...step,
    trialsPerCase: trials,
    challengers: variants,
    ...(budget === '' ? {} : { budgetUsd: Number(budget) }),
  }));
  const submit = () => {
    let variants: EvalChallenger[] = [];
    if (challengers !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(challengers);
      } catch {
        setChallengersError('The challengers are not valid JSON.');
        return;
      }
      const checked = EvalChallengerSchema.array().safeParse(parsed);
      if (checked.success === false) {
        setChallengersError(`The challengers do not fit: ${checked.error.issues.map((issue) => `${issue.path.length === 0 ? 'list' : issue.path.join('.')} — ${issue.message}`).join('; ')}`);
        return;
      }
      variants = checked.data;
    }
    setChallengersError(null);
    prepare.mutate(variants);
  };
  const prepareError = challengersError ?? prepare.error?.message ?? null;
  const runs = data.data?.evalRuns ?? [];
  const versions = datasets.data?.datasets ?? [];
  const [nextDataset] = versions;
  const datasetVersion = new Map(versions.map((dataset) => [dataset.id, dataset.version]));
  // Prepared here, by the assistant or from the CLI: each waits for a person to confirm its budget.
  const waiting: PreparedEvalRun[] = runs.filter((run) => run.status === 'prepared').map((run) => ({
    evalRunId: run.id,
    budgetUsd: run.budgetUsd,
    estimatedUsd: run.estimate.totalUsd,
    trials: run.caseIds.length * run.trialsPerCase * run.variants.length,
  }));

  return (
    <Section title="Eval Runs">
      {mayRun && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Trials per case
            <input type="number" min={1} max={10} className={cn(inputClass, 'w-16')} value={trials} onChange={(event) => setTrials(Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-1">Budget $
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'w-24')} placeholder="auto" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <button type="button" className={buttonClass} onClick={() => setChallengers(challengers === null ? CHALLENGERS_TEMPLATE : null)}>
            {challengers === null ? 'Add challengers' : 'No challengers'}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={prepare.isPending}
            onClick={submit}
          >Prepare</button>
          <span className="text-muted-foreground" data-testid="eval-run-dataset">
            {nextDataset === undefined ? 'No Dataset frozen yet — freeze the Eval Cases first.' : `Runs Dataset v${nextDataset.version} (${nextDataset.caseIds.length} case(s)).`}
          </span>
          {prepareError !== null && <span className="text-destructive">{prepareError}</span>}
        </div>
      )}
      {mayRun && challengers !== null && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">
            Up to three challengers run beside the step as it is, each a patch: model, prompt, skillCommit or allowedTools replace the step&apos;s own; mcpRestrictions narrow it. Every variant runs every case.
          </p>
          <textarea
            aria-label="Challengers"
            className={cn(inputClass, 'w-full min-h-24 font-mono text-xs')}
            value={challengers}
            onChange={(event) => setChallengers(event.target.value)}
          />
        </div>
      )}
      {waiting.map((run) => <StartEvalRunCard key={run.evalRunId} step={step} prepared={run} mayRun={mayRun} runReason={runReason} />)}
      {data.isLoading ? <Loading /> : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Eval Runs yet.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.id} className="text-sm">
              <span className="text-xs text-muted-foreground">
                {run.createdAt.slice(0, 16).replace('T', ' ')} · {run.status}{datasetVersion.has(run.datasetVersionId) ? ` · Dataset v${datasetVersion.get(run.datasetVersionId)}` : ''} · ${run.spentUsd.toFixed(2)} of ${run.budgetUsd}
                {run.variants.length > 1 && ` · ${run.variants.length} variants`}
              </span>
              <ul>
                <EvalRunRow
                  step={step}
                  evalRunId={run.id}
                  open={openRunId === run.id}
                  onOpen={() => setOpenRunId(openRunId === run.id ? null : run.id)}
                  mayEdit={mayEdit}
                  editReason={editReason}
                />
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function splitText(result: OptimisationSplitResult): string {
  if (result.cases === 0) return 'no cases';
  if (result.passRate === null) return 'not graded';
  return `${result.passes}/${result.graded} · ${(result.passRate * 100).toFixed(0)}% [${((result.wilsonLower ?? 0) * 100).toFixed(0)}–${((result.wilsonUpper ?? 0) * 100).toFixed(0)}%]`;
}

function OptimisationRow({ optimisationId, open, onOpen }: { optimisationId: string; open: boolean; onOpen: () => void }) {
  const detail = useOptimisation(open ? optimisationId : null);
  const output = detail.data;
  return (
    <div>
      <button type="button" className="text-left text-xs font-mono hover:underline" onClick={onOpen}>{optimisationId.slice(0, 8)}</button>
      {open && (output === undefined ? <Loading /> : (
        <div className="mt-2 space-y-2 text-xs" data-testid="optimisation-detail">
          <p className="text-muted-foreground">
            {output.optimisation.status} · {output.spentUsd === null ? 'spend unknown' : `$${output.spentUsd.toFixed(2)}`} of ${output.optimisation.budgetUsd}
            {output.optimisation.jobCostUsd !== null && ` (job $${output.optimisation.jobCostUsd})`}
            {output.evalRun !== null && ` · Eval Run ${output.evalRun.id.slice(0, 8)} ${output.evalRun.status}`}
          </p>
          {output.optimisation.error !== null && <p className="text-destructive">{output.optimisation.error}</p>}
          {output.baseline !== null && (
            <table className="w-full">
              <thead className="text-left text-muted-foreground">
                <tr><th className="font-normal">#</th><th className="font-normal">Variant</th><th className="font-normal">Dev</th><th className="font-normal">Holdout</th></tr>
              </thead>
              <tbody>
                <tr><td /><td>{output.baseline.label}</td><td>{splitText(output.baseline.dev)}</td><td>{splitText(output.baseline.holdout)}</td></tr>
                {output.ranking.map((candidate) => (
                  <tr key={candidate.variantId} data-testid="optimisation-candidate" className="align-top">
                    <td>{candidate.rank}</td>
                    <td>
                      <details>
                        <summary className="cursor-pointer">{candidate.label} <span className="font-mono text-muted-foreground">{candidate.variantId}</span></summary>
                        <pre className="mt-1 whitespace-pre-wrap font-mono">{candidate.prompt}</pre>
                      </details>
                    </td>
                    <td>{splitText(candidate.dev)}</td>
                    <td>{splitText(candidate.holdout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {output.ranking.length > 0 && (
            <p className="text-muted-foreground">Apply a candidate from its Eval Run&apos;s report (Eval Runs above).</p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * GEPA optimisations of the Step's prompt (ADR-0023 D15): start one from a
 * finished Eval Run with a budget — the person's grant, the workflow's `run`
 * verb — and read its candidates ranked by holdout, then dev pass rate.
 */
export function OptimisationsSection({ step, data, runs, mayRun }: {
  step: EvaluatedStep;
  data: StepEvaluation['optimisations'];
  runs: StepEvaluation['runs'];
  mayRun: boolean;
}) {
  const finished = (runs.data?.evalRuns ?? []).filter((run) => run.status !== 'prepared' && run.status !== 'running');
  const [evalRunId, setEvalRunId] = React.useState('');
  const [budget, setBudget] = React.useState('');
  const [candidates, setCandidates] = React.useState(3);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const start = useStepEvaluationMutation(step, () => mediforce.evaluation.startOptimisation({
    ...step,
    evalRunId: evalRunId === '' ? finished[0]!.id : evalRunId,
    budgetUsd: Number(budget),
    candidates,
  }));
  const optimisations = data.data?.optimisations ?? [];

  return (
    <Section title="Optimisations">
      {mayRun && finished.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">From Eval Run
            <select className={inputClass} value={evalRunId} onChange={(event) => setEvalRunId(event.target.value)}>
              {finished.map((run) => <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {run.createdAt.slice(0, 16).replace('T', ' ')}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Candidates
            <input type="number" min={1} max={3} className={cn(inputClass, 'w-14')} value={candidates} onChange={(event) => setCandidates(Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-1">Budget $
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'w-24')} value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <button
            type="button"
            className={buttonClass}
            disabled={start.isPending || Number(budget) > 0 === false}
            onClick={() => start.mutate(undefined)}
          >Optimise prompt</button>
          {start.error !== null && <span className="text-destructive">{start.error.message}</span>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        GEPA reflects on the dev-case trials of an Eval Run and proposes prompts, which run as challengers over dev and holdout. The job and that run spend at most the budget.
      </p>
      {data.isLoading ? <Loading /> : optimisations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No optimisations yet.</p>
      ) : (
        <ul className="space-y-2">
          {optimisations.map((optimisation) => (
            <li key={optimisation.id} className="text-sm">
              <span className="text-xs text-muted-foreground">
                {optimisation.createdAt.slice(0, 16).replace('T', ' ')} · {optimisation.status} · budget ${optimisation.budgetUsd} · {optimisation.candidates.length} candidate(s)
              </span>
              <OptimisationRow
                optimisationId={optimisation.id}
                open={openId === optimisation.id}
                onOpen={() => setOpenId(openId === optimisation.id ? null : optimisation.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
