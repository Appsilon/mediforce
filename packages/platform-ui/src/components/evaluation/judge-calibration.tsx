'use client';

import * as React from 'react';
import {
  JUDGE_MIN_AGREEMENT,
  JUDGE_MIN_FAILURE_LABELS,
  JUDGE_MIN_LABELS,
  JUDGE_PASS_VALUE,
  type AgentOutputSchema,
  type AgentRun,
  type EvalCase,
  type EvaluatedStep,
  type Score,
  type WrittenOutput,
} from '@mediforce/platform-core';
import type { EvaluatorView } from '@mediforce/platform-api/contract';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { useAgentRunIo, useEvaluatorLabels, useStepEvaluationMutation, useWrittenOutputs } from '@/hooks/use-step-evaluation';
import { InstantTooltip } from '@/components/ui/instant-tooltip';
import { RunInputOutput } from './run-input-output';
import { WriteOutputForm, describeChanges } from './written-output-form';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

export interface OutputLabel {
  passed: boolean;
  comment: string | null;
  /** A production run's output, or a person's written one. */
  written: boolean;
}

/** The newest label per labelled output, by the id of what was labelled. */
export function labelsBySubject(labels: readonly Score[]): Map<string, OutputLabel> {
  return new Map(labels.map((score) => [score.subject.id, {
    passed: score.value >= JUDGE_PASS_VALUE,
    comment: score.comment,
    written: score.subject.type === 'written_output',
  }]));
}

export function LabelBadge({ label }: { label: OutputLabel }) {
  return (
    <span className={cn('rounded px-1.5 text-[11px]', label.passed ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>
      labelled {label.passed ? 'pass' : 'fail'}
    </span>
  );
}

/**
 * One production output to label pass or fail for an Evaluator's rule, shown
 * with the input its step was given. A relabel supersedes the label before it.
 */
export function LabelOutputRow({ step, evaluatorId, agentRunId, note, label, mayEdit, showPair = true }: {
  step: EvaluatedStep;
  evaluatorId: string;
  agentRunId: string;
  /** Why this output is offered — the assistant's reason, or the case it was marked as. */
  note?: React.ReactNode;
  label: OutputLabel | undefined;
  mayEdit: boolean;
  /** False keeps the pair folded until opened, for a long list. */
  showPair?: boolean;
}) {
  const [comment, setComment] = React.useState('');
  const [opened, setOpened] = React.useState(showPair);
  const save = useStepEvaluationMutation(step, (passed: boolean) => mediforce.evaluation.labelOutput({
    evaluatorId,
    agentRunId,
    passed,
    ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
  }));
  return (
    <li className="border-t pt-2 first:border-t-0 first:pt-0" data-testid="label-output">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono">{agentRunId.slice(0, 8)}</span>
        {label !== undefined && <LabelBadge label={label} />}
        {note !== undefined && <span className="text-muted-foreground">{note}</span>}
      </div>
      {showPair ? (
        <div className="mt-1"><RunInputOutput agentRunId={agentRunId} outputTitle="Output to label" /></div>
      ) : (
        <details className="mt-1" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
          <summary className="cursor-pointer text-muted-foreground">Input and output</summary>
          {opened && <div className="mt-1"><RunInputOutput agentRunId={agentRunId} outputTitle="Output to label" /></div>}
        </details>
      )}
      {mayEdit && (
        <div className="mt-1 flex gap-1.5">
          <input
            className={cn(inputClass, 'min-w-0 flex-1 py-0.5 text-xs')}
            placeholder="Why (optional)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <button type="button" className={buttonClass} disabled={save.isPending} onClick={() => save.mutate(true)}>Pass</button>
          <button type="button" className={buttonClass} disabled={save.isPending} onClick={() => save.mutate(false)}>Fail</button>
        </div>
      )}
      {save.error !== null && <p className="mt-1 text-destructive">{save.error.message}</p>}
    </li>
  );
}

/** One written example: what it changed from its run, its label for this judge, and relabelling or archiving it. */
function WrittenOutputRow({ step, evaluatorId, written, label, mayEdit }: {
  step: EvaluatedStep;
  evaluatorId: string;
  written: WrittenOutput;
  label: OutputLabel | undefined;
  mayEdit: boolean;
}) {
  const base = useAgentRunIo(written.basedOnAgentRunId);
  const relabel = useStepEvaluationMutation(step, (passed: boolean) => mediforce.evaluation.labelOutput({ evaluatorId, writtenOutputId: written.id, passed }));
  const archive = useStepEvaluationMutation(step, () => mediforce.evaluation.archiveWrittenOutput({ writtenOutputId: written.id, archived: true }));
  const changes = base.data === undefined ? [] : describeChanges(base.data.result, written.result);
  const error = relabel.error ?? archive.error;
  return (
    <li className="rounded border p-1.5" data-testid="written-output">
      <div className="flex flex-wrap items-center gap-1.5">
        {label === undefined ? <span className="text-muted-foreground">not labelled for this judge</span> : <LabelBadge label={label} />}
        <span className="text-muted-foreground">{written.basedOnAgentRunId === null ? 'written from nothing' : <>from run <span className="font-mono">{written.basedOnAgentRunId.slice(0, 8)}</span></>}{written.origin === 'assistant' ? ' · drafted by the assistant' : ''}</span>
        {mayEdit && (
          <span className="ml-auto flex gap-1">
            <button type="button" className={buttonClass} disabled={relabel.isPending} onClick={() => relabel.mutate(true)}>Pass</button>
            <button type="button" className={buttonClass} disabled={relabel.isPending} onClick={() => relabel.mutate(false)}>Fail</button>
            <button type="button" className={buttonClass} disabled={archive.isPending} onClick={() => archive.mutate(undefined)}>Archive</button>
          </span>
        )}
      </div>
      {written.note !== null && <p className="mt-0.5">{written.note}</p>}
      {changes.length > 0 && <p className="mt-0.5 text-muted-foreground" data-testid="written-output-changes">Changed: {changes.slice(0, 5).join('; ')}{changes.length > 5 ? ` and ${changes.length - 5} more` : ''}</p>}
      <details className="mt-0.5">
        <summary className="cursor-pointer text-muted-foreground">Input and output</summary>
        <div className="mt-1 grid gap-2 md:grid-cols-2">
          <pre className="max-h-48 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap break-words">{JSON.stringify(written.stepInput, null, 2)}</pre>
          <pre className="max-h-48 overflow-auto rounded bg-muted p-1.5 whitespace-pre-wrap break-words">{JSON.stringify(written.result, null, 2)}</pre>
        </div>
      </details>
      {error !== null && <p className="mt-0.5 text-destructive">{error.message}</p>}
    </li>
  );
}

/** How far a judge is from counting: labels, failures among them, and its agreement with them. */
export function CalibrationProgress({ evaluator, labels }: { evaluator: EvaluatorView; labels: readonly OutputLabel[] }) {
  const failures = labels.filter((label) => label.passed === false).length;
  const calibration = evaluator.latest.calibration;
  const met = (done: boolean) => (done ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-300');
  return (
    <span className="text-[11px]" data-testid="calibration-progress">
      <span className={met(labels.length >= JUDGE_MIN_LABELS)}>{labels.length}/{JUDGE_MIN_LABELS} labels</span>
      {' · '}
      <span className={met(failures >= JUDGE_MIN_FAILURE_LABELS)}>{failures}/{JUDGE_MIN_FAILURE_LABELS} fails</span>
      {' · '}
      {calibration === null
        ? <span className="text-muted-foreground">not calibrated</span>
        : <span className={met(calibration.agreement >= JUDGE_MIN_AGREEMENT)}>agreement {calibration.agreement.toFixed(2)} (needs {JUDGE_MIN_AGREEMENT})</span>}
    </span>
  );
}

/** Runs the judge over every labelled output and records how often it agrees with the person. */
export function CalibrateAction({ step, evaluator, labelCount, mayEdit, editReason }: {
  step: EvaluatedStep;
  evaluator: EvaluatorView;
  labelCount: number;
  mayEdit: boolean;
  editReason?: string;
}) {
  const calibrate = useStepEvaluationMutation(step, () => mediforce.evaluation.calibrateEvaluator({ evaluatorId: evaluator.id }));
  const calibration = evaluator.latest.calibration;
  return (
    <div className="space-y-0.5">
      <InstantTooltip label={editReason}>
        <span className="inline-flex">
          <button type="button" className={primaryButtonClass} disabled={mayEdit === false || labelCount === 0 || calibrate.isPending} onClick={() => calibrate.mutate(undefined)}>
            {calibrate.isPending ? 'Calibrating…' : 'Calibrate'}
          </button>
        </span>
      </InstantTooltip>
      {calibration !== null && (
        <p data-testid="calibration-result">
          v{evaluator.latest.version} agreement {calibration.agreement.toFixed(2)}
          {typeof calibration.kappa === 'number' && ` · κ ${calibration.kappa.toFixed(2)}`} on {calibration.labelCount} labels
          {evaluator.trust.trusted ? ' — counts' : ` — not counted: ${evaluator.trust.reason}`}
        </p>
      )}
      {calibrate.data !== undefined && calibrate.data.disagreements.length > 0 && (
        <p className="text-muted-foreground">
          Disagrees with you on {calibrate.data.disagreements.map((miss) => miss.agentRunId.slice(0, 8)).join(', ')} — refine the rule, or ask the assistant why.
        </p>
      )}
      {calibrate.error !== null && <p className="text-destructive">{calibrate.error.message}</p>}
    </div>
  );
}

const MARKED: Record<EvalCase['expectation'], string> = {
  negative: 'you added it as a negative case',
  positive: 'you added it as a positive case',
};

/**
 * Where a person labels a judge's outputs in the tab (ADR-0023 D9): the
 * production runs they already added as Eval Cases first — negatives before
 * positives, since a judge needs failures — then the other production runs.
 * A label is about this Evaluator's rule, not the run overall.
 */
export function JudgeCalibrationPanel({ step, evaluator, cases, runs, stepOutputSchema, mayEdit }: {
  step: EvaluatedStep;
  evaluator: EvaluatorView;
  cases: readonly EvalCase[];
  runs: readonly AgentRun[];
  stepOutputSchema: AgentOutputSchema | undefined;
  mayEdit: boolean;
}) {
  const [writing, setWriting] = React.useState(false);
  const labels = useEvaluatorLabels(step, evaluator.id);
  const writtenOutputs = useWrittenOutputs(step).data?.writtenOutputs ?? [];
  const byOutput = labelsBySubject(labels.data?.labels ?? []);
  const marked = new Map<string, EvalCase['expectation']>();
  for (const evalCase of [...cases].sort((left, right) => (left.expectation === right.expectation ? 0 : left.expectation === 'negative' ? -1 : 1))) {
    if (evalCase.source === 'production' && evalCase.sourceAgentRunId !== null && !marked.has(evalCase.sourceAgentRunId)) {
      marked.set(evalCase.sourceAgentRunId, evalCase.expectation);
    }
  }
  const unlabelledMarked = [...marked].filter(([agentRunId]) => !byOutput.has(agentRunId));
  const otherRuns = runs.filter((run) => !marked.has(run.id) && !byOutput.has(run.id));
  const labelled = [...byOutput].filter(([, label]) => !label.written);

  return (
    <div className="mt-2 space-y-3 rounded-md bg-muted/40 p-3 text-xs" data-testid="judge-calibration">
      <p className="text-muted-foreground">
        A judge is a model&apos;s opinion, so it counts only once it agrees with yours. Label outputs pass or fail <span className="font-medium text-foreground">for this rule</span> — not whether the run was good overall — then calibrate. It needs {JUDGE_MIN_LABELS} labels, {JUDGE_MIN_FAILURE_LABELS} of them fails (a judge that passes everything would otherwise look perfect), and agreement of {JUDGE_MIN_AGREEMENT} or better.
      </p>
      <CalibrateAction step={step} evaluator={evaluator} labelCount={byOutput.size} mayEdit={mayEdit} />
      <section className="space-y-1" data-testid="written-outputs">
        <div className="flex items-center gap-2">
          <h4 className="font-medium">Your written examples</h4>
          {mayEdit && !writing && <button type="button" className={buttonClass} onClick={() => setWriting(true)}>Write an example</button>}
        </div>
        <p className="text-muted-foreground">
          When production has no output that breaks this rule — nobody runs a bad case on purpose — change a real run&apos;s output until it does, and label it. It keeps the run&apos;s input and the step&apos;s output shape; nothing re-runs it. The assistant can draft such outputs too.
        </p>
        {writing && <WriteOutputForm step={step} evaluator={evaluator} runs={runs} stepOutputSchema={stepOutputSchema} onClose={() => setWriting(false)} />}
        {writtenOutputs.length > 0 && (
          <ul className="space-y-2">
            {writtenOutputs.map((written) => (
              <WrittenOutputRow key={written.id} step={step} evaluatorId={evaluator.id} written={written} label={byOutput.get(written.id)} mayEdit={mayEdit} />
            ))}
          </ul>
        )}
      </section>
      {unlabelledMarked.length > 0 && (
        <section className="space-y-1">
          <h4 className="font-medium">Runs you added as Eval Cases</h4>
          <p className="text-muted-foreground">You judged these runs already; say whether each output breaks this rule.</p>
          <ul className="space-y-2" data-testid="label-candidates-marked">
            {unlabelledMarked.map(([agentRunId, expectation]) => (
              <LabelOutputRow key={agentRunId} step={step} evaluatorId={evaluator.id} agentRunId={agentRunId} note={MARKED[expectation]} label={undefined} mayEdit={mayEdit} showPair={false} />
            ))}
          </ul>
        </section>
      )}
      {otherRuns.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Other production runs ({otherRuns.length})</summary>
          <ul className="mt-1 space-y-2" data-testid="label-candidates-runs">
            {otherRuns.map((run) => (
              <LabelOutputRow key={run.id} step={step} evaluatorId={evaluator.id} agentRunId={run.id} label={undefined} mayEdit={mayEdit} showPair={false} />
            ))}
          </ul>
        </details>
      )}
      {labelled.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Labelled ({labelled.length})</summary>
          <ul className="mt-1 space-y-2" data-testid="labelled-outputs">
            {labelled.map(([agentRunId, label]) => (
              <LabelOutputRow key={agentRunId} step={step} evaluatorId={evaluator.id} agentRunId={agentRunId} label={label} mayEdit={mayEdit} showPair={false} />
            ))}
          </ul>
        </details>
      )}
      {unlabelledMarked.length === 0 && otherRuns.length === 0 && labelled.length === 0 && (
        <p className="text-muted-foreground">The step has no production outputs to label yet — write an example above.</p>
      )}
    </div>
  );
}
