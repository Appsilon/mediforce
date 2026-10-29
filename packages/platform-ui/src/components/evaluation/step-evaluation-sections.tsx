'use client';

import * as React from 'react';
import { z } from 'zod';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Bot, ChevronRight, Info, Loader2, X } from 'lucide-react';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  EvalCaseComparisonSchema,
  EvalCaseExpectationSchema,
  EvalCaseInputSchema,
  EvalCaseLabelSchema,
  EvalCaseSplitSchema,
  EvaluatorKindSchema,
  describeAcceptanceCriteria,
  describeMcpPolicy,
  type AcceptanceCriteria,
  type AgentOutputSchema,
  type AgentRun,
  type EvalCase,
  type EvalCaseComparison,
  type EvalCaseExpectation,
  type EvalCaseInput,
  type EvalDatasetVersion,
  type EvaluationSubject,
  type EvaluatorCheck,
  type StepFingerprintComponent,
} from '@mediforce/platform-core';
import {
  type AddEvaluatorVersionInput,
  type EvaluatorView,
  type PreparedEvalRun,
  type GetStepQualificationOutput,
  type StepValidation,
} from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { AgentRunLog } from '@/components/agents/agent-log-panel';
import { useAgentRun } from '@/hooks/use-agent-runs';
import { useAgentEvalPolicy, useAgentRunIo, useEvalRunEstimate, useStepEvaluation, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { usePinnedDefaultModel } from '@/hooks/use-model-registry';
import { formatCostUsd } from '@/lib/format';
import { routes } from '@/lib/routes';
import { evalRunHref } from '@/lib/evaluation-subject';
import { AcceptanceBadge, EvalRunStatusBadge } from './eval-run-badges';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';
import { OnErrorChoice, mayEscalate } from './evaluator-outages';
import { VALIDATION_STATUS } from './validation-status';
import { VERDICT_CLASSES } from './eval-run-report';
import { FieldError, describeIssues, invalidClass, parseJson } from './field-errors';
import {
  CHECK_KINDS,
  CheckDetails,
  CheckEditor,
  checkFromDraft,
  draftFromCheck,
  type CheckField,
  emptyCheckDraft,
  type CheckDraft,
} from './evaluator-check-editor';

type StepEvaluation = ReturnType<typeof useStepEvaluation>;

/** One tab of the Evaluation: the tab names it, so its heading is for screen readers only. */
function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="sr-only">{title}</h3>
      {action && <div className="flex justify-end gap-2">{action}</div>}
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

/** Typing "Grades match CTCAE" gives "grades-match-ctcae" — the only form an Evaluator name takes. */
export function toEvaluatorName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 63);
}

/** The one schema check a step has needs no name or description of its own. */
const OUTPUT_SCHEMA_NAME = 'output-schema';
const OUTPUT_SCHEMA_RULE = 'The output matches the JSON Schema.';

function EvaluatorRow({ step, evaluator, mayEdit, editReason, stepOutputSchema }: {
  step: EvaluationSubject;
  evaluator: EvaluatorView;
  mayEdit: boolean;
  editReason: string | undefined;
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
  const saveVersion = (values: { rule: string; check: EvaluatorCheck }) => {
    const changes = {
      ...(values.rule.trim() === evaluator.latest.rule ? {} : { rule: values.rule }),
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
            <span className="ml-1.5 text-xs text-muted-foreground">
              v{evaluator.latest.version} · {CHECK_KINDS[check.kind].label}
              {check.kind === 'llm_judge' && ` · min confidence ${check.minConfidence}`}
              {check.kind === 'expected_output' && ` · agreement ≥ ${check.minAgreement} positive, ≤ ${check.maxAgreement} negative`}
              {evaluator.latest.origin === 'assistant' ? ' · from the assistant' : ''}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{evaluator.latest.rule}</p>
          <span className={cn(
            'mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium',
            evaluator.trust.trusted ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
          )}>{evaluator.trust.trusted ? 'Counts' : `Not counted — ${evaluator.trust.reason}`}</span>
          {step.kind === 'agent' ? (
            <p className="mt-1.5 text-xs text-muted-foreground">Checks this agent&apos;s Eval Runs; production runs belong to the workflow steps that use it.</p>
          ) : check.kind === 'expected_output' ? (
            <p className="mt-1.5 text-xs text-muted-foreground">Only checks cases that have an expected output; never runs in production.</p>
          ) : <>
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
          {mayEscalate(evaluator) && <div className="mt-1"><OnErrorChoice step={step} evaluator={evaluator} mayEdit={mayEdit} editReason={editReason} /></div>}
          </>}
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
          </p>
          <EvaluatorForm
            initial={{ name: evaluator.name, rule: evaluator.latest.rule, draft: draftFromCheck(check) }}
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
  draft: CheckDraft;
}

interface EvaluatorFormProblems {
  name?: string;
  rule?: string;
  check?: { error: string; field?: CheckField };
}

/**
 * Name, the kind of check and its fields. The kind comes from the dropdown,
 * never typed. What blocks a save is said under its field until it is edited.
 */
function EvaluatorForm({ initial, editing = false, schemaTaken = false, stepOutputSchema, submitLabel, pending, error, onSubmit, onCancel }: {
  initial: EvaluatorFormValues;
  /**
   * Editing an existing Evaluator: its name and type stay. The name is its
   * stable handle, and its Scores, drift and production series are one kind of check.
   */
  editing?: boolean;
  /** The step already has its output schema check: another cannot be added. */
  schemaTaken?: boolean;
  stepOutputSchema: AgentOutputSchema | undefined;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: { name: string; rule: string; check: EvaluatorCheck }) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = React.useState(initial);
  const [problems, setProblems] = React.useState<EvaluatorFormProblems>({});
  const isSchema = values.draft.kind === 'schema';
  const judgeModel = usePinnedDefaultModel();
  const edit = (changes: Partial<EvaluatorFormValues>, cleared: keyof EvaluatorFormProblems) => {
    setValues((current) => ({ ...current, ...changes }));
    setProblems((current) => ({ ...current, [cleared]: undefined }));
  };
  const submit = () => {
    const name = isSchema ? (editing ? initial.name : OUTPUT_SCHEMA_NAME) : values.name.replace(/-+$/, '');
    const rule = isSchema ? (editing ? initial.rule : OUTPUT_SCHEMA_RULE) : values.rule;
    const result = checkFromDraft(values.draft);
    const found: EvaluatorFormProblems = {
      name: name === '' ? 'Give the evaluator a name.' : undefined,
      rule: rule.trim() === '' ? 'Say in one sentence what it checks.' : undefined,
      check: 'error' in result ? result : undefined,
    };
    setProblems(found);
    if ('error' in result || found.name !== undefined || found.rule !== undefined) return;
    onSubmit({ name, rule, check: result.check });
  };
  const checkProblem = problems.check;
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3" data-testid="evaluator-form">
      <div className="flex gap-2">
        {isSchema ? (
          <span className="flex-1 self-center text-sm font-medium">{editing ? initial.name : OUTPUT_SCHEMA_NAME}</span>
        ) : (
          <input
            aria-label="Evaluator name"
            aria-invalid={problems.name !== undefined}
            className={cn(inputClass, 'flex-1', problems.name !== undefined && invalidClass)}
            placeholder="Name, e.g. grades-match-ctcae"
            title="Also names the Scores it writes: lowercase letters, digits and dashes."
            value={values.name}
            disabled={editing}
            onChange={(event) => edit({ name: toEvaluatorName(event.target.value) }, 'name')}
          />
        )}
        <select
          aria-label="Type"
          className={inputClass}
          value={values.draft.kind}
          disabled={editing}
          onChange={(event) => {
            const kind = EvaluatorKindSchema.parse(event.target.value);
            edit({ draft: emptyCheckDraft(kind, stepOutputSchema, judgeModel) }, 'check');
          }}
        >
          {EvaluatorKindSchema.options.map((kind) => (
            <option key={kind} value={kind} disabled={kind === 'schema' && schemaTaken && editing === false}>{CHECK_KINDS[kind].label}</option>
          ))}
        </select>
      </div>
      <FieldError message={problems.name} testId="evaluator-name-error" />
      <p className="text-xs text-muted-foreground">{CHECK_KINDS[values.draft.kind].description}</p>
      {isSchema === false && (
        <>
          <input
            aria-label="Rule"
            aria-invalid={problems.rule !== undefined}
            className={cn(inputClass, 'w-full', problems.rule !== undefined && invalidClass)}
            placeholder="What it checks, e.g. every adverse event has a CTCAE grade"
            value={values.rule}
            onChange={(event) => edit({ rule: event.target.value }, 'rule')}
          />
          <FieldError message={problems.rule} testId="evaluator-rule-error" />
        </>
      )}
      <CheckEditor
        draft={values.draft}
        onChange={(draft) => edit({ draft }, 'check')}
        stepOutputSchema={stepOutputSchema}
        error={checkProblem?.field === undefined ? null : { field: checkProblem.field, message: checkProblem.error }}
      />
      <FieldError message={checkProblem !== undefined && checkProblem.field === undefined ? checkProblem.error : undefined} />
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={primaryButtonClass} disabled={pending} onClick={submit}>{submitLabel}</button>
        <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** The Step's Evaluators with whether each counts (D9); code source is approved here, by a person. */
export function EvaluatorsSection({ step, data, mayEdit, editReason, stepOutputSchema }: {
  step: EvaluationSubject;
  data: StepEvaluation['evaluators'];
  mayEdit: boolean;
  editReason?: string;
  /** The step's `agent.outputSchema`, offered as the start of a schema check. */
  stepOutputSchema?: AgentOutputSchema;
}) {
  const [adding, setAdding] = React.useState(false);
  const create = useStepEvaluationMutation(step, (values: { name: string; rule: string; check: EvaluatorCheck }) =>
    mediforce.evaluation.createEvaluator({ ...step, ...values }));

  const evaluators = data.data?.evaluators ?? [];
  const schemaTaken = evaluators.some((evaluator) => evaluator.latest.check.kind === 'schema');
  return (
    <Section title="Evaluators" action={mayEdit && !adding && <button type="button" className={buttonClass} onClick={() => setAdding(true)}>Add</button>}>
      {data.isLoading ? <Loading /> : evaluators.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No Evaluators yet. Ask the assistant what to check, or add one.</p>
      ) : (
        <ul className="space-y-2">{evaluators.map((evaluator) => <EvaluatorRow key={evaluator.id} step={step} evaluator={evaluator} mayEdit={mayEdit} editReason={editReason} stepOutputSchema={stepOutputSchema} />)}</ul>
      )}
      {adding && (
        <EvaluatorForm
          initial={{ name: '', rule: '', draft: emptyCheckDraft(schemaTaken ? 'code' : 'schema', stepOutputSchema) }}
          schemaTaken={schemaTaken}
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

interface CaseFormValues {
  name: string;
  split: EvalCase['split'];
  /** The case input as JSON text: triggerPayload, previousStepOutputs and optionally previousRun. */
  input: string;
  /** The expected output as JSON text; empty for none. */
  expectedOutput: string;
  expectation: EvalCaseExpectation;
  comparison: EvalCaseComparison;
  agreementInstructions: string;
  /** Null: every Evaluator of the step grades the case. */
  evaluatorIds: string[] | null;
}

export interface CaseFormResult {
  name: string;
  split: EvalCase['split'];
  input: EvalCaseInput;
  expectedOutput: unknown;
  expectation: EvalCaseExpectation;
  comparison: EvalCaseComparison;
  agreementInstructions: string | null;
  evaluatorIds: string[] | null;
}

export function caseFormValues(evalCase: EvalCase): CaseFormValues {
  return {
    name: evalCase.name,
    split: evalCase.split,
    input: JSON.stringify(evalCase.input, null, 2),
    expectedOutput: evalCase.expectedOutput === null ? '' : JSON.stringify(evalCase.expectedOutput, null, 2),
    expectation: evalCase.expectation,
    comparison: evalCase.comparison,
    agreementInstructions: evalCase.agreementInstructions ?? '',
    evaluatorIds: evalCase.evaluatorIds,
  };
}

/** The input text as a case input, or why it is not one. */
export function parseCaseInput(text: string): { input: EvalCaseInput } | { error: string } {
  const parsed = parseJson(text);
  if ('error' in parsed) return parsed;
  const checked = EvalCaseInputSchema.safeParse(parsed.value);
  if (checked.success === false) return { error: describeIssues(checked.error.issues, parsed.value) };
  return { input: checked.data };
}

/** The expected output text as JSON — null when left empty — or why it is not JSON. */
export function parseExpectedOutput(text: string): { expectedOutput: unknown } | { error: string } {
  if (text.trim() === '') return { expectedOutput: null };
  const parsed = parseJson(text);
  return 'error' in parsed ? parsed : { expectedOutput: parsed.value };
}

/** Which Evaluators grade a case: every one of the step's, or only those ticked. */
function EvaluatorSelection({ evaluators, value, onChange }: {
  evaluators: readonly EvaluatorView[];
  value: string[] | null;
  onChange: (evaluatorIds: string[] | null) => void;
}) {
  const chosen = new Set(value ?? []);
  return (
    <fieldset className="space-y-1" data-testid="case-evaluators">
      <legend className="font-medium">Checked by</legend>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" checked={value === null} onChange={() => onChange(null)} />
          All evaluators
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={value !== null} disabled={evaluators.length === 0} onChange={() => onChange(evaluators.map((evaluator) => evaluator.id))} />
          Only these
        </label>
      </div>
      {value !== null && (
        <ul className="ml-4 space-y-0.5">
          {evaluators.map((evaluator) => (
            <li key={evaluator.id}>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`Checked by ${evaluator.name}`}
                  checked={chosen.has(evaluator.id)}
                  onChange={(event) => onChange(event.target.checked
                    ? evaluators.filter((candidate) => candidate.id === evaluator.id || chosen.has(candidate.id)).map((candidate) => candidate.id)
                    : value.filter((evaluatorId) => evaluatorId !== evaluator.id))}
                />
                {evaluator.name} <span className="text-muted-foreground">({CHECK_KINDS[evaluator.latest.check.kind].label})</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {value !== null && value.length === 0 && <p className="text-destructive">Tick at least one evaluator.</p>}
    </fieldset>
  );
}

/** Says what is missing for a case's expected output to be compared at all. */
function ExpectedOutputCheckHint({ evaluators, evaluatorIds }: { evaluators: readonly EvaluatorView[]; evaluatorIds: string[] | null }) {
  const checks = evaluators.filter((evaluator) => evaluator.latest.check.kind === 'expected_output');
  if (checks.length === 0) {
    return <p className="text-amber-700 dark:text-amber-300">Nothing compares this yet — add an Expected output evaluator.</p>;
  }
  if (evaluatorIds !== null && checks.every((evaluator) => evaluatorIds.includes(evaluator.id) === false)) {
    return <p className="text-amber-700 dark:text-amber-300">Nothing compares this — tick an Expected output evaluator under Checked by.</p>;
  }
  return null;
}

/** A run's output as expected-output text: empty when it returned nothing. */
function outputText(result: unknown): string {
  return result === null || result === undefined ? '' : JSON.stringify(result, null, 2);
}

/** Whether JSON text holds this value, formatting aside; empty text holds nothing. */
function holdsJson(text: string, value: unknown): boolean {
  if (text.trim() === '') return value === null || value === undefined;
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value ?? null);
  } catch {
    return false;
  }
}

/** Says whether a field still holds what the source run had, and puts the run's value back once it does not. */
function SourceRunMark({ asRun, restoreLabel, testId, onRestore }: { asRun: boolean; restoreLabel: string; testId: string; onRestore: () => void }) {
  return asRun ? (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" data-testid={testId}>As the source run</span>
  ) : (
    <span className="flex items-center gap-1.5">
      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid={testId}>Edited</span>
      <button type="button" className={buttonClass} onClick={onRestore}>{restoreLabel}</button>
    </span>
  );
}

/** The log of the run a case comes from, fetched the first time it is opened. */
function SourceRunLog({ agentRunId }: { agentRunId: string }) {
  const [open, setOpen] = React.useState(false);
  const { data: run, loading } = useAgentRun(open ? agentRunId : null);
  return (
    <details className="rounded border" data-testid="source-run-log" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer px-2 py-1 font-medium">
        Source run log <span className="font-mono font-normal text-muted-foreground">{agentRunId.slice(0, 8)}</span>
      </summary>
      {open && (
        <div className="flex h-96 flex-col overflow-hidden border-t p-2">
          {loading ? <p className="text-muted-foreground">Loading…</p> : run === null ? <p className="text-muted-foreground">The run could not be loaded.</p> : <AgentRunLog run={run} />}
        </div>
      )}
    </details>
  );
}

interface FieldErrors {
  name?: string;
  input?: string;
  expectedOutput?: string;
}

/**
 * Name, the input the step is given beside the output expected of it, how
 * that output is compared once there is one, and which Evaluators grade it.
 * What blocks a save is said under the field it is about, until that field is
 * edited. A case from a run marks each side edited or as the run had it, and
 * opens the run's log.
 */
function CaseForm({ initial, inputHelp, evaluators, sourceAgentRunId, submitLabel, pending, error, onSubmit, onCancel }: {
  initial: CaseFormValues;
  inputHelp: React.ReactNode;
  evaluators: readonly EvaluatorView[];
  /** The production run the case comes from, whose input and output it can be compared with and reset to. */
  sourceAgentRunId: string | null;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onSubmit: (values: CaseFormResult) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = React.useState(initial);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const sourceRun = useAgentRunIo(sourceAgentRunId).data;
  const hasExpectedOutput = values.expectedOutput.trim() !== '';
  const outputAsRun = sourceRun !== undefined && holdsJson(values.expectedOutput, sourceRun.result);
  const edit = (field: keyof FieldErrors, changes: Partial<CaseFormValues>) => {
    setValues((current) => ({ ...current, ...changes }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };
  const submit = () => {
    const parsed = parseCaseInput(values.input);
    const expected = parseExpectedOutput(values.expectedOutput);
    const problems: FieldErrors = {
      name: values.name.trim() === '' ? 'Give the case a name.' : undefined,
      input: 'error' in parsed ? parsed.error : undefined,
      expectedOutput: 'error' in expected ? expected.error : undefined,
    };
    setFieldErrors(problems);
    if ('error' in parsed || 'error' in expected || problems.name !== undefined) return;
    const agreementInstructions = values.agreementInstructions.trim();
    onSubmit({
      name: values.name.trim(),
      split: values.split,
      input: parsed.input,
      expectedOutput: expected.expectedOutput,
      expectation: values.expectation,
      comparison: values.comparison,
      agreementInstructions: agreementInstructions === '' ? null : agreementInstructions,
      evaluatorIds: values.evaluatorIds,
    });
  };
  return (
    <div className="space-y-3 text-xs" data-testid="case-form">
      <div className="space-y-1">
        <input
          aria-label="Case name"
          aria-invalid={fieldErrors.name !== undefined}
          className={cn(inputClass, 'w-full', fieldErrors.name !== undefined && invalidClass)}
          placeholder="Name, e.g. Fatal sepsis graded 4"
          value={values.name}
          onChange={(event) => edit('name', { name: event.target.value })}
        />
        <FieldError message={fieldErrors.name} testId="case-name-error" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <span className="font-medium">Input</span>
            {sourceRun !== undefined && (
              <SourceRunMark
                asRun={holdsJson(values.input, sourceRun.caseInput)}
                restoreLabel="Use the source run's input"
                testId="case-input-mark"
                onRestore={() => edit('input', { input: JSON.stringify(sourceRun.caseInput, null, 2) })}
              />
            )}
          </div>
          <div className="text-muted-foreground">{inputHelp}</div>
          <textarea
            aria-label="Case input"
            aria-invalid={fieldErrors.input !== undefined}
            className={cn(inputClass, 'w-full min-h-48 font-mono text-xs', fieldErrors.input !== undefined && invalidClass)}
            spellCheck={false}
            value={values.input}
            onChange={(event) => edit('input', { input: event.target.value })}
          />
          <FieldError message={fieldErrors.input} testId="case-input-error" />
        </div>
        <div className="space-y-1">
          <div className="flex min-h-6 items-center justify-between gap-2">
            <span className="font-medium">Expected output <span className="font-normal text-muted-foreground">(optional)</span></span>
            {sourceRun !== undefined && (
              <SourceRunMark
                asRun={outputAsRun}
                restoreLabel="Use the source run's output"
                testId="case-output-mark"
                onRestore={() => edit('expectedOutput', { expectedOutput: outputText(sourceRun.result) })}
              />
            )}
          </div>
          <div className="text-muted-foreground">What the step should return. Leave empty to rely on the evaluators alone.</div>
          <textarea
            aria-label="Expected output"
            aria-invalid={fieldErrors.expectedOutput !== undefined}
            className={cn(inputClass, 'w-full min-h-48 font-mono text-xs', fieldErrors.expectedOutput !== undefined && invalidClass)}
            spellCheck={false}
            placeholder={'{ "findings": [{ "term": "Sepsis", "grade": 5 }] }'}
            value={values.expectedOutput}
            onChange={(event) => edit('expectedOutput', { expectedOutput: event.target.value })}
          />
          <FieldError message={fieldErrors.expectedOutput} testId="case-expected-output-error" />
          {outputAsRun && hasExpectedOutput && sourceRun.verdictExpectation === null && (
            <p className="text-amber-700 dark:text-amber-300">Nobody reviewed this run — check its output before keeping it.</p>
          )}
        </div>
      </div>
      {sourceAgentRunId !== null && <SourceRunLog agentRunId={sourceAgentRunId} />}
      {hasExpectedOutput && (
        <div className="space-y-2 rounded border bg-background/60 p-2" data-testid="case-comparison">
          <div className="flex flex-wrap items-center gap-1.5">
            The output must
            <select
              aria-label="Expectation"
              className={inputClass}
              value={values.expectation}
              onChange={(event) => setValues({ ...values, expectation: EvalCaseExpectationSchema.parse(event.target.value) })}
            >
              <option value="positive">match it</option>
              <option value="negative">not match it</option>
            </select>
            , compared
            <select
              aria-label="Comparison"
              className={inputClass}
              value={values.comparison}
              onChange={(event) => setValues({ ...values, comparison: EvalCaseComparisonSchema.parse(event.target.value) })}
            >
              <option value="exact">exactly</option>
              <option value="agreement">by meaning (a model scores 0–1)</option>
            </select>
          </div>
          {values.comparison === 'agreement' && (
            <textarea
              aria-label="Agreement instructions"
              className={cn(inputClass, 'w-full min-h-16')}
              placeholder="Optional: what matters here, e.g. narrative wording is trivial; a changed grade is not."
              value={values.agreementInstructions}
              onChange={(event) => setValues({ ...values, agreementInstructions: event.target.value })}
            />
          )}
          <ExpectedOutputCheckHint evaluators={evaluators} evaluatorIds={values.evaluatorIds} />
        </div>
      )}
      <EvaluatorSelection evaluators={evaluators} value={values.evaluatorIds} onChange={(evaluatorIds) => setValues({ ...values, evaluatorIds })} />
      {error !== null && <p className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={values.evaluatorIds?.length === 0 || pending}
          onClick={submit}
        >{submitLabel}</button>
      </div>
    </div>
  );
}

/** A wide dialog holding a case form. */
function CaseDialog({ title, description, onClose, children }: { title: string; description: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (open === false) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg" data-testid="case-dialog">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded-sm p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The fields of a case form that differ from the case. */
export function caseChanges(evalCase: EvalCase, values: CaseFormResult): Partial<CaseFormResult> {
  return Object.fromEntries((Object.keys(values) as Array<keyof CaseFormResult>)
    .filter((field) => JSON.stringify(values[field]) !== JSON.stringify(evalCase[field]))
    .map((field) => [field, values[field]]));
}

/** What a case expects of the output: the expected output, and how it is compared. */
function CaseExpects({ evalCase }: { evalCase: EvalCase }) {
  return (
    <div className="min-w-0" data-testid="eval-case-expected-output">
      <div className="text-muted-foreground">Expected output</div>
      {evalCase.expectedOutput === null ? (
        <p className="mt-0.5">None — only the evaluators check it.</p>
      ) : (
        <>
          <p className="mt-0.5">
            The output must {evalCase.expectation === 'positive' ? 'match' : 'not match'} this, {evalCase.comparison === 'exact' ? 'exactly' : 'by meaning'}
          </p>
          <pre className="mt-0.5 max-h-60 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap">{JSON.stringify(evalCase.expectedOutput, null, 2)}</pre>
          {evalCase.comparison === 'agreement' && evalCase.agreementInstructions !== null && (
            <p><span className="text-muted-foreground">On this case:</span> {evalCase.agreementInstructions}</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Whether a case made from a production run still gives the step what the run
 * was given and expects what it returned — the same comparison the case form
 * marks. A synthesized case is a change by definition, and says so in its source.
 */
function CaseRunMark({ evalCase }: { evalCase: EvalCase }) {
  const fromRun = evalCase.sourceAgentRunId !== null && evalCase.source !== 'synthesized';
  const sourceRun = useAgentRunIo(fromRun ? evalCase.sourceAgentRunId : null).data;
  if (fromRun === false || sourceRun === undefined) return null;
  const changes = [
    ...(JSON.stringify(evalCase.input) === JSON.stringify(sourceRun.caseInput) ? [] : ['its input differs from what the source run was given']),
    ...(JSON.stringify(evalCase.expectedOutput ?? null) === JSON.stringify(sourceRun.result ?? null) ? [] : ['its expected output differs from what the source run returned']),
  ];
  return changes.length === 0 ? (
    <InstantTooltip label="Gives the step what the source run was given, and expects what it returned.">
      <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground" data-testid="eval-case-run-mark">from run</span>
    </InstantTooltip>
  ) : (
    <InstantTooltip label={`Edited: ${changes.join('; ')}.`}>
      <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="eval-case-run-mark">edited from run</span>
    </InstantTooltip>
  );
}

/** Whether a case expects an output that matches its expected output, or one that does not. */
function CaseExpectationMark({ evalCase }: { evalCase: EvalCase }) {
  if (evalCase.expectedOutput === null) return null;
  return evalCase.expectation === 'positive' ? (
    <InstantTooltip label="The output must match the expected output.">
      <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 text-[11px] text-emerald-700 dark:text-emerald-300" data-testid="eval-case-expectation">positive</span>
    </InstantTooltip>
  ) : (
    <InstantTooltip label="The output must not match the expected output.">
      <span className="shrink-0 rounded bg-red-500/10 px-1.5 text-[11px] text-red-700 dark:text-red-300" data-testid="eval-case-expectation">negative</span>
    </InstantTooltip>
  );
}

/** One Eval Case: what it expects, which Evaluators grade it, editing and removing it, and in its details what it gives the step and expects. */
function CaseRow({ step, evalCase, evaluators, mayEdit, unsaved, selected, onSelect }: {
  step: EvaluationSubject;
  evalCase: EvalCase;
  evaluators: readonly EvaluatorView[];
  mayEdit: boolean;
  /** Not in the newest Dataset version, so the next Eval Run does not run it. */
  unsaved: boolean;
  selected: boolean;
  onSelect: (selected: boolean) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const edit = useStepEvaluationMutation(step, (values: CaseFormResult) =>
    mediforce.evaluation.updateCase({ caseId: evalCase.id, ...caseChanges(evalCase, values) }));
  const remove = useStepEvaluationMutation(step, () => mediforce.evaluation.archiveCase({ caseId: evalCase.id, archived: true }));
  const closeEdit = () => {
    setEditing(false);
    edit.reset();
  };
  const checkedBy = evalCase.evaluatorIds === null
    ? 'all evaluators'
    : evalCase.evaluatorIds.map((evaluatorId) => evaluators.find((evaluator) => evaluator.id === evaluatorId)?.name ?? evaluatorId.slice(0, 8)).join(', ');
  return (
    <li className="border-t pt-1.5 first:border-t-0 first:pt-0" data-testid="eval-case-row">
      <div className="flex items-center gap-2">
        {mayEdit && <input type="checkbox" aria-label={`Select ${evalCase.name}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} />}
        <span className="truncate">{evalCase.name}</span>
        <CaseRunMark evalCase={evalCase} />
        <CaseExpectationMark evalCase={evalCase} />
        {evalCase.perturbation !== null && (
          <InstantTooltip label={evalCase.perturbation.description}>
            <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground" data-testid="eval-case-perturbation">{evalCase.perturbation.kind.replace(/_/g, ' ')}</span>
          </InstantTooltip>
        )}
        {evalCase.origin === 'assistant' && (
          <InstantTooltip label="Added by the assistant.">
            <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Added by the assistant" />
          </InstantTooltip>
        )}
        {unsaved && (
          <InstantTooltip label="Not in the next Eval Run until you Save.">
            <span className="shrink-0 rounded bg-amber-500/10 px-1.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="eval-case-unsaved">unsaved</span>
          </InstantTooltip>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {evalCase.expectedOutput !== null && (
            <span className="text-xs text-muted-foreground" data-testid="eval-case-comparison">
              {evalCase.comparison === 'exact' ? 'Exact match' : 'By meaning'} ·
            </span>
          )}
          <InstantTooltip label={`Checked by ${checkedBy}.`}>
            <span className="text-xs text-muted-foreground" data-testid="eval-case-evaluators">
              {evalCase.evaluatorIds === null ? 'All evaluators' : `${evalCase.evaluatorIds.length} selected evaluator${evalCase.evaluatorIds.length === 1 ? '' : 's'}`}
            </span>
          </InstantTooltip>
          {mayEdit && <button type="button" className={buttonClass} onClick={() => setEditing(true)}>Edit</button>}
          {mayEdit && <button type="button" className={buttonClass} disabled={remove.isPending} onClick={() => remove.mutate(undefined)}>Remove</button>}
        </span>
      </div>
      {remove.error !== null && <p className="text-xs text-destructive">{remove.error.message}</p>}
      <details className="mt-0.5 text-xs" data-testid="eval-case-details">
        <summary className="cursor-pointer text-muted-foreground">Details</summary>
        <div className="mt-1 space-y-1.5">
          <div className="grid gap-2 md:grid-cols-2">
            <div className="min-w-0">
              <div className="text-muted-foreground">Input</div>
              <pre className="mt-0.5 max-h-60 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap" data-testid="eval-case-input">{JSON.stringify(evalCase.input, null, 2)}</pre>
            </div>
            <CaseExpects evalCase={evalCase} />
          </div>
          <p><span className="text-muted-foreground">Checked by:</span> {checkedBy}</p>
          {evalCase.sourceAgentRunId !== null && <SourceRunLog agentRunId={evalCase.sourceAgentRunId} />}
        </div>
      </details>
      {editing && (
        <CaseDialog
          title={`Edit ${evalCase.name}`}
          description="Earlier Dataset versions keep the original."
          onClose={closeEdit}
        >
          <CaseForm
            initial={caseFormValues(evalCase)}
            inputHelp="What the step receives. Change the values, keep the shape."
            evaluators={evaluators}
            sourceAgentRunId={evalCase.source === 'synthesized' ? null : evalCase.sourceAgentRunId}
            submitLabel="Save"
            pending={edit.isPending}
            error={edit.error?.message ?? null}
            onSubmit={(values) => edit.mutate(values, { onSuccess: closeEdit })}
            onCancel={closeEdit}
          />
        </CaseDialog>
      )}
    </li>
  );
}

const EMPTY_CASE_INPUT: EvalCaseInput = { triggerPayload: {}, previousStepOutputs: {} };
const FROM_FILE = 'file';
const FROM_NOTHING = 'empty';
const runOption = (agentRunId: string) => `run:${agentRunId}`;
const caseOption = (caseId: string) => `case:${caseId}`;

/**
 * A `.json` file: a whole case as `mediforce eval case-add --file` takes it,
 * or only its input. A case's Evaluator ids are not taken: they belong to the
 * step it was written for.
 */
export function caseFromFile(text: string): { values: Partial<CaseFormValues> } | { error: string } {
  const json = parseJson(text);
  if ('error' in json) return { error: `The file: ${json.error}` };
  const parsed = json.value;
  const whole = z.object({
    name: z.string().optional(),
    input: EvalCaseInputSchema,
    expectedOutput: EvalCaseLabelSchema.shape.expectedOutput.optional(),
    expectation: EvalCaseLabelSchema.shape.expectation.optional(),
    comparison: EvalCaseLabelSchema.shape.comparison.optional(),
    agreementInstructions: EvalCaseLabelSchema.shape.agreementInstructions.optional(),
    split: EvalCaseSplitSchema.optional(),
  }).safeParse(parsed);
  if (whole.success) {
    const { input, expectedOutput, agreementInstructions, ...rest } = whole.data;
    return {
      values: {
        ...rest,
        input: JSON.stringify(input, null, 2),
        ...(expectedOutput === undefined || expectedOutput === null ? {} : { expectedOutput: JSON.stringify(expectedOutput, null, 2) }),
        ...(agreementInstructions === undefined || agreementInstructions === null ? {} : { agreementInstructions }),
      },
    };
  }
  const input = EvalCaseInputSchema.safeParse(parsed);
  if (input.success) return { values: { input: JSON.stringify(input.data, null, 2) } };
  return { error: 'The file is neither a case ({ name, input, expectedOutput?, expectation?, comparison?, split? }) nor a case input ({ triggerPayload, previousStepOutputs }).' };
}

/**
 * Adds a case, starting from a production run — its input and output, kept
 * linked to the run — from an existing case's input, so it keeps the shape the
 * step is given, from a `.json` file, or from an empty input.
 */
function AddCase({ step, evaluation, cases, evaluators, onClose }: {
  step: EvaluationSubject;
  evaluation: StepEvaluation;
  cases: readonly EvalCase[];
  evaluators: readonly EvaluatorView[];
  onClose: () => void;
}) {
  const runs = loadedAgentRuns(evaluation);
  const usedRuns = new Set(cases.map((evalCase) => evalCase.sourceAgentRunId));
  const [startFrom, setStartFrom] = React.useState<string>(() => {
    const unused = runs.find((candidate) => usedRuns.has(candidate.id) === false);
    if (unused !== undefined) return runOption(unused.id);
    if (cases[0] !== undefined) return caseOption(cases[0].id);
    return FROM_NOTHING;
  });
  const [fromFile, setFromFile] = React.useState<{ name: string; values: Partial<CaseFormValues> } | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const run = fromFile === null ? runs.find((candidate) => runOption(candidate.id) === startFrom) : undefined;
  const template = fromFile === null ? cases.find((evalCase) => caseOption(evalCase.id) === startFrom) : undefined;
  const runIo = useAgentRunIo(run?.id ?? null);
  const createFromRun = useStepEvaluationMutation(step, ({ agentRunId, values }: { agentRunId: string; values: CaseFormResult }) =>
    mediforce.evaluation.createCaseFromAgentRun({ agentRunId, ...(step.kind === 'step' ? { step } : {}), ...values }));
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

  let form: React.ReactNode;
  if (run !== undefined) {
    form = runIo.data === undefined ? (
      runIo.isError
        ? <p className="text-destructive">{runIo.error instanceof Error ? runIo.error.message : 'The run\'s input and output could not be loaded.'}</p>
        : <p className="text-muted-foreground">Loading the run&apos;s input and output…</p>
    ) : (
      <CaseForm
        key={startFrom}
        initial={{
          name: `From run ${run.id.slice(0, 8)} (${run.startedAt.slice(0, 10)})`,
          split: 'dev',
          input: JSON.stringify(runIo.data.caseInput, null, 2),
          expectedOutput: outputText(runIo.data.result),
          expectation: runIo.data.verdictExpectation ?? 'positive',
          comparison: 'exact',
          agreementInstructions: '',
          evaluatorIds: null,
        }}
        inputHelp="What the step received in this run."
        evaluators={evaluators}
        sourceAgentRunId={run.id}
        submitLabel="Add case"
        pending={createFromRun.isPending}
        error={createFromRun.error?.message ?? null}
        onSubmit={(values) => createFromRun.mutate({ agentRunId: run.id, values }, { onSuccess: onClose })}
        onCancel={onClose}
      />
    );
  } else {
    form = (
      <CaseForm
        key={fromFile === null ? startFrom : `file:${fromFile.name}:${JSON.stringify(fromFile.values)}`}
        initial={{
          name: '',
          split: 'dev',
          input: JSON.stringify(template?.input ?? EMPTY_CASE_INPUT, null, 2),
          expectedOutput: '',
          expectation: 'positive',
          comparison: 'exact',
          agreementInstructions: '',
          evaluatorIds: null,
          ...fromFile?.values,
        }}
        inputHelp="What the step receives: the trigger payload and earlier steps' outputs, by step id."
        evaluators={evaluators}
        sourceAgentRunId={null}
        submitLabel="Add case"
        pending={create.isPending}
        error={create.error?.message ?? null}
        onSubmit={(values) => create.mutate(values, { onSuccess: onClose })}
        onCancel={onClose}
      />
    );
  }

  return (
    <div className="space-y-3 text-xs" data-testid="add-case">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">Start from
          <select
            aria-label="Start from"
            className={cn(inputClass, 'max-w-md')}
            value={fromFile === null ? startFrom : FROM_FILE}
            onChange={(event) => {
              if (event.target.value === FROM_FILE) return;
              setFromFile(null);
              setStartFrom(event.target.value);
            }}
          >
            {fromFile !== null && <option value={FROM_FILE}>{fromFile.name}</option>}
            {runs.length > 0 && (
              <optgroup label="Production runs">
                {runs.map((candidate) => (
                  <option key={candidate.id} value={runOption(candidate.id)}>
                    {candidate.startedAt.slice(0, 16).replace('T', ' ')} · {candidate.status}{candidate.fallbackReason === null ? '' : ` (${candidate.fallbackReason})`} · {candidate.id.slice(0, 8)}{usedRuns.has(candidate.id) ? ' · already a case' : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {cases.length > 0 && (
              <optgroup label="Eval Cases (input only)">
                {cases.map((evalCase) => <option key={evalCase.id} value={caseOption(evalCase.id)}>{evalCase.name}</option>)}
              </optgroup>
            )}
            <option value={FROM_NOTHING}>{cases.length === 0 ? 'An empty input' : 'An empty input (no workspace files)'}</option>
          </select>
        </label>
        {evaluation.agentRuns.hasNextPage && (
          <button
            type="button"
            className={buttonClass}
            disabled={evaluation.agentRuns.isFetchingNextPage}
            onClick={() => void evaluation.agentRuns.fetchNextPage()}
          >{evaluation.agentRuns.isFetchingNextPage ? 'Loading…' : 'Load more runs'}</button>
        )}
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
      {run !== undefined && run.envelope !== null && run.envelope.reasoning_summary !== '' && (
        <p className="line-clamp-2 text-muted-foreground" title={run.envelope.reasoning_summary}>{run.envelope.reasoning_summary}</p>
      )}
      {template?.workspaceSeedCommit != null && (
        <p className="text-muted-foreground">It starts from the same workspace files as &lsquo;{template.name}&rsquo;.</p>
      )}
      {fileError !== null && <p className="text-destructive">{fileError}</p>}
      {form}
    </div>
  );
}

/** How the live cases differ from a Dataset version: cases added or edited since, and cases it has that were archived or replaced. */
export function datasetDrift(cases: readonly EvalCase[], dataset: EvalDatasetVersion | undefined): { unsaved: Set<string>; dropped: number } {
  const saved = new Set(dataset?.caseIds ?? []);
  const live = new Set(cases.map((evalCase) => evalCase.id));
  return {
    unsaved: new Set(cases.filter((evalCase) => !saved.has(evalCase.id)).map((evalCase) => evalCase.id)),
    dropped: [...saved].filter((caseId) => !live.has(caseId)).length,
  };
}

/** Live cases the newest Dataset version does not hold, so Save would make a new version. */
export function hasUnsavedCases(cases: readonly EvalCase[], dataset: EvalDatasetVersion | undefined): boolean {
  const { unsaved, dropped } = datasetDrift(cases, dataset);
  return cases.length > 0 && (dataset === undefined || unsaved.size > 0 || dropped > 0);
}

function pluralCases(count: number): string {
  return `${count} case${count === 1 ? '' : 's'}`;
}

/**
 * Where saving stands: an Eval Run runs the newest saved Dataset version,
 * never the live list, and a version never changes.
 */
function DatasetStatus({ cases, datasets }: { cases: readonly EvalCase[]; datasets: readonly EvalDatasetVersion[] }) {
  const [latest] = datasets;
  if (latest === undefined) return null;
  const { unsaved, dropped } = datasetDrift(cases, latest);
  const saved = <span className="font-medium">Dataset v{latest.version}</span>;
  return (
    <div className="space-y-1 rounded-md bg-muted/40 p-2 text-xs" data-testid="dataset-status">
      {unsaved.size === 0 && dropped === 0 ? (
        <p>All saved — the next Eval Run uses {saved} ({pluralCases(latest.caseIds.length)}).{latest.containsProductionData ? ' Contains production data.' : ''}</p>
      ) : (
        <p className="text-amber-700 dark:text-amber-300">
          Unsaved changes: the next Eval Run still uses {saved} ({pluralCases(latest.caseIds.length)}). Save to include them.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">Versions ({datasets.length})</summary>
        <ul className="mt-1 space-y-0.5 text-muted-foreground" data-testid="dataset-versions">
          {datasets.map((dataset) => (
            <li key={dataset.id}>
              v{dataset.version} · {dataset.createdAt.slice(0, 16).replace('T', ' ')} · {pluralCases(dataset.caseIds.length)} · {dataset.createdBy}{dataset.containsProductionData ? ' · contains production data' : ''}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Sets which Evaluators grade each selected case. Each edit replaces its case,
 * as any case edit does; a case that already has the selection is left alone.
 */
function SetCaseEvaluators({ step, cases, evaluators, onDone }: {
  step: EvaluationSubject;
  cases: readonly EvalCase[];
  evaluators: readonly EvaluatorView[];
  onDone: () => void;
}) {
  const [evaluatorIds, setEvaluatorIds] = React.useState<string[] | null>(null);
  const apply = useStepEvaluationMutation(step, async (chosen: string[] | null) => {
    for (const evalCase of cases) {
      if (JSON.stringify(evalCase.evaluatorIds) === JSON.stringify(chosen)) continue;
      await mediforce.evaluation.updateCase({ caseId: evalCase.id, evaluatorIds: chosen });
    }
  });
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs" data-testid="set-case-evaluators">
      <p className="font-medium">Evaluators for {pluralCases(cases.length)}</p>
      <EvaluatorSelection evaluators={evaluators} value={evaluatorIds} onChange={setEvaluatorIds} />
      {apply.error !== null && <p className="text-destructive">{apply.error.message}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={apply.isPending || evaluatorIds?.length === 0}
          onClick={() => apply.mutate(evaluatorIds, { onSuccess: onDone })}
        >{apply.isPending ? 'Saving…' : 'Apply'}</button>
        <button type="button" className={buttonClass} onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/** Eval Cases, added from production runs, by hand or by the assistant, and the Dataset versions Save snapshots them into. */
export function CasesSection({ step, evaluation, mayEdit }: {
  step: EvaluationSubject;
  evaluation: StepEvaluation;
  mayEdit: boolean;
}) {
  const save = useStepEvaluationMutation(step, () => mediforce.evaluation.saveDataset(step));
  const cases = evaluation.cases.data?.cases ?? [];
  const datasets = evaluation.datasets.data?.datasets ?? [];
  const [latest] = datasets;
  const { unsaved, dropped } = datasetDrift(cases, latest);
  const hasUnsavedChanges = hasUnsavedCases(cases, latest);
  const [adding, setAdding] = React.useState(false);
  const evaluators = evaluation.evaluators.data?.evaluators ?? [];
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const selectedCases = cases.filter((evalCase) => selectedIds.has(evalCase.id));
  const [settingEvaluators, setSettingEvaluators] = React.useState(false);

  return (
    <Section
      title="Eval Cases"
      action={mayEdit && (
        <div className="flex gap-1.5">
          <button type="button" className={buttonClass} onClick={() => setAdding(true)}>Add case</button>
          <InstantTooltip label={hasUnsavedChanges ? `Save as Dataset v${(latest?.version ?? 0) + 1} for the next Eval Run.` : 'No unsaved changes.'}>
            <span className="inline-flex">
              <button type="button" className={primaryButtonClass} disabled={save.isPending || !hasUnsavedChanges} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Saving…' : 'Save'}</button>
            </span>
          </InstantTooltip>
          <InstantTooltip label="Eval Runs use the last saved set of cases (a Dataset). Save after any change.">
            <span className="inline-flex items-center text-muted-foreground" aria-label="What Save does" data-testid="eval-cases-save-help">
              <Info className="h-4 w-4" />
            </span>
          </InstantTooltip>
        </div>
      )}
    >
      <p className="text-xs text-muted-foreground" data-testid="eval-cases-purpose">
        Inputs to re-run the step on, each with the output you expect if you know it.
      </p>
      {adding && (
        <CaseDialog
          title="Add an Eval Case"
          description="Start from a production run, or write an input yourself."
          onClose={() => setAdding(false)}
        >
          <AddCase step={step} evaluation={evaluation} cases={cases} evaluators={evaluators} onClose={() => setAdding(false)} />
        </CaseDialog>
      )}
      {mayEdit && selectedCases.length > 0 && !settingEvaluators && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{selectedCases.length} selected</span>
          <button type="button" className={buttonClass} onClick={() => setSettingEvaluators(true)}>Set evaluators…</button>
          <button type="button" className={buttonClass} onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}
      {settingEvaluators && selectedCases.length > 0 && (
        <SetCaseEvaluators
          step={step}
          cases={selectedCases}
          evaluators={evaluators}
          onDone={() => {
            setSettingEvaluators(false);
            setSelectedIds(new Set());
          }}
        />
      )}
      {evaluation.cases.isLoading ? <Loading /> : cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cases yet. Add one, or ask the assistant.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {cases.map((evalCase) => (
            <CaseRow
              key={evalCase.id}
              step={step}
              evalCase={evalCase}
              evaluators={evaluators}
              mayEdit={mayEdit}
              unsaved={latest !== undefined && unsaved.has(evalCase.id)}
              selected={selectedIds.has(evalCase.id)}
              onSelect={(selected) => setSelectedIds((current) => {
                const next = new Set(current);
                if (selected) next.add(evalCase.id);
                else next.delete(evalCase.id);
                return next;
              })}
            />
          ))}
        </ul>
      )}
      {cases.length > 0 && <DatasetStatus cases={cases} datasets={datasets} />}
      {save.error !== null && <p className="text-xs text-destructive">{save.error.message}</p>}
      {mayEdit && <UnsavedChangesGuard when={hasUnsavedChanges} />}
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
          <span className="font-medium">{evaluator.name}</span> v{evaluator.evaluatorVersion}: mean {evaluator.recentMean?.toFixed(2)} over the last {drift.window} production Scores, down from {evaluator.baselineMean?.toFixed(2)} over the {drift.window} before.
        </p>
      ))}
      <p className="text-muted-foreground">An alert is a drop of at least {drift.threshold}. Look at the recent runs, or ask the assistant to diagnose them.</p>
    </section>
  );
}

function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** The floor every counted Evaluator must reach, in a few words for the status strip. */
function summarizeThreshold(criteria: AcceptanceCriteria): string {
  const passHatK = criteria.minPassHatK === undefined ? '' : `, pass^k ≥ ${percent(criteria.minPassHatK)}`;
  return `Each counted Evaluator ≥ ${percent(criteria.minPassRate)}${passHatK}`;
}

/** The floor every counted Evaluator must reach, in words. */
function describeThreshold(criteria: AcceptanceCriteria): string {
  const passHatK = criteria.minPassHatK === undefined ? '' : ` and pass^k ≥ ${percent(criteria.minPassHatK)}`;
  return `Every counted Evaluator must pass at least ${percent(criteria.minPassRate)} of its graded trials${passHatK}`;
}

/** What the Step's qualification rests on: the Eval Run it was signed from, and what changed since. */
function QualificationDetails({ status }: { status: GetStepQualificationOutput }) {
  const { qualification } = status;
  if (qualification === null) {
    return <p className="text-muted-foreground">Not qualified. Run the step, then confirm or overwrite the verdict in the run&apos;s report. It is informational: nothing is blocked without one.</p>;
  }
  return (
    <div className="space-y-1" data-testid="step-qualification">
      <p>
        Verdict {qualification.decision} by <span className="font-medium">{qualification.signature.signerName}</span> on {qualification.signature.signedAt.slice(0, 16).replace('T', ' ')}
        {' '}— Eval Run <span className="font-mono">{qualification.evalRunId.slice(0, 8)}</span>,
        {' '}fingerprint <span className="font-mono">{qualification.fingerprint.hash.slice(0, 12)}</span>.
      </p>
      <p className="text-muted-foreground">{qualification.signature.meaning} ({qualification.signature.reauthentication === 'password' ? 'password re-entered' : 'signed from the session'})</p>
      <p>Judged against: {describeAcceptanceCriteria(qualification.acceptanceCriteria)}</p>
      <p data-testid="qualification-mcp-policy">{describeMcpPolicy(qualification.mcpPolicy)}</p>
      {qualification.deviations.map((deviation, index) => (
        <p key={index} className="text-amber-700 dark:text-amber-300">Deviation{deviation.severity === undefined ? '' : ` (${deviation.severity})`}: {deviation.justification}</p>
      ))}
      {status.status === 'stale' && (
        <p className="text-red-700 dark:text-red-400" data-testid="qualification-changed">
          The step changed since: {status.changed.map((component) => COMPONENT_LABELS[component]).join(', ')}.
        </p>
      )}
      {status.evaluatorsChanged.length > 0 && (
        <p className="text-muted-foreground" data-testid="qualification-evaluators-changed">Evaluators changed since: {status.evaluatorsChanged.join('; ')}.</p>
      )}
      {status.history.length > 1 && <p className="text-muted-foreground">{status.history.length} qualifications signed for this step.</p>}
    </div>
  );
}

/**
 * A slider for the minimum pass rate every counted Evaluator must reach; a
 * minimum pass^k set by the assistant or the CLI is kept. Nothing is saved
 * until Save, which writes one new criteria version.
 */
function ThresholdDialog({ onClose, criteria, onSave, saving, error }: {
  onClose: () => void;
  criteria: AcceptanceCriteria;
  onSave: (criteria: AcceptanceCriteria) => void;
  saving: boolean;
  error: Error | null;
}) {
  const [draft, setDraft] = React.useState(criteria);
  const unchanged = JSON.stringify(draft) === JSON.stringify(criteria);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (open === false) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg" data-testid="threshold-dialog">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Pass thresholds</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                Every counted Evaluator must pass at least this share of its graded trials: 8 of 10 meets 80%, and 100% means every graded trial passes.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded-sm p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </Dialog.Close>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="minimum-pass-rate">Minimum pass rate</label>
              <span className="font-mono text-xs tabular-nums">≥ {percent(draft.minPassRate)}</span>
            </div>
            <input
              id="minimum-pass-rate"
              type="range"
              min={0}
              max={100}
              step={1}
              className="w-full accent-primary"
              value={Math.round(draft.minPassRate * 100)}
              onChange={(event) => setDraft({ ...draft, minPassRate: Number(event.target.value) / 100 })}
            />
            {draft.minPassHatK !== undefined && <p className="text-xs text-muted-foreground">Also kept: pass^k ≥ {percent(draft.minPassHatK)}.</p>}
          </div>
          {error !== null && <p className="mt-3 text-xs text-destructive">{error.message}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={buttonClass}>Cancel</button>
            </Dialog.Close>
            <button type="button" className={primaryButtonClass} disabled={unchanged || saving} onClick={() => onSave(draft)}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const RUN_VERDICT_WORD = { passed: 'passed', missed: 'missed', not_judged: 'not judged' } as const;
const RUN_VERDICT_CLASS = { passed: VERDICT_CLASSES.met, missed: VERDICT_CLASSES.missed, not_judged: VERDICT_CLASSES.not_evaluable } as const;

/** The validation's reason; for a run waiting for a signature, the word saying how it fared — passed or missed — is coloured. */
function ValidationReason({ validation }: { validation: StepValidation }) {
  const { runVerdict, evalRunId, reason } = validation;
  if (runVerdict === undefined || evalRunId === null) return <>{reason}</>;
  const lead = `Eval Run ${evalRunId.slice(0, 8)} `;
  const word = RUN_VERDICT_WORD[runVerdict];
  if (reason.startsWith(`${lead}${word}`) === false) return <>{reason}</>;
  return (
    <>
      {lead}<span className={cn('rounded px-1.5 py-0.5 font-medium', RUN_VERDICT_CLASS[runVerdict])} data-testid="validation-run-verdict" data-verdict={runVerdict}>{word}</span>{reason.slice(lead.length + word.length)}
    </>
  );
}

/**
 * The Step's status strip: its validation (D10) — the newest finished Eval Run
 * of the workflow version, passed or failed on its Acceptance Criteria, not
 * verified once anything it rested on changed — with the signed Step
 * Qualification, if any, opening from the same status; the Acceptance Criteria
 * every run is judged against, 100% until set and tuned in a dialog; and the
 * Dataset the next Eval Run takes. `action` sits at its end — the tab's own
 * controls, such as showing the assistant.
 */
export function EvaluationStatusStrip({ step, criteria, qualification, datasets, mayEdit, action }: {
  step: EvaluationSubject;
  criteria: StepEvaluation['criteria'];
  qualification: StepEvaluation['qualification'];
  datasets: StepEvaluation['datasets'];
  mayEdit: boolean;
  action?: React.ReactNode;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const save = useStepEvaluationMutation(step, (next: AcceptanceCriteria) => mediforce.evaluation.setAcceptanceCriteria({ ...step, criteria: next }));
  const effective = criteria.data?.criteria?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA;
  const status = qualification.data;
  const validation = status === undefined ? null : VALIDATION_STATUS[status.validation.status];
  const saveThresholds = (next: AcceptanceCriteria) => save.mutate(next, { onSuccess: () => setEditing(false) });
  const [dataset] = datasets.data?.datasets ?? [];
  return (
    <section className="rounded-lg border p-3 space-y-3" data-testid="acceptance-criteria" data-tour="eval-status">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {status === undefined || validation === null ? <Loading /> : (
          <InstantTooltip label="Show the step's qualification">
            <button
              type="button"
              className={cn('inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold', validation.buttonClassName)}
              aria-expanded={showDetails}
              data-testid="validation-status"
              data-status={status.validation.status}
              onClick={() => setShowDetails(!showDetails)}
            >
              <validation.icon className="h-5 w-5" aria-hidden />
              {validation.label}
            </button>
          </InstantTooltip>
        )}
        <div className="text-xs">
          <div className="text-muted-foreground">Acceptance Criteria</div>
          <div className="flex items-center gap-2">
            <InstantTooltip label={`${describeThreshold(effective)}.`}>
              <span className="font-medium" data-testid="acceptance-criteria-summary">{summarizeThreshold(effective)}</span>
            </InstantTooltip>
            <button
              type="button"
              className={buttonClass}
              disabled={mayEdit === false || criteria.isLoading}
              aria-label="Edit Acceptance Criteria"
              data-testid="set-threshold"
              onClick={() => { save.reset(); setEditing(true); }}
            >Edit</button>
          </div>
        </div>
        <div className="text-xs">
          <div className="text-muted-foreground">Dataset</div>
          <div className="font-medium" data-testid="dataset-summary">
            {datasets.isLoading ? '…' : dataset === undefined ? 'Not saved yet' : `v${dataset.version} · ${pluralCases(dataset.caseIds.length)}`}
          </div>
        </div>
        {action !== undefined && <div className="ml-auto flex items-center gap-2">{action}</div>}
      </div>
      {status !== undefined && (
        <p className={cn('text-xs', status.validation.status === 'failed' ? validation?.textClassName : 'text-muted-foreground')} data-testid="validation-reason">
          <ValidationReason validation={status.validation} />{status.validation.runInProgress && ' An Eval Run is running; this updates when it ends.'}
          {status.validation.status === 'awaiting_approval' && status.validation.evalRunId !== null && (
            <Link
              href={evalRunHref(step, status.validation.evalRunId)}
              className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              data-testid="review-eval-run"
            >
              Review the Eval Run <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
          {status.validation.inheritedFromAgent !== undefined && (
            <Link
              href={routes.agentEvaluation(step.namespace, status.validation.inheritedFromAgent.agentId)}
              className="ml-2 inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              data-testid="view-agent-evaluation"
            >
              View agent&apos;s evaluation <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </p>
      )}
      {showDetails && status !== undefined && (
        <div className="space-y-2 rounded-md bg-muted/40 p-2 text-xs">
          <QualificationDetails status={status} />
        </div>
      )}
      {editing && (
        <ThresholdDialog
          key={JSON.stringify(effective)}
          onClose={() => setEditing(false)}
          criteria={effective}
          onSave={saveThresholds}
          saving={save.isPending}
          error={save.error}
        />
      )}
    </section>
  );
}

/** The cap an Eval Run gets when the person sets no budget, as `prepare` sets it. */
type BudgetChoice = { kind: 'set'; budgetUsd: number } | { kind: 'auto'; suggestedUsd: number | null };

/**
 * Asks the person to confirm an Eval Run's budget before it starts (D15): what
 * it is estimated to cost and the cap it spends up to — with a warning when the
 * budget was left on auto.
 */
function StartEvalRunDialog({ trials, estimatedUsd, budget, starting, error, onStart, onClose }: {
  trials: number | null;
  estimatedUsd: number | null;
  budget: BudgetChoice;
  starting: boolean;
  error: Error | null;
  onStart: () => void;
  onClose: () => void;
}) {
  const cannotCap = budget.kind === 'auto' && budget.suggestedUsd === null;
  return (
    <Dialog.Root open onOpenChange={(open) => { if (open === false) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg" data-testid="start-eval-run-dialog">
          <Dialog.Title className="text-lg font-semibold">Start the Eval Run?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            {trials === null ? 'Its trials' : `${trials} trial(s)`} run the step and its Evaluators{estimatedUsd === null ? ' — no cost estimate.' : `, estimated ${formatCostUsd(estimatedUsd)}.`}
          </Dialog.Description>
          {budget.kind === 'set' ? (
            <p className="mt-3 text-sm">It spends up to <span className="font-semibold">${budget.budgetUsd}</span>.</p>
          ) : (
            <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-200" data-testid="auto-budget-warning">
              {cannotCap
                ? 'Auto budget is selected, but this step has no cost history or model price to suggest one. Go back and set a budget.'
                : `Auto budget: the run is capped at $${budget.suggestedUsd} (1.5× the estimate) and stops spending there. Go back to set your own cap.`}
            </p>
          )}
          {error !== null && <p className="mt-3 text-xs text-destructive">{error.message}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={buttonClass}>Back</button>
            </Dialog.Close>
            <button type="button" className={primaryButtonClass} disabled={cannotCap || starting} onClick={onStart}>
              {starting ? 'Starting…' : 'Start'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The card a prepared Eval Run waits on — prepared by the assistant or from
 * the CLI: the person starts it by confirming the budget shown (D15).
 */
export function StartEvalRunCard({ step, prepared, otherVersion, mayRun, runReason }: {
  step: EvaluationSubject;
  prepared: PreparedEvalRun;
  /** The workflow version the run was prepared for, when it is not the one shown. */
  otherVersion?: number;
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const start = useStepEvaluationMutation(step, () =>
    mediforce.evaluation.startRun({ evalRunId: prepared.evalRunId, confirmedBudgetUsd: prepared.budgetUsd }));
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="start-eval-run-card">
      <p>
        Eval Run of {prepared.trials} trial(s){otherVersion === undefined ? '' : ` on v${otherVersion}`}
        {prepared.estimatedUsd === null ? ' — no cost estimate' : ` — estimated ${formatCostUsd(prepared.estimatedUsd)}`}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <InstantTooltip label={runReason}>
          <span className="inline-flex">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={!mayRun || start.isSuccess}
              onClick={() => { start.reset(); setConfirming(true); }}
            >
              {start.isSuccess ? 'Started' : 'Start'}
            </button>
          </span>
        </InstantTooltip>
      </div>
      {confirming && (
        <StartEvalRunDialog
          trials={prepared.trials}
          estimatedUsd={prepared.estimatedUsd}
          budget={{ kind: 'set', budgetUsd: prepared.budgetUsd }}
          starting={start.isPending}
          error={start.error}
          onStart={() => start.mutate(undefined, { onSuccess: () => setConfirming(false) })}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/** A whole number of trials per case the run accepts, or null. */
function parseTrialsPerCase(text: string): number | null {
  const trials = Number(text);
  return text.trim() !== '' && Number.isInteger(trials) && trials >= 1 && trials <= 10 ? trials : null;
}

/** The person's spend cap, or null when left on auto (or not a positive amount). */
function parseBudgetUsd(text: string): number | null {
  const budget = Number(text);
  return text.trim() !== '' && Number.isFinite(budget) && budget > 0 ? budget : null;
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface EnvRow { key: string; value: string }

/** Why the rows cannot be saved as an env, or null when they can. */
function envRowsProblem(rows: readonly EnvRow[]): string | null {
  const keys = rows.map((row) => row.key.trim());
  if (keys.some((key) => ENV_KEY_PATTERN.test(key) === false)) return 'Every key must be a name like OPENROUTER_API_KEY: letters, digits and underscores.';
  if (new Set(keys).size !== keys.length) return 'A key is listed twice.';
  return null;
}

/**
 * The env an Agent's trials run with, set once for all its Eval Runs: what a
 * Workflow Step would declare, since an Agent evaluated on its own has no
 * Workflow Step to declare it. A value is a literal or a `{{SECRET}}` template
 * the workspace's secrets fill in when a trial runs. Each run freezes a copy.
 */
function AgentTrialEnvDialog({ env, onClose, onSave, saving, error }: {
  env: Record<string, string>;
  onClose: () => void;
  onSave: (env: Record<string, string>) => void;
  saving: boolean;
  error: Error | null;
}) {
  const [rows, setRows] = React.useState<EnvRow[]>(() => {
    const saved = Object.entries(env).map(([key, value]) => ({ key, value }));
    return saved.length === 0 ? [{ key: '', value: '' }] : saved;
  });
  const filled = rows.filter((row) => row.key.trim() !== '' || row.value !== '');
  const problem = envRowsProblem(filled);
  const update = (index: number, patch: Partial<EnvRow>) => setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <Dialog.Root open onOpenChange={(open) => { if (open === false) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg" data-testid="agent-trial-env-dialog">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Secrets for trials</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                Env every trial of this agent runs with, as a workflow step declares it. Use <span className="font-mono">{'{{NAME}}'}</span> to take a value from the workspace secrets.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded-sm p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </Dialog.Close>
          </div>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Key"
                  className={cn(inputClass, 'w-56 font-mono')}
                  placeholder="OPENROUTER_API_KEY"
                  value={row.key}
                  onChange={(event) => update(index, { key: event.target.value })}
                />
                <input
                  type="text"
                  aria-label="Value"
                  className={cn(inputClass, 'min-w-0 flex-1 font-mono')}
                  placeholder="{{OPENROUTER_API_KEY}}"
                  value={row.value}
                  onChange={(event) => update(index, { value: event.target.value })}
                />
                <button
                  type="button"
                  aria-label="Remove"
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => setRows(rows.length === 1 ? [{ key: '', value: '' }] : rows.filter((_row, at) => at !== index))}
                ><X className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" className={buttonClass} onClick={() => setRows([...rows, { key: '', value: '' }])}>Add another</button>
          </div>
          {problem !== null && <p className="mt-3 text-xs text-destructive">{problem}</p>}
          {error !== null && <p className="mt-3 text-xs text-destructive">{error.message}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <button type="button" className={buttonClass}>Cancel</button>
            </Dialog.Close>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={problem !== null || saving}
              onClick={() => onSave(Object.fromEntries(filled.map((row) => [row.key.trim(), row.value])))}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AgentTrialEnv({ step, mayEdit }: { step: Extract<EvaluationSubject, { kind: 'agent' }>; mayEdit: boolean }) {
  const policy = useAgentEvalPolicy(step);
  const env = policy.data?.policy?.env ?? {};
  const keys = Object.keys(env);
  const [open, setOpen] = React.useState(false);
  const save = useStepEvaluationMutation(step, async (next: Record<string, string>) => {
    await mediforce.evaluation.setMcpPolicy({ ...step, env: next });
    setOpen(false);
  });
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {mayEdit && (
        <button type="button" className={buttonClass} onClick={() => { save.reset(); setOpen(true); }} data-testid="agent-trial-env-open">
          {keys.length === 0 ? 'Add secrets' : 'Edit secrets'}
        </button>
      )}
      {keys.length === 0 && (
        <span className="text-muted-foreground" data-testid="agent-trial-env-keys">
          No env for this agent's trials.
        </span>
      )}
      {open && <AgentTrialEnvDialog env={env} onClose={() => setOpen(false)} onSave={(next) => save.mutate(next)} saving={save.isPending} error={save.error instanceof Error ? save.error : null} />}
    </div>
  );
}

/**
 * Start, confirm and read the Step's Eval Runs — or an Agent's, each of which
 * assesses the Agent version it had when prepared (ADR-0029). Starting one is
 * the workflow's `run` verb; signing a qualification from a report is its
 * `edit` verb.
 */
export function EvalRunsSection({ step, definitionVersion, data, datasets, cases, mayRun, runReason }: {
  step: EvaluationSubject;
  /**
   * The workflow version whose step a new run runs. Its finished runs are
   * listed; a prepared or running run of any version stays listed, so it can
   * be started or followed from here. Null for an Agent: every run of it is
   * listed, with the Agent version it assessed.
   */
  definitionVersion: number | null;
  data: StepEvaluation['runs'];
  /** The Step's saved Dataset versions, newest first: the one a new run takes, and the one each run ran. */
  datasets: StepEvaluation['datasets'];
  /** The Step's live Eval Cases: a run takes the saved Dataset, so it waits while they differ. */
  cases: readonly EvalCase[];
  mayRun: boolean;
  runReason: string | undefined;
}) {
  const [trialsText, setTrialsText] = React.useState('3');
  const [budgetText, setBudgetText] = React.useState('');
  const [confirming, setConfirming] = React.useState(false);
  const trials = parseTrialsPerCase(trialsText);
  const budgetUsd = parseBudgetUsd(budgetText);
  const versions = datasets.data?.datasets ?? [];
  const [nextDataset] = versions;
  const casesUnsaved = hasUnsavedCases(cases, nextDataset);
  const estimate = useEvalRunEstimate(step, definitionVersion, mayRun && nextDataset !== undefined && casesUnsaved === false ? trials : null);
  const budget: BudgetChoice = budgetUsd === null
    ? { kind: 'auto', suggestedUsd: estimate.data?.suggestedBudgetUsd ?? null }
    : { kind: 'set', budgetUsd };
  // Prepared and started in one go: the person confirmed the cap the dialog showed.
  const start = useStepEvaluationMutation(step, async () => {
    const prepared = await mediforce.evaluation.prepareRun({
      ...step,
      ...(definitionVersion === null ? {} : { definitionVersion }),
      trialsPerCase: trials ?? undefined,
      ...(budgetUsd === null ? {} : { budgetUsd }),
    });
    const confirmedBudgetUsd = budget.kind === 'set' ? budget.budgetUsd : budget.suggestedUsd ?? undefined;
    return mediforce.evaluation.startRun({ evalRunId: prepared.evalRun.id, confirmedBudgetUsd });
  });
  const estimateLabel = trials === null || nextDataset === undefined ? null
    : estimate.isError ? '(no estimate)'
      : estimate.data === undefined ? '(estimating…)'
        : estimate.data.estimate.totalUsd === null ? '(no estimate)'
          : `(estimated ${formatCostUsd(estimate.data.estimate.totalUsd)})`;
  const runs = (data.data?.evalRuns ?? []).filter((run) =>
    step.kind === 'agent' || run.definitionVersion === definitionVersion || run.status === 'prepared' || run.status === 'running');
  const otherVersion = (run: { definitionVersion: number | null; agentVersion: number | null }) => (
    step.kind === 'agent'
      ? run.agentVersion ?? undefined
      : run.definitionVersion === definitionVersion ? undefined : run.definitionVersion ?? undefined
  );
  const datasetVersion = new Map(versions.map((dataset) => [dataset.id, dataset.version]));
  // Prepared by the assistant or from the CLI, or left when starting one failed: each waits for a person to confirm its budget.
  const waiting: { prepared: PreparedEvalRun; otherVersion: number | undefined }[] = runs.filter((run) => run.status === 'prepared').map((run) => ({
    prepared: {
      evalRunId: run.id,
      budgetUsd: run.budgetUsd,
      estimatedUsd: run.estimate.totalUsd,
      trials: run.caseIds.length * run.trialsPerCase,
    },
    otherVersion: otherVersion(run),
  }));

  return (
    <Section title="Eval Runs">
      {step.kind === 'agent' && <AgentTrialEnv step={step} mayEdit={mayRun} />}
      {mayRun && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">Trials per case
            <input type="number" min={1} max={10} className={cn(inputClass, 'w-16')} value={trialsText} onChange={(event) => setTrialsText(event.target.value)} />
          </label>
          <label className="flex items-center gap-1">Budget $
            <input type="number" min={0} step={0.01} className={cn(inputClass, 'w-24')} placeholder="auto" value={budgetText} onChange={(event) => setBudgetText(event.target.value)} />
          </label>
          {estimateLabel !== null && (
            <span className="tabular-nums text-muted-foreground" data-testid="eval-run-estimate">{estimateLabel}</span>
          )}
          <button
            type="button"
            className={primaryButtonClass}
            disabled={trials === null || casesUnsaved || nextDataset === undefined || start.isPending || (budgetUsd === null && estimate.isPlaceholderData)}
            onClick={() => { start.reset(); setConfirming(true); }}
          >Start</button>
          <span className={nextDataset === undefined || casesUnsaved ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'} data-testid="eval-run-dataset">
            {nextDataset === undefined ? 'Save your cases to run.' : casesUnsaved ? `Save your cases to run: Dataset v${nextDataset.version} is behind the list.` : `Runs Dataset v${nextDataset.version} (${nextDataset.caseIds.length} case(s)).`}
          </span>
          {trials === null && <span className="text-destructive">Trials per case must be a whole number from 1 to 10.</span>}
          {estimate.error instanceof Error && <span className="text-destructive" data-testid="eval-run-estimate-error">{estimate.error.message}</span>}
        </div>
      )}
      {confirming && (
        <StartEvalRunDialog
          trials={estimate.data?.trialCount ?? null}
          estimatedUsd={estimate.data?.estimate.totalUsd ?? null}
          budget={budget}
          starting={start.isPending}
          error={start.error}
          onStart={() => start.mutate(undefined, { onSuccess: () => setConfirming(false) })}
          onClose={() => setConfirming(false)}
        />
      )}
      {waiting.map((run) => <StartEvalRunCard key={run.prepared.evalRunId} step={step} prepared={run.prepared} otherVersion={run.otherVersion} mayRun={mayRun} runReason={runReason} />)}
      {data.isLoading ? <Loading /> : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{step.kind === 'agent' ? 'No Eval Runs of this agent yet.' : `No Eval Runs of v${definitionVersion} yet.`}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="eval-runs-table">
            <thead>
              <tr className="border-b bg-muted text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Dataset</th>
                <th className="px-3 py-2 font-medium">
                  <InstantTooltip label="How the step fared on the Acceptance Criteria frozen into the run.">
                    <span>Acceptance</span>
                  </InstantTooltip>
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b last:border-0 hover:bg-muted/30" data-testid="eval-run-row">
                  <td className="px-3 py-2 font-mono text-xs">
                    {run.id.slice(0, 8)}
                    {otherVersion(run) !== undefined && <span className="ml-1.5 text-muted-foreground">{step.kind === 'agent' ? 'agent ' : ''}v{otherVersion(run)}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground" title={run.createdAt}>
                    {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-3 py-2"><EvalRunStatusBadge status={run.status} /></td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">${run.spentUsd.toFixed(2)} of ${run.budgetUsd}</td>
                  <td className="px-3 py-2 text-xs">{datasetVersion.has(run.datasetVersionId) ? `v${datasetVersion.get(run.datasetVersionId)}` : '—'}</td>
                  <td className="px-3 py-2"><AcceptanceBadge acceptance={run.acceptance} /></td>
                  <td className="px-3 py-2 text-right">
                    <Link href={evalRunHref(step, run.id)} className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                      Details <ChevronRight className="h-3 w-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
