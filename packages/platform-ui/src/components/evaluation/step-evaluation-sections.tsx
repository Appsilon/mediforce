'use client';

import * as React from 'react';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import {
  CHAMPION_VARIANT_ID,
  EvalCaseInputPartSchema,
  EvaluatorKindSchema,
  EvaluatorSeveritySchema,
  McpEvalServerPolicySchema,
  describeAcceptanceCriteria,
  describeMcpPolicy,
  type AcceptanceCriteria,
  type AgentOutputSchema,
  type BuiltinCheckName,
  type EvalCaseInputPart,
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
import { useEvalRun, useOptimisation, useStepEvaluation, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
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

function EvaluatorRow({ step, evaluator, mayEdit, stepOutputSchema }: {
  step: EvaluatedStep;
  evaluator: EvaluatorView;
  mayEdit: boolean;
  stepOutputSchema: AgentOutputSchema | undefined;
}) {
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
export function EvaluatorsSection({ step, data, mayEdit, stepOutputSchema }: {
  step: EvaluatedStep;
  data: StepEvaluation['evaluators'];
  mayEdit: boolean;
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
        <ul className="space-y-2">{evaluators.map((evaluator) => <EvaluatorRow key={evaluator.id} step={step} evaluator={evaluator} mayEdit={mayEdit} stepOutputSchema={stepOutputSchema} />)}</ul>
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
  const runs = evaluation.agentRuns.data?.runs ?? [];
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

  return (
    <details className="text-sm" data-testid="builtin-case-suites">
      <summary className="cursor-pointer text-xs text-muted-foreground">Built-in case suites</summary>
      <div className="mt-2 space-y-2 text-xs">
        <p className="text-muted-foreground">
          The platform writes these cases for you from one production run: it changes one field of that run&apos;s input and expects the output the run gave. A built-in Evaluator grades each suite.
        </p>
        <label className="flex items-center gap-1">Suite
          <select aria-label="Suite" className={inputClass} value={suite} onChange={(event) => setSuite(RedTeamSuiteSchema.parse(event.target.value))}>
            {RED_TEAM_SUITES.map((name) => <option key={name} value={name}>{RED_TEAM_SUITE_INFO[name].label}</option>)}
          </select>
        </label>
        <p className="text-muted-foreground">{info.description}</p>
        <p className={graded ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'} data-testid="builtin-suite-grader">
          Graded by the built-in &ldquo;{BUILTIN_CHECKS[info.grader].label}&rdquo; Evaluator{graded ? '.' : ' — this step has none yet: add it under Evaluators to grade these cases.'}
        </p>
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

/** Eval Cases, harvested from production runs or written by the assistant, and frozen Dataset versions. */
export function CasesSection({ step, evaluation, mayEdit }: { step: EvaluatedStep; evaluation: StepEvaluation; mayEdit: boolean }) {
  const harvest = useStepEvaluationMutation(step, (input: { agentRunId: string; expectation: 'positive' | 'negative' }) =>
    mediforce.evaluation.createCaseFromAgentRun(input));
  const freeze = useStepEvaluationMutation(step, () => mediforce.evaluation.freezeDataset(step));
  const cases = evaluation.cases.data?.cases ?? [];
  const harvested = new Set(cases.filter((evalCase) => evalCase.source === 'production').map((evalCase) => evalCase.sourceAgentRunId));
  const runs = (evaluation.agentRuns.data?.runs ?? []).filter((run) => !harvested.has(run.id));
  const [latest] = evaluation.datasets.data?.datasets ?? [];

  return (
    <Section
      title="Eval Cases"
      action={mayEdit && cases.length > 0 && (
        <button type="button" className={buttonClass} disabled={freeze.isPending} onClick={() => freeze.mutate(undefined)}>Freeze dataset</button>
      )}
    >
      {evaluation.cases.isLoading ? <Loading /> : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases yet. Add production runs below, or ask the assistant.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {cases.map((evalCase) => (
            <li key={evalCase.id} className="flex items-center gap-2">
              <span className={cn('rounded px-1.5 text-[11px]', evalCase.expectation === 'positive' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>{evalCase.expectation}</span>
              <span className="truncate">{evalCase.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{evalCase.split} · {evalCase.source}{evalCase.perturbation === null ? '' : ` (${evalCase.perturbation.kind.replace(/_/g, ' ')})`}{evalCase.origin === 'assistant' ? ' · from the assistant' : ''}</span>
            </li>
          ))}
        </ul>
      )}
      {latest !== undefined && (
        <p className="text-xs text-muted-foreground">Dataset v{latest.version} frozen with {latest.caseIds.length} case(s){latest.containsProductionData ? ' — contains production data' : ''}.</p>
      )}
      {mayEdit && runs.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">Recent production runs ({runs.length})</summary>
          <ul className="mt-2 space-y-1">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{run.id.slice(0, 8)}</span>
                <span className="text-muted-foreground">{run.status} · {run.startedAt.slice(0, 16).replace('T', ' ')}</span>
                <span className="ml-auto flex gap-1">
                  <button type="button" className={buttonClass} onClick={() => harvest.mutate({ agentRunId: run.id, expectation: 'positive' })}>Add as good</button>
                  <button type="button" className={buttonClass} onClick={() => harvest.mutate({ agentRunId: run.id, expectation: 'negative' })}>Add as bad</button>
                </span>
              </li>
            ))}
          </ul>
          {harvest.error !== null && <p className="mt-1 text-xs text-destructive">{harvest.error.message}</p>}
        </details>
      )}
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
export function EvalRunsSection({ step, data, mayRun, runReason, mayEdit, editReason }: {
  step: EvaluatedStep;
  data: StepEvaluation['runs'];
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
                {run.createdAt.slice(0, 16).replace('T', ' ')} · {run.status} · ${run.spentUsd.toFixed(2)} of ${run.budgetUsd}
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
