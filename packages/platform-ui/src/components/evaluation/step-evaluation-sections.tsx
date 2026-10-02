'use client';

import * as React from 'react';
import { z } from 'zod';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleCheck, CircleX, Clock, Loader2, X, type LucideIcon } from 'lucide-react';
import {
  CHAMPION_VARIANT_ID,
  DEFAULT_ACCEPTANCE_CRITERIA,
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
  type EvalCase,
  type EvalCaseInput,
  type EvalDatasetVersion,
  type EvaluatedStep,
  type EvaluatorCheck,
  type EvaluatorSeverity,
  type McpEvalServerPolicy,
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
import { AgentLogPanel } from '@/components/agents/agent-log-panel';
import { RunInputOutput, RunInputOutputDetails } from './run-input-output';
import { useAgentRun } from '@/hooks/use-agent-runs';
import { useEvalRun, useStepEvaluation, useStepEvaluationMutation } from '@/hooks/use-step-evaluation';
import { EvalRunReport, describePatch } from './eval-run-report';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';
import {
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
            <span className="ml-1.5 text-xs text-muted-foreground">
              v{evaluator.latest.version} · {CHECK_KINDS[check.kind].label} · {evaluator.latest.severity}
              {check.kind === 'llm_judge' && ` · min confidence ${check.minConfidence}`}
              {evaluator.latest.origin === 'assistant' ? ' · from the assistant' : ''}
            </span>
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

interface CaseFormValues {
  name: string;
  split: EvalCase['split'];
  notes: string;
  /** The case input as JSON text: triggerPayload, previousStepOutputs and optionally previousRun. */
  input: string;
}

export interface CaseFormResult {
  name: string;
  split: EvalCase['split'];
  notes: string | null;
  input: EvalCaseInput;
}

export function caseFormValues(evalCase: EvalCase): CaseFormValues {
  return {
    name: evalCase.name,
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

/** Name, split, notes and the input the step is given. */
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
    onSubmit({ name: values.name.trim(), split: values.split, notes: notes === '' ? null : notes, input: parsed.input });
  };
  const shownError = inputError ?? error;
  return (
    <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs" data-testid="case-form">
      <div className="flex flex-wrap gap-2">
        <input aria-label="Case name" className={cn(inputClass, 'min-w-48 flex-1')} placeholder="Name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} />
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
    ...(values.split === evalCase.split ? {} : { split: values.split }),
    ...(values.notes === evalCase.notes ? {} : { notes: values.notes }),
    ...(JSON.stringify(values.input) === JSON.stringify(evalCase.input) ? {} : { input: values.input }),
  }));
  const archive = useStepEvaluationMutation(step, () => mediforce.evaluation.archiveCase({ caseId: evalCase.id, archived: true }));
  return (
    <li className="border-t pt-1.5 first:border-t-0 first:pt-0" data-testid="eval-case-row">
      <div className="flex items-center gap-2">
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
            <p><span className="text-muted-foreground">Expects:</span> {evalCase.notes ?? 'an output that passes every counted Evaluator (no notes)'}</p>
            {opened && evalCase.source === 'production' && evalCase.sourceAgentRunId !== null && (
              <div>
                <div className="mb-0.5 font-medium">The source run</div>
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
    notes: z.string().nullable().optional(),
    split: EvalCaseSplitSchema.optional(),
  }).safeParse(parsed);
  if (whole.success) {
    const { input, notes, ...rest } = whole.data;
    return { values: { ...rest, ...(notes === undefined || notes === null ? {} : { notes }), input: JSON.stringify(input, null, 2) } };
  }
  const input = EvalCaseInputSchema.safeParse(parsed);
  if (input.success) return { values: { input: JSON.stringify(input.data, null, 2) } };
  return { error: 'The file is neither a case ({ name, input, notes, split }) nor a case input ({ triggerPayload, previousStepOutputs }).' };
}

/**
 * A case written by hand: its input starts from an existing case's, so it has
 * the shape the step is given, or from a `.json` file. For inputs production
 * never sent.
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
export function CasesSection({ step, evaluation, mayEdit }: {
  step: EvaluatedStep;
  evaluation: StepEvaluation;
  mayEdit: boolean;
}) {
  const harvest = useStepEvaluationMutation(step, (agentRunId: string) =>
    mediforce.evaluation.createCaseFromAgentRun({ agentRunId }));
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
        An Eval Case is an <span className="font-medium text-foreground">input</span> an Eval Run re-runs the step on; its notes say what the new output must — or must not — do. A case grades nothing itself: the Evaluators grade each re-run&apos;s output.
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
          <p className="mt-1 text-xs text-muted-foreground">Open a run&apos;s input and output, then add it as a case. Say in its notes what the output must — or must not — do.</p>
          <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto pr-1" data-testid="harvestable-runs">
            {runs.map((run) => (
              <li key={run.id} className="rounded border px-2 py-1.5 text-xs">
                <div className="flex items-center gap-2">
                  <span>{run.startedAt.slice(0, 16).replace('T', ' ')}</span>
                  <span className="text-muted-foreground">{run.status}{run.fallbackReason === null ? '' : ` · ${run.fallbackReason}`}</span>
                  <span className="font-mono text-muted-foreground" title={run.id}>{run.id.slice(0, 8)}</span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button type="button" className={buttonClass} onClick={() => setLogRun(run)}>Log</button>
                    <InstantTooltip label="An Eval Run re-runs this input and its Evaluators grade the new output.">
                      <button type="button" className={buttonClass} onClick={() => harvest.mutate(run.id)}>Add as case</button>
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
    description: 'A case with a recording never reaches the server: its calls are answered from what a live trial of that case recorded, and a call no recording answers gets an error. A case with no recording yet runs live once and records it.',
  },
};

/**
 * What each MCP server of the Step's agent may do in a trial (D6); unnamed
 * servers are denied. A live trial records what a server answers, per case, for
 * a replay; a replayed case with no recording yet runs live and records it.
 */
export function McpPolicySection({ step, data, mayEdit }: { step: EvaluatedStep; data: StepEvaluation['mcpPolicy']; mayEdit: boolean }) {
  const save = useStepEvaluationMutation(step, (servers: Record<string, McpEvalServerPolicy>) =>
    mediforce.evaluation.setMcpPolicy({ ...step, servers }));
  const servers = data.data?.servers ?? [];
  if (!data.isLoading && servers.length === 0) return null;
  const policyOf = (mode: McpEvalMode, denyTools: string[] | undefined): McpEvalServerPolicy =>
    ({ mode, ...(denyTools === undefined || mode === 'deny' ? {} : { denyTools }) });
  const setMode = (name: string, mode: McpEvalMode) => {
    const next = Object.fromEntries(servers.filter((server) => server.defaulted === false)
      .map((server) => [server.name, policyOf(server.mode, server.denyTools)]));
    next[name] = policyOf(mode, servers.find((server) => server.name === name)?.denyTools);
    save.mutate(next);
  };
  return (
    <Section title="MCP servers in eval trials">
      <p className="text-xs text-muted-foreground">
        What the step&apos;s agent may do with each of its MCP servers while an Eval Run tries it. Replay records each case live the first time it runs, then answers from that recording — after a case&apos;s first run, its trials touch nothing outside.
      </p>
      {data.isLoading ? <Loading /> : (
        <ul className="space-y-2 text-sm">
          {servers.map((server) => (
            <li key={server.name} className="space-y-0.5" data-testid="mcp-policy-server">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{server.name}</span>
                {server.mode !== 'deny' && server.denyTools !== undefined && server.denyTools.length > 0 && (
                  <span className="text-xs text-muted-foreground">denied tools: {server.denyTools.join(', ')}</span>
                )}
                <InstantTooltip label="Replay answers the cases recorded here; any other case runs live once to record.">
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

const NOT_JUDGED = '';

/** The criteria with one severity's pass rate changed — its pass^k kept — or, given `NOT_JUDGED`, dropped. */
export function withPassRate(criteria: AcceptanceCriteria | undefined, severity: EvaluatorSeverity, choice: string): AcceptanceCriteria {
  const { [severity]: previous, ...others } = criteria ?? {};
  if (choice === NOT_JUDGED) return others;
  return { ...others, [severity]: { ...previous, minPassRate: Number(choice) } };
}

function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** One line per severity: its floor, or that it is not judged. */
function describeThresholds(criteria: AcceptanceCriteria): string {
  return SEVERITIES.map((severity) => {
    const criterion = criteria[severity];
    return `${severity} ${criterion === undefined ? 'not judged' : `≥ ${percent(criterion.minPassRate)}`}`;
  }).join(' · ');
}

const VALIDATION: Record<StepValidation['status'], { label: string; icon: LucideIcon; className: string }> = {
  passed: { label: 'Validation passed', icon: CircleCheck, className: 'border-green-600/40 bg-green-600/10 text-green-700 hover:bg-green-600/15 dark:text-green-400' },
  failed: { label: 'Validation failed', icon: CircleX, className: 'border-red-600/40 bg-red-600/10 text-red-700 hover:bg-red-600/15 dark:text-red-400' },
  not_verified: { label: 'Not verified', icon: Clock, className: 'border-border bg-muted/60 text-muted-foreground hover:bg-muted' },
};

/** What the Step's qualification rests on: the Eval Run it was signed from, and what changed since. */
function QualificationDetails({ status }: { status: GetStepQualificationOutput }) {
  const { qualification } = status;
  if (qualification === null) {
    return <p className="text-muted-foreground">Not qualified. Run the step, then sign a Step Qualification from the run&apos;s report. It is informational: nothing is blocked without one.</p>;
  }
  return (
    <div className="space-y-1" data-testid="step-qualification">
      <p>
        Signed by <span className="font-medium">{qualification.signature.signerName}</span> on {qualification.signature.signedAt.slice(0, 16).replace('T', ' ')}
        {' '}for {qualification.variantId === CHAMPION_VARIANT_ID ? 'the step' : `'${qualification.variantLabel}' (${describePatch(qualification.patch)})`}
        {' '}— Eval Run <span className="font-mono">{qualification.evalRunId.slice(0, 8)}</span>,
        {' '}fingerprint <span className="font-mono">{qualification.fingerprint.hash.slice(0, 12)}</span>.
      </p>
      <p className="text-muted-foreground">{qualification.signature.meaning} ({qualification.signature.reauthentication === 'password' ? 'password re-entered' : 'signed from the session'})</p>
      <p>Judged against: {describeAcceptanceCriteria(qualification.acceptanceCriteria)}</p>
      <p data-testid="qualification-mcp-policy">{describeMcpPolicy(qualification.mcpPolicy)}</p>
      {qualification.deviations.map((deviation) => (
        <p key={deviation.severity} className="text-amber-700 dark:text-amber-300">Deviation ({deviation.severity}): {deviation.justification}</p>
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
 * Per severity: a slider for the minimum pass rate, and whether the severity is
 * judged at all. Nothing is saved until Save, which writes one new criteria version.
 */
function ThresholdDialog({ onClose, criteria, onSave, saving, error }: {
  onClose: () => void;
  criteria: AcceptanceCriteria;
  onSave: (criteria: AcceptanceCriteria) => void;
  saving: boolean;
  error: Error | null;
}) {
  const [draft, setDraft] = React.useState(criteria);
  const judged = SEVERITIES.filter((severity) => draft[severity] !== undefined);
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
                Every counted Evaluator of a severity must pass at least this share of its graded trials: 8 of 10 meets 80%, and 100% means every graded trial passes.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded-sm p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </Dialog.Close>
          </div>
          <div className="space-y-4">
            {SEVERITIES.map((severity) => {
              const criterion = draft[severity];
              // The schema needs one severity judged, so the last one judged cannot be cleared.
              const lastJudged = judged.length === 1 && judged[0] === severity;
              return (
                <div key={severity} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <label className="flex items-center gap-2 capitalize">
                      <input
                        type="checkbox"
                        aria-label={`judge ${severity}`}
                        checked={criterion !== undefined}
                        disabled={lastJudged}
                        onChange={(event) => setDraft(withPassRate(draft, severity, event.target.checked ? '1' : NOT_JUDGED))}
                      />
                      {severity}
                    </label>
                    <span className="font-mono text-xs tabular-nums">{criterion === undefined ? 'not judged' : `≥ ${percent(criterion.minPassRate)}`}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    aria-label={`${severity} minimum pass rate`}
                    className="w-full accent-primary disabled:opacity-40"
                    value={Math.round((criterion?.minPassRate ?? 1) * 100)}
                    disabled={criterion === undefined}
                    onChange={(event) => setDraft(withPassRate(draft, severity, String(Number(event.target.value) / 100)))}
                  />
                </div>
              );
            })}
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

/**
 * Whether the step is validated (D10): the newest finished Eval Run of the
 * workflow version, passed or failed on its Acceptance Criteria, not verified
 * once anything it rested on changed. The signed Step Qualification, if any,
 * opens from the same status. The thresholds — every severity at 100% until
 * set — are tuned in a dialog; the next Eval Run freezes the ones in force.
 */
export function AcceptanceCriteriaSection({ step, criteria, qualification, mayEdit }: {
  step: EvaluatedStep;
  criteria: StepEvaluation['criteria'];
  qualification: StepEvaluation['qualification'];
  mayEdit: boolean;
}) {
  const [showDetails, setShowDetails] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const save = useStepEvaluationMutation(step, (next: AcceptanceCriteria) => mediforce.evaluation.setAcceptanceCriteria({ ...step, criteria: next }));
  const effective = criteria.data?.criteria?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA;
  const status = qualification.data;
  const validation = status === undefined ? null : VALIDATION[status.validation.status];
  const saveThresholds = (next: AcceptanceCriteria) => save.mutate(next, { onSuccess: () => setEditing(false) });
  return (
    <section className="rounded-lg border p-3 space-y-3" data-testid="acceptance-criteria">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {status === undefined || validation === null ? <Loading /> : (
          <InstantTooltip label={`${status.validation.reason}${status.validation.runInProgress ? ' An Eval Run is running.' : ''}`}>
            <button
              type="button"
              className={cn('inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold', validation.className)}
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
        <InstantTooltip label={`${describeThresholds(effective)}. Every counted Evaluator of a severity must reach its rate.`}>
          <span>
            <button
              type="button"
              className={buttonClass}
              disabled={mayEdit === false || criteria.isLoading}
              data-testid="set-threshold"
              onClick={() => { save.reset(); setEditing(true); }}
            >Set the threshold</button>
          </span>
        </InstantTooltip>
      </div>
      {showDetails && status !== undefined && (
        <div className="space-y-2 rounded-md bg-muted/40 p-2 text-xs">
          <p data-testid="validation-reason">{status.validation.reason}{status.validation.runInProgress && ' An Eval Run is running; this updates when it ends.'}</p>
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

/**
 * Prepare, confirm and read the Step's Eval Runs. Preparing and starting one is the workflow's
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
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const prepare = useStepEvaluationMutation(step, () => mediforce.evaluation.prepareRun({
    ...step,
    trialsPerCase: trials,
    ...(budget === '' ? {} : { budgetUsd: Number(budget) }),
  }));
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
          <button
            type="button"
            className={buttonClass}
            disabled={prepare.isPending}
            onClick={() => prepare.mutate(undefined)}
          >Prepare</button>
          <span className="text-muted-foreground" data-testid="eval-run-dataset">
            {nextDataset === undefined ? 'No Dataset frozen yet — freeze the Eval Cases first.' : `Runs Dataset v${nextDataset.version} (${nextDataset.caseIds.length} case(s)).`}
          </span>
          {prepare.error !== null && <span className="text-destructive">{prepare.error.message}</span>}
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
